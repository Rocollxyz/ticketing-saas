import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index";

const connectionString =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/ticketing";

// Cliente postgres-js. max:1 por simplicidad en desarrollo; en producción se ajusta
// y debe convivir con el patrón de SET LOCAL por transacción (RLS, §7).
const queryClient = postgres(connectionString);

export const db = drizzle(queryClient, { schema });
export { schema };
