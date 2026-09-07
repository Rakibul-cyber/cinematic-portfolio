import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

// Prisma CLI commands run outside Next.js, so local environment files are
// loaded explicitly. `.env.local` holds the developer's real credentials and is
// never committed.
loadEnv({ path: [".env.local", ".env"], quiet: true });

// Schema changes and migrations must use Neon's direct (unpooled) endpoint.
// PgBouncer in transaction mode does not support the session-level statements
// Prisma Migrate issues, and advisory locks would not be held across statements.
const migrationDatabaseUrl =
  process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: migrationDatabaseUrl,
  },
});
