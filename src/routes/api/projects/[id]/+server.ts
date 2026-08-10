import { json, error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { eq } from "drizzle-orm";
import { hasDatabase, getDb } from "$lib/server/db/client";
import { projects } from "$lib/server/db/schema";

/** Load one full project by id. */
export const GET: RequestHandler = async ({ params }) => {
  if (!hasDatabase) error(503, "Database not configured");
  const rows = await getDb()
    .select({ data: projects.data })
    .from(projects)
    .where(eq(projects.id, params.id))
    .limit(1);
  if (!rows.length) error(404, "Not found");
  return json(rows[0].data);
};

/** Delete one project by id. */
export const DELETE: RequestHandler = async ({ params }) => {
  if (!hasDatabase) error(503, "Database not configured");
  await getDb().delete(projects).where(eq(projects.id, params.id));
  return json({ ok: true });
};
