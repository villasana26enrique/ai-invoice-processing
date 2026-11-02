import "server-only";
import { Pool, types } from "pg";

// Ids are bigint: read them as numbers (safe up to 2^53). Amounts (numeric) stay text so no cent is lost.
types.setTypeParser(types.builtins.INT8, (value) => Number(value));

// One pool per server process. It connects as invoice_app: it can read the tables, but data only changes
// through the database functions, which validate.
const globalForPool = globalThis as unknown as { pool?: Pool };

export const pool =
  globalForPool.pool ??
  new Pool({
    host: process.env.POSTGRES_HOST ?? "postgres",
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    database: process.env.POSTGRES_DB,
    user: "invoice_app",
    password: process.env.INVOICE_APP_PASSWORD,
    max: 5,
  });

// Next.js reloads modules in development; keep a single pool instead of leaking one per reload
if (process.env.NODE_ENV !== "production") globalForPool.pool = pool;

// Calls a database function that returns jsonb ({ ok, message, ... }) and returns that object
export async function callFunction<T>(sql: string, params: unknown[]): Promise<T> {
  const { rows } = await pool.query<{ r: T }>(sql, params);
  return rows[0].r;
}
