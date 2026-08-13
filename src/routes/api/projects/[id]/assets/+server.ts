import { json, error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { and, eq } from "drizzle-orm";
import { hasDatabase, getDb } from "$lib/server/db/client";
import { assets } from "$lib/server/db/schema";

/** List a project's assets (meta only — data blobs can be megabytes). */
export const GET: RequestHandler = async ({ params, url }) => {
  if (!hasDatabase) error(503, "Database not configured");
  const id = url.searchParams.get("assetId");
  if (id) {
    const rows = await getDb()
      .select()
      .from(assets)
      .where(and(eq(assets.projectId, params.id), eq(assets.id, id)))
      .limit(1);
    if (!rows.length) error(404, "Not found");
    return json(rows[0]);
  }
  const rows = await getDb()
    .select({ id: assets.id, kind: assets.kind, meta: assets.meta, createdAt: assets.createdAt })
    .from(assets)
    .where(eq(assets.projectId, params.id));
  return json(rows);
};

/** Store one asset: { id, kind, meta, data }. */
export const POST: RequestHandler = async ({ params, request }) => {
  if (!hasDatabase) error(503, "Database not configured");
  const body = await request.json();
  if (!body?.id || !body?.kind) error(400, "id and kind are required");
  await getDb()
    .insert(assets)
    .values({ id: body.id, projectId: params.id, kind: body.kind, meta: body.meta ?? {}, data: body.data ?? null })
    .onConflictDoUpdate({
      target: assets.id,
      set: { kind: body.kind, meta: body.meta ?? {}, data: body.data ?? null },
    });
  return json({ ok: true });
};
