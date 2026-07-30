import { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';

/**
 * Single source of truth for the database connection.
 *
 * Read by the Nest app (app.module.ts), the migration CLI data source
 * (data-source.ts), and the seed script — so DB credentials live in exactly
 * one place. Entities and migrations are wired up by each consumer (the app
 * uses `autoLoadEntities`, the CLI/seed load them by glob).
 *
 * `synchronize` is intentionally NOT part of this object and is never enabled:
 * the schema is owned by migrations. See the "Database migrations" section of
 * the README.
 */
export function databaseConnectionOptions(): PostgresConnectionOptions {
  return {
    type: 'postgres',
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    username: process.env.DB_USER ?? 'hotello',
    password: process.env.DB_PASSWORD ?? 'hotello',
    database: process.env.DB_NAME ?? 'hotello',
    synchronize: false,
  };
}
