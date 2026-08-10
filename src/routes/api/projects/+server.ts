import { json, error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { desc } from "drizzle-orm";
import { hasDatabase, getDb } from "$lib/server/db/client";
import { projects } from "$lib/server/db/schema";

/** List project summaries, newest first. */
export const GET: RequestHandler = async () => {
  if (!hasDatabase) error(503, "Database not configured");
  const rows = await getDb()
    .select({ id: projects.id, name: projects.name, updatedAt: projects.updatedAt })
    .from(projects)
    .orderBy(desc(projects.updatedAt));
  return json(rows.map((r) => ({ id: r.id, name: r.name, updatedAt: r.updatedAt.toISOString() })));
};

/** Upsert a full project. */
export const POST: RequestHandler = async ({ request }) => {
  if (!hasDatabase) error(503, "Database not configured");
  const project = await request.json();
  if (!project?.id) error(400, "Missing project id");
  await getDb()
    .insert(projects)
    .values({ id: project.id, name: project.name ?? "", data: project })
    .onConflictDoUpdate({
      target: projects.id,
      set: { name: project.name ?? "", data: project, updatedAt: new Date() },
    });
  return json({ ok: true });
};
