// Project store — one row per saved floor-plan project. The whole Project
// object is kept in a jsonb column so the schema stays stable as the model
// evolves; id/name/updated_at are mirrored out for cheap listing.
import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const projects = pgTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull().default(""),
  data: jsonb("data").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ProjectRow = typeof projects.$inferSelect;
export type NewProjectRow = typeof projects.$inferInsert;

// Bulky per-project uploads (raw RTK survey point files, …) kept out of the
// project blob so every save doesn't round-trip megabytes of survey data.
export const assets = pgTable("assets", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  kind: text("kind").notNull(), // e.g. 'rtk_points'
  meta: jsonb("meta").notNull(), // filename, format, point count, bbox…
  data: jsonb("data").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AssetRow = typeof assets.$inferSelect;
