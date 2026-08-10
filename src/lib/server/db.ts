import pg from 'pg';
import { env } from '$env/dynamic/private';

/**
 * Lazily-created Postgres pool. Connection string comes from the DATABASE_URL
 * env var (set on the systemd service by the homelab config). When it is not
 * set the app has no server DB and API routes report 503 so the client falls
 * back to localStorage.
 */
let pool: pg.Pool | null = null;
let schemaReady: Promise<void> | null = null;

export function hasDatabase(): boolean {
  return !!env.DATABASE_URL;
}

export function getPool(): pg.Pool {
  if (!pool) {
    if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
    pool = new pg.Pool({ connectionString: env.DATABASE_URL });
  }
  return pool;
}

/** Create the projects table on first use (idempotent). */
export function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = getPool()
      .query(`
        CREATE TABLE IF NOT EXISTS projects (
          id text PRIMARY KEY,
          name text NOT NULL DEFAULT '',
          data jsonb NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );
      `)
      .then(() => {})
      .catch((e) => {
        // Reset so a later request can retry (e.g. DB came up after start).
        schemaReady = null;
        throw e;
      });
  }
  return schemaReady;
}
