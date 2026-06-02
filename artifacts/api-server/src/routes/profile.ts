import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db, profilesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod";

const router = Router();

function requireAuth(req: any, res: any, next: any) {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  next();
}

// ── GET /api/profile — fetch saved profile ─────────
router.get("/profile", requireAuth, async (req, res) => {
  try {
    const { userId } = getAuth(req);
    const [row] = await db
      .select()
      .from(profilesTable)
      .where(eq(profilesTable.clerkUserId, userId!))
      .limit(1);

    if (!row) { res.json({ profile: null }); return; }

    res.json({
      profile: {
        goal:         row.goal,
        averageScore: row.averageScore,
        years:        row.years,
        coachStyle:   row.coachStyle,
      },
    });
  } catch (err) {
    req.log.error(err, "GET /profile failed");
    res.status(500).json({ error: "Failed to fetch profile" });
  }
});

// ── PUT /api/profile — upsert profile ──────────────
const profileBodySchema = z.object({
  goal:         z.string().optional(),
  averageScore: z.string().optional(),
  years:        z.string().optional(),
  coachStyle:   z.string().optional(),
});

router.put("/profile", requireAuth, async (req, res) => {
  const parsed = profileBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }

  try {
    const { userId } = getAuth(req);
    const values = {
      clerkUserId:  userId!,
      goal:         parsed.data.goal         ?? null,
      averageScore: parsed.data.averageScore ?? null,
      years:        parsed.data.years        ?? null,
      coachStyle:   parsed.data.coachStyle   ?? null,
      updatedAt:    new Date(),
    };

    await db
      .insert(profilesTable)
      .values(values)
      .onConflictDoUpdate({
        target: profilesTable.clerkUserId,
        set: {
          goal:         values.goal,
          averageScore: values.averageScore,
          years:        values.years,
          coachStyle:   values.coachStyle,
          updatedAt:    values.updatedAt,
        },
      });

    res.json({ ok: true });
  } catch (err) {
    req.log.error(err, "PUT /profile failed");
    res.status(500).json({ error: "Failed to save profile" });
  }
});

export default router;
