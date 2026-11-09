import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as ops from "./schema";
import * as shared from "./shared";

// PGlite (npm run db:local) solo soporta una conexión a la vez: usa DB_POOL_MAX=1 con él.
const max = Number(process.env.DB_POOL_MAX ?? 5);

function createClient() {
  const socketPath = process.env.DB_SOCKET_PATH; // Cloud Run: /cloudsql/PROJECT:REGION:INSTANCE
  if (socketPath) {
    return postgres({
      host: socketPath,
      database: process.env.DB_NAME,
      username: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      max,
    });
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Missing environment variable: DATABASE_URL");
  return postgres(url, { max });
}

const globalForDb = globalThis as unknown as { __zioraOpsSql?: ReturnType<typeof postgres> };
const client = globalForDb.__zioraOpsSql ?? createClient();
if (process.env.NODE_ENV !== "production") globalForDb.__zioraOpsSql = client;

export const db = drizzle(client, { schema: { ...shared, ...ops } });
export type Db = typeof db;
/** Base o transacción: para funciones de dominio que se componen dentro de db.transaction(). */
export type Dbx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];
