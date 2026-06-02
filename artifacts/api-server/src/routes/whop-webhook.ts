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
): Promise<{ ok: boolean; userId?: string; error?: string }> {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) return { ok: false, error: "CLERK_SECRET_KEY not configured" };

  // 1. Find the Clerk user by email address
  const searchUrl = `https://api.clerk.com/v1/users?email_address[]=${encodeURIComponent(email)}&limit=1`;
  console.log(`[clerk] Searching for user: ${email}`);
  const searchRes = await fetch(searchUrl, {
    headers: { Authorization: `Bearer ${secretKey}` },
  });
  if (!searchRes.ok) {
    const err = `Clerk user search failed: ${searchRes.status}`;
    console.error(`[clerk] ${err}`);
    return { ok: false, error: err };
  }
  const users = (await searchRes.json()) as { id: string }[];
  if (!users.length) {
    const err = `No Clerk user found for email: ${email}`;
    console.warn(`[clerk] ${err}`);
    return { ok: false, error: err };
  }

  const userId = users[0].id;
  console.log(`[clerk] Found user ${userId} for ${email}`);

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
    const err = `Clerk metadata update failed: ${patchRes.status} — ${body}`;
    console.error(`[clerk] ${err}`);
    return { ok: false, error: err };
  }

  console.log(`[clerk] ✓ Set tier="${tier}" on user ${userId} (${email})`);
  return { ok: true, userId };
}

// ── POST /api/whop-webhook ──────────────────────────────────────────────────
router.post("/whop-webhook", async (req, res) => {
  console.log("[whop-webhook] Received request");

  // ── Signature verification ────────────────────────────────────────────────
  const secret = process.env.WHOP_WEBHOOK_SECRET;
  if (secret) {
    const sig     = req.headers["whop-signature"] as string | undefined;
    const rawBody = (req as unknown as Record<string, unknown>).rawBody as Buffer | undefined;

    console.log(`[whop-webhook] whop-signature header: ${sig ?? "(missing)"}`);

    if (!sig) {
      console.warn("[whop-webhook] Rejected: missing whop-signature header");
      res.status(400).json({ error: "Missing whop-signature header" });
      return;
    }
    if (!rawBody) {
      console.error("[whop-webhook] Rejected: raw body not captured — server misconfiguration");
      res.status(500).json({ error: "Raw body not captured — server misconfiguration" });
      return;
    }
    const valid = verifySignature(rawBody, sig, secret);
    console.log(`[whop-webhook] Signature valid: ${valid}`);
    if (!valid) {
      req.log.warn("Whop webhook: signature mismatch");
      console.warn("[whop-webhook] Rejected: signature mismatch");
      res.status(401).json({ error: "Invalid signature" });
      return;
    }
  } else {
    console.warn("[whop-webhook] WHOP_WEBHOOK_SECRET not set — skipping signature check");
  }

  // ── Parse the Whop event body ─────────────────────────────────────────────
  const body   = req.body as Record<string, unknown>;
  const action = body.action as string | undefined;
  const data   = body.data   as Record<string, unknown> | undefined;

  console.log(`[whop-webhook] action=${action ?? "(missing)"}`);
  console.log(`[whop-webhook] data=${JSON.stringify(data ?? {})}`);

  if (!action || !data) {
    console.warn("[whop-webhook] Rejected: missing action or data");
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
    req.log.info({ action }, "Whop webhook: unhandled event type");
    console.log(`[whop-webhook] Unhandled action "${action}" — acknowledged, no action taken`);
    res.json({ received: true, action, handled: false });
    return;
  }

  console.log(`[whop-webhook] Extracted email=${email ?? "(missing)"} productId=${productId ?? "(missing)"}`);

  if (!email || !productId) {
    req.log.warn({ action, data }, "Whop webhook: could not extract email or productId");
    console.warn("[whop-webhook] Rejected: could not extract email or productId from payload");
    res.status(400).json({ error: "Cannot extract email or productId from event payload" });
    return;
  }

  // Map product → tier
  const productTiers = buildProductTierMap();
  console.log(`[whop-webhook] Product tier map: ${JSON.stringify(productTiers)}`);
  const tier = productTiers[productId];
  if (!tier) {
    req.log.info({ productId }, "Whop webhook: unrecognised productId — ignoring");
    console.warn(`[whop-webhook] productId "${productId}" not in tier map — ignoring`);
    res.json({ received: true, productId, handled: false });
    return;
  }

  console.log(`[whop-webhook] Upgrading ${email} → tier="${tier}"`);

  // Update Clerk publicMetadata
  const result = await clerkSetTier(email, tier);
  if (!result.ok) {
    req.log.error({ email, tier, error: result.error }, "Whop webhook: failed to update Clerk tier");
    console.error(`[whop-webhook] Failed to update Clerk tier: ${result.error}`);
    res.status(500).json({ error: result.error });
    return;
  }

  req.log.info({ email, tier }, "Whop webhook: tier upgraded successfully");
  console.log(`[whop-webhook] ✓ Done — ${email} is now tier="${tier}"`);
  res.json({ received: true, email, tier, userId: result.userId });
});

// ── POST /api/test-webhook ──────────────────────────────────────────────────
// Simulates a Whop purchase without signature verification.
// Body: { email: string, tier: "report" | "pro" }
// Only available in non-production environments.
router.post("/test-webhook", async (req, res) => {
  if (process.env.NODE_ENV === "production") {
    res.status(403).json({ error: "test-webhook is disabled in production" });
    return;
  }

  const { email, tier } = req.body as { email?: string; tier?: string };

  console.log(`[test-webhook] Simulating purchase — email=${email ?? "(missing)"} tier=${tier ?? "(missing)"}`);

  if (!email || !tier) {
    res.status(400).json({ error: "Body must include { email, tier } where tier is 'report' or 'pro'" });
    return;
  }
  if (tier !== "report" && tier !== "pro") {
    res.status(400).json({ error: `Invalid tier "${tier}" — must be "report" or "pro"` });
    return;
  }

  const result = await clerkSetTier(email, tier as "report" | "pro");
  if (!result.ok) {
    console.error(`[test-webhook] Failed: ${result.error}`);
    res.status(500).json({ error: result.error });
    return;
  }

  console.log(`[test-webhook] ✓ ${email} → tier="${tier}" (userId=${result.userId})`);
  res.json({ ok: true, email, tier, userId: result.userId });
});

export default router;
