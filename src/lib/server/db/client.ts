// Drizzle/Postgres client. Connects via DATABASE_URL — the deploy environment
// uses Unix-socket peer auth against the local Postgres (no password), with
// PGHOST=/run/postgresql set on the service. When DATABASE_URL is unset there
// is no server DB and the client falls back to null so API routes report 503
// and the browser uses localStorage instead.
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "$env/dynamic/private";
import * as schema from "./schema";

const connectionString = env.DATABASE_URL;

export const hasDatabase = !!connectionString;

const queryClient = connectionString ? postgres(connectionString) : null;

const _db = queryClient ? drizzle(queryClient, { schema }) : null;

/** Return the Drizzle db, or throw if no DATABASE_URL is configured. */
export function getDb() {
  if (!_db) throw new Error("DATABASE_URL is not set");
  return _db;
}
