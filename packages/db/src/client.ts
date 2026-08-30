import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

import * as schema from "./schema";

const connectionString = process.env.POSTGRES_URL;
if (!connectionString) {
  throw new Error("POSTGRES_URL is not set");
}

export const dbPool = new pg.Pool({
  connectionString,
  max: 15,
  idleTimeoutMillis: 20_000,
  connectionTimeoutMillis: 15_000,
});

export const db = drizzle({
  client: dbPool,
  schema,
  casing: "snake_case",
});
