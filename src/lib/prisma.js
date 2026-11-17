import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { env, isProduction } from '../config/env.js';

/**
 * Prisma ORM v7 ต้องต่อผ่าน driver adapter (`@prisma/adapter-pg` ใช้ node-postgres)
 * — connection string ไม่ได้อยู่ใน schema.prisma แล้ว แต่ส่งเข้ามาที่นี่
 */
const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

export const prisma = new PrismaClient({
  adapter,
  log: isProduction ? ['warn', 'error'] : ['warn', 'error'],
});
