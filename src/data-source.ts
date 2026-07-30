import 'reflect-metadata';
import { config } from 'dotenv';
import { DataSource } from 'typeorm';
import { databaseConnectionOptions } from './config/database.config';

// The CLI runs outside Nest, so load .env ourselves before reading env vars.
config();

/**
 * DataSource used by the TypeORM CLI for all migration commands
 * (`npm run migration:*`) and by the seed script.
 *
 * Entities and migrations are loaded by glob so new modules are picked up
 * automatically — no manual registration when a domain is added. The globs
 * match both `.ts` (ts-node, dev) and `.js` (compiled) so the same file works
 * before and after `nest build`.
 */
export const AppDataSource = new DataSource({
  ...databaseConnectionOptions(),
  entities: [__dirname + '/**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
});
