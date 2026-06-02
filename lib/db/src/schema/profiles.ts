import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const profilesTable = pgTable("profiles", {
  id:           serial("id").primaryKey(),
  clerkUserId:  text("clerk_user_id").notNull().unique(),
  goal:         text("goal"),
  averageScore: text("average_score"),
  years:        text("years"),
  coachStyle:   text("coach_style"),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Profile = typeof profilesTable.$inferSelect;
