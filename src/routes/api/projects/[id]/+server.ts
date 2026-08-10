import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPool, ensureSchema, hasDatabase } from '$lib/server/db';

/** Load one full project by id. */
export const GET: RequestHandler = async ({ params }) => {
  if (!hasDatabase()) error(503, 'Database not configured');
  await ensureSchema();
  const { rows } = await getPool().query(`SELECT data FROM projects WHERE id = $1`, [params.id]);
  if (!rows.length) error(404, 'Not found');
  return json(rows[0].data);
};

/** Delete one project by id. */
export const DELETE: RequestHandler = async ({ params }) => {
  if (!hasDatabase()) error(503, 'Database not configured');
  await ensureSchema();
  await getPool().query(`DELETE FROM projects WHERE id = $1`, [params.id]);
  return json({ ok: true });
};
