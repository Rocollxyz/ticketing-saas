import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/ticketing",
  },
  // verbose para ver el SQL generado; strict pide confirmación antes de aplicar.
  verbose: true,
  strict: true,
});
