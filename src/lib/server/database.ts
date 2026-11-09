import 'server-only';

import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '@/generated/prisma/client';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const globalDatabase = globalThis as unknown as { database?: PrismaClient };
export const database =
  globalDatabase.database ??
  new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
if (process.env.NODE_ENV !== 'production') globalDatabase.database = database;
