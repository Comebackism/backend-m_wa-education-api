import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

/**
 * Prisma ORM v7 config.
 * The database URL no longer lives in `schema.prisma` — the CLI reads it here,
 * while the app passes it to the `@prisma/adapter-pg` driver adapter.
 *
 * @see https://www.prisma.io/docs/orm/reference/prisma-config-reference
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'node prisma/seed.js',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
