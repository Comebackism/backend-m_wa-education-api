import { prisma } from '../../src/lib/prisma.js';

/**
 * ตัวช่วยจัดการฐานข้อมูลสำหรับเทสต์
 * - ล้างข้อมูลได้เฉพาะฐานข้อมูลที่ชื่อลงท้าย "_test" เท่านั้น
 * - ถ้า DATABASE_URL ไม่ใช่ฐานข้อมูลเทสต์ จะโยน error ทันที (กันลบข้อมูลจริง)
 */

const TEST_DB_PATTERN = /\/[^/?]*_test(\?|$)/;

export function databaseUrl() {
  return process.env.DATABASE_URL ?? '';
}

export function isTestDatabase(url = databaseUrl()) {
  return TEST_DB_PATTERN.test(url);
}

export function assertTestDatabase() {
  if (!isTestDatabase()) {
    throw new Error(
      `ปฏิเสธการล้างข้อมูล: DATABASE_URL ต้องเป็นฐานข้อมูลเทสต์ (ชื่อลงท้าย _test) แต่ได้รับ "${databaseUrl()}"`,
    );
  }
}

const TABLES = [
  'answers',
  'submissions',
  'exam_assignments',
  'grade_cutoffs',
  'choices',
  'questions',
  'exams',
  'enrollments',
  'classrooms',
  'courses',
  'refresh_tokens',
  'users',
];

/** ล้างทุกตาราง (ใช้ beforeEach ของเทสต์ที่แตะฐานข้อมูล) */
export async function resetDatabase() {
  assertTestDatabase();
  const list = TABLES.map((table) => `"${table}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

/** ปิด connection pool ท้ายไฟล์เทสต์ (ไม่ให้ process ค้าง) */
export function disconnectDatabase() {
  return prisma.$disconnect();
}

export { prisma };
