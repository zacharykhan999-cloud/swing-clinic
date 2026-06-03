import { Router } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { db, analysesTable, profilesTable } from "@workspace/db";
import { sql, desc, count, avg } from "drizzle-orm";

const ADMIN_EMAIL = "zacharykhan894@gmail.com";

const router = Router();

async function requireAdmin(req: any, res: any, next: any) {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const user = await clerkClient.users.getUser(userId);
    const email = user.emailAddresses
      .find((e: { id: string }) => e.id === user.primaryEmailAddressId)
      ?.emailAddress ?? "";
    if (email.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  } catch {
    res.status(401).json({ error: "Unauthorized" });
  }
}

router.get("/admin/stats", requireAdmin, async (req, res) => {
  try {
    // ── Analyses counts ──────────────────────────────
    const [allTime]  = await db.select({ n: count() }).from(analysesTable);
    const [today]    = await db.select({ n: count() }).from(analysesTable)
      .where(sql`${analysesTable.createdAt} >= CURRENT_DATE`);
    const [thisWeek] = await db.select({ n: count() }).from(analysesTable)
      .where(sql`${analysesTable.createdAt} >= date_trunc('week', NOW())`);

    // ── Average score ────────────────────────────────
    const [avgRow] = await db.select({ avg: avg(analysesTable.overallScore) }).from(analysesTable);

    // ── Top 5 performance killers ────────────────────
    const killerRows = await db
      .select({ killer: analysesTable.biggestKiller, n: count() })
      .from(analysesTable)
      .where(sql`${analysesTable.biggestKiller} IS NOT NULL`)
      .groupBy(analysesTable.biggestKiller)
      .orderBy(desc(count()))
      .limit(5);

    // ── Recent 20 analyses ───────────────────────────
    const recent = await db
      .select({
        id:           analysesTable.id,
        createdAt:    analysesTable.createdAt,
        clerkUserId:  analysesTable.clerkUserId,
        overallScore: analysesTable.overallScore,
        biggestKiller: analysesTable.biggestKiller,
        goal:         analysesTable.goal,
      })
      .from(analysesTable)
      .orderBy(desc(analysesTable.createdAt))
      .limit(20);

    // ── Unique users (from profiles) ─────────────────
    const [usersRow] = await db
      .select({ n: sql<number>`COUNT(DISTINCT clerk_user_id)` })
      .from(profilesTable);

    // ── Unique users with at least one analysis ──────
    const [analyseUsersRow] = await db
      .select({ n: sql<number>`COUNT(DISTINCT clerk_user_id)` })
      .from(analysesTable);

    // ── Resolve recent user emails via Clerk ─────────
    const userIds = [...new Set(recent.map((r) => r.clerkUserId))];
    const emailMap: Record<string, string> = {};
    if (userIds.length > 0) {
      try {
        const result = await clerkClient.users.getUserList({ userId: userIds, limit: 100 });
        for (const u of result.data) {
          const email = u.emailAddresses
            .find((e: { id: string }) => e.id === u.primaryEmailAddressId)
            ?.emailAddress ?? "";
          emailMap[u.id] = email;
        }
      } catch { /* degrade gracefully */ }
    }

    // ── Tier / revenue from Clerk metadata ───────────
    let totalClerkUsers = 0, reportCount = 0, proCount = 0;
    try {
      totalClerkUsers = await clerkClient.users.getCount();
      // Fetch up to 500 users to count tiers
      const paidResult = await clerkClient.users.getUserList({ limit: 500 });
      for (const u of paidResult.data) {
        const tier = (u.publicMetadata as Record<string, unknown>)?.tier;
        if (tier === "report") reportCount++;
        if (tier === "pro")    proCount++;
      }
    } catch { /* degrade gracefully */ }

    const paidTotal = reportCount + proCount;
    const freeUsers = Math.max(0, totalClerkUsers - paidTotal);
    const conversionRate = totalClerkUsers > 0
      ? ((paidTotal / totalClerkUsers) * 100).toFixed(1)
      : "0.0";

    res.json({
      analyses: {
        allTime:  Number(allTime.n),
        today:    Number(today.n),
        thisWeek: Number(thisWeek.n),
      },
      avgScore: avgRow.avg ? parseFloat(Number(avgRow.avg).toFixed(1)) : null,
      topKillers: killerRows.map((r) => ({ killer: r.killer, count: Number(r.n) })),
      recent: recent.map((r) => ({
        id:           r.id,
        timestamp:    r.createdAt.toISOString(),
        email:        emailMap[r.clerkUserId] || `user_${r.clerkUserId.slice(-8)}`,
        overallScore: r.overallScore,
        biggestKiller: r.biggestKiller,
        goal:         r.goal,
      })),
      users: {
        total:          totalClerkUsers || Number(usersRow?.n ?? analyseUsersRow?.n ?? 0),
        withAnalyses:   Number(analyseUsersRow?.n ?? 0),
        free:           freeUsers,
        report:         reportCount,
        pro:            proCount,
        paidTotal,
        conversionRate,
      },
    });
  } catch (err) {
    req.log.error(err, "GET /admin/stats failed");
    res.status(500).json({ error: "Failed to fetch admin stats" });
  }
});

export default router;
