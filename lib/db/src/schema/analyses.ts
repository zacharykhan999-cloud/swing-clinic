import { pgTable, serial, text, integer, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const analysesTable = pgTable("analyses", {
  id:               serial("id").primaryKey(),
  clerkUserId:      text("clerk_user_id").notNull(),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  overallScore:     integer("overall_score").notNull(),
  variables:        jsonb("variables").notNull(),
  biggestKiller:    text("biggest_killer"),
  biggestKillerDesc: text("biggest_killer_desc"),
  potentialGain:    text("potential_gain"),
  drills:           jsonb("drills"),
  coachMessage:     text("coach_message"),
  handicapEstimate: jsonb("handicap_estimate"),
  goal:             text("goal"),
  coachStyle:       text("coach_style"),
});

export const insertAnalysisSchema = createInsertSchema(analysesTable).omit({
  id: true,
  createdAt: true,
});

export type InsertAnalysis = z.infer<typeof insertAnalysisSchema>;
export type Analysis = typeof analysesTable.$inferSelect;
