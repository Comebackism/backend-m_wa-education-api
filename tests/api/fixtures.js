/**
 * Fixture กลางของชุดเทสต์ API (Playwright)
 *
 * - import '../setup-env.js' ต้องอยู่บรรทัดแรก เพื่อให้ NODE_ENV/DATABASE_URL ถูกตั้ง
 *   ก่อนโมดูลของแอป (config/env.js, lib/prisma.js) ถูกโหลด — ESM ประเมิน dependency
 *   ตามลำดับที่ import
 * - dbReset: ล้างฐานข้อมูลเทสต์ก่อนทุกเคส (auto, เฉพาะ DB ที่ลงท้าย "_test")
 * - dbTeardown: ปิด connection pool เมื่อ worker จบ (กันโปรเซสค้าง)
 */
import '../setup-env.js';
import { expect, test as base } from '@playwright/test';
import { disconnectDatabase, resetDatabase } from '../helpers/db.js';

export const test = base.extend({
  dbReset: [
    async ({}, use) => {
      await resetDatabase();
      await use();
    },
    { auto: true },
  ],

  dbTeardown: [
    async ({}, use) => {
      await use();
      await disconnectDatabase();
    },
    { auto: true, scope: 'worker' },
  ],
});

export { expect };

/** ค่า header สำหรับเรียกเส้นทางที่ต้องล็อกอิน */
export function bearer(token) {
  return { Authorization: `Bearer ${token}` };
}

/** สมัครครูใหม่แล้วคืนผลตอบกลับ (201) */
export async function registerTeacher(request, email, fullName = 'ครูทดสอบ') {
  const response = await request.post('/api/auth/teacher/register', {
    data: { email, password: 'Password123!', fullName },
  });
  expect(response.status()).toBe(201);
  return response.json();
}
