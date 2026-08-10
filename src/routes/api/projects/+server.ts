import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPool, ensureSchema, hasDatabase } from '$lib/server/db';

/** List project summaries, newest first. */
export const GET: RequestHandler = async () => {
  if (!hasDatabase()) error(503, 'Database not configured');
  await ensureSchema();
  const { rows } = await getPool().query(
    `SELECT id, name, updated_at FROM projects ORDER BY updated_at DESC`
  );
  return json(
    rows.map((r) => ({ id: r.id, name: r.name, updatedAt: new Date(r.updated_at).toISOString() }))
  );
};

/** Upsert a full project. */
export const POST: RequestHandler = async ({ request }) => {
  if (!hasDatabase()) error(503, 'Database not configured');
  await ensureSchema();
  const project = await request.json();
  if (!project?.id) error(400, 'Missing project id');
  await getPool().query(
    `INSERT INTO projects (id, name, data, created_at, updated_at)
     VALUES ($1, $2, $3, now(), now())
     ON CONFLICT (id) DO UPDATE
       SET name = EXCLUDED.name, data = EXCLUDED.data, updated_at = now()`,
    [project.id, project.name ?? '', project]
  );
  return json({ ok: true });
};
