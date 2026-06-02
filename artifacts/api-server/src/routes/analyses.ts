import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { analysesTable, type InsertAnalysis } from "@workspace/db";
import { desc, eq, and } from "drizzle-orm";
import { z } from "zod";

const router = Router();

// ── Auth guard middleware ──────────────────────────
function requireAuth(req: any, res: any, next: any) {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

// ── GET /api/analyses — fetch all analyses for user ──
router.get("/analyses", requireAuth, async (req, res) => {
  try {
    const { userId } = getAuth(req);
    const rows = await db
      .select()
      .from(analysesTable)
      .where(eq(analysesTable.clerkUserId, userId!))
      .orderBy(desc(analysesTable.createdAt));

    // Normalise to the shape the frontend expects
    const analyses = rows.map((r) => ({
      id: r.id,
      timestamp: r.createdAt.toISOString(),
      overallScore: r.overallScore,
      variables: r.variables,
      biggestKiller: r.biggestKiller,
      biggestKillerDesc: r.biggestKillerDesc,
      potentialGain: r.potentialGain,
      drills: r.drills,
      coachMessage: r.coachMessage,
      handicapEstimate: r.handicapEstimate,
      goal: r.goal,
      coachStyle: r.coachStyle,
    }));

    res.json({ analyses });
  } catch (err) {
    req.log.error(err, "GET /analyses failed");
    res.status(500).json({ error: "Failed to fetch analyses" });
  }
});

// ── POST /api/analyses — save a new analysis ──────
const saveBodySchema = z.object({
  overallScore:     z.number().int(),
  variables:        z.record(z.string(), z.number()),
  biggestKiller:    z.string().optional(),
  biggestKillerDesc: z.string().optional(),
  potentialGain:    z.string().optional(),
  drills:           z.array(z.any()).optional(),
  coachMessage:     z.string().optional(),
  handicapEstimate: z.any().optional(),
  goal:             z.string().optional(),
  coachStyle:       z.string().optional(),
});

router.post("/analyses", requireAuth, async (req, res) => {
  const parsed = saveBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }

  try {
    const { userId } = getAuth(req);
    const insert: InsertAnalysis = {
      clerkUserId:      userId!,
      overallScore:     parsed.data.overallScore,
      variables:        parsed.data.variables,
      biggestKiller:    parsed.data.biggestKiller ?? null,
      biggestKillerDesc: parsed.data.biggestKillerDesc ?? null,
      potentialGain:    parsed.data.potentialGain ?? null,
      drills:           parsed.data.drills ?? null,
      coachMessage:     parsed.data.coachMessage ?? null,
      handicapEstimate: parsed.data.handicapEstimate ?? null,
      goal:             parsed.data.goal ?? null,
      coachStyle:       parsed.data.coachStyle ?? null,
    };

    const [saved] = await db.insert(analysesTable).values(insert).returning();
    res.status(201).json({ id: saved.id, timestamp: saved.createdAt.toISOString() });
  } catch (err) {
    req.log.error(err, "POST /analyses failed");
    res.status(500).json({ error: "Failed to save analysis" });
  }
});

// ── DELETE /api/analyses/:id — remove one analysis ──
router.delete("/analyses/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  try {
    const { userId } = getAuth(req);
    // Only delete rows owned by this user (ownership enforced via AND condition)
    await db
      .delete(analysesTable)
      .where(
        and(eq(analysesTable.id, id), eq(analysesTable.clerkUserId, userId!))
      );
    res.status(204).end();
  } catch (err) {
    req.log.error(err, "DELETE /analyses/:id failed");
    res.status(500).json({ error: "Failed to delete analysis" });
  }
});

export default router;
