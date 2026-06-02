import { Router } from "express";
import { createHmac, timingSafeEqual } from "crypto";

const router = Router();

// Map Whop product IDs → tiers. Set via env vars in the Replit secrets panel.
function buildProductTierMap(): Record<string, "report" | "pro"> {
  const map: Record<string, "report" | "pro"> = {};
  const reportId = process.env.WHOP_PRODUCT_REPORT_ID;
  const proId    = process.env.WHOP_PRODUCT_PRO_ID;
  if (reportId) map[reportId] = "report";
  if (proId)    map[proId]    = "pro";
  return map;
}

function verifySignature(rawBody: Buffer, signature: string, secret: string): boolean {
  // Whop sends: "sha256=<hex>" — strip the prefix if present
  const sig = signature.startsWith("sha256=") ? signature.slice(7) : signature;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

async function clerkSetTier(
  email: string,
  tier: "report" | "pro",
): Promise<{ ok: boolean; error?: string }> {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) return { ok: false, error: "CLERK_SECRET_KEY not configured" };

  // 1. Find the Clerk user by email address
  const searchUrl = `https://api.clerk.com/v1/users?email_address[]=${encodeURIComponent(email)}&limit=1`;
  const searchRes = await fetch(searchUrl, {
    headers: { Authorization: `Bearer ${secretKey}` },
  });
  if (!searchRes.ok) {
    return { ok: false, error: `Clerk user search failed: ${searchRes.status}` };
  }
  const users = (await searchRes.json()) as { id: string }[];
  if (!users.length) {
    return { ok: false, error: `No Clerk user found for email: ${email}` };
  }

  const userId = users[0].id;

  // 2. Merge tier into publicMetadata (PATCH keeps existing keys intact)
  const patchRes = await fetch(`https://api.clerk.com/v1/users/${userId}/metadata`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ public_metadata: { tier } }),
  });
  if (!patchRes.ok) {
    const body = await patchRes.text();
    return { ok: false, error: `Clerk metadata update failed: ${patchRes.status} — ${body}` };
  }

  return { ok: true };
}

// POST /api/whop-webhook
router.post("/whop-webhook", async (req, res) => {
  // ── Signature verification ──────────────────────────────────────────────
  const secret = process.env.WHOP_WEBHOOK_SECRET;
  if (secret) {
    const sig    = req.headers["whop-signature"] as string | undefined;
    const rawBody = (req as unknown as Record<string, unknown>).rawBody as Buffer | undefined;

    if (!sig) {
      res.status(400).json({ error: "Missing whop-signature header" });
      return;
    }
    if (!rawBody) {
      res.status(500).json({ error: "Raw body not captured — server misconfiguration" });
      return;
    }
    if (!verifySignature(rawBody, sig, secret)) {
      req.log.warn("Whop webhook: signature mismatch");
      res.status(401).json({ error: "Invalid signature" });
      return;
    }
  }

  // ── Parse the Whop event body ───────────────────────────────────────────
  const body   = req.body as Record<string, unknown>;
  const action = body.action as string | undefined;
  const data   = body.data   as Record<string, unknown> | undefined;

  if (!action || !data) {
    res.status(400).json({ error: "Missing action or data in webhook payload" });
    return;
  }

  // Extract email + product_id from the relevant event types
  let email: string | undefined;
  let productId: string | undefined;

  if (
    action === "membership.went_valid" ||
    action === "membership.was_created" ||
    action === "membership.was_renewed"
  ) {
    email     = (data.user as Record<string, unknown>)?.email as string | undefined;
    productId = (data.product_id as string | undefined)
             ?? ((data.plan as Record<string, unknown>)?.product_id as string | undefined);
  } else if (action === "payment.succeeded") {
    email     = (data.user as Record<string, unknown>)?.email as string | undefined;
    productId = ((data.membership as Record<string, unknown>)?.product_id as string | undefined)
             ?? ((data.plan     as Record<string, unknown>)?.product_id as string | undefined);
  } else {
    // Unrecognised event — acknowledge but take no action
    req.log.info({ action }, "Whop webhook: unhandled event type");
    res.json({ received: true, action, handled: false });
    return;
  }

  if (!email || !productId) {
    req.log.warn({ action, data }, "Whop webhook: could not extract email or productId");
    res.status(400).json({ error: "Cannot extract email or productId from event payload" });
    return;
  }

  // Map product → tier
  const productTiers = buildProductTierMap();
  const tier = productTiers[productId];
  if (!tier) {
    req.log.info({ productId }, "Whop webhook: unrecognised productId — ignoring");
    res.json({ received: true, productId, handled: false });
    return;
  }

  // Update Clerk publicMetadata
  const result = await clerkSetTier(email, tier);
  if (!result.ok) {
    req.log.error({ email, tier, error: result.error }, "Whop webhook: failed to update Clerk tier");
    res.status(500).json({ error: result.error });
    return;
  }

  req.log.info({ email, tier }, "Whop webhook: tier upgraded successfully");
  res.json({ received: true, email, tier });
});

export default router;
