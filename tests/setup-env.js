/**
 * ตั้งค่า environment สำหรับเทสต์ "ก่อน" โมดูลของแอปจะถูก import
 *
 * โหลดด้วย `node --import ./tests/setup-env.js ...`
 * (ถ้าตั้งค่าหลัง import จะไม่ทัน เพราะ config/env.js ตรวจค่าและ lib/prisma.js
 *  สร้าง connection pool ทันทีที่ถูก import)
 *
 * หลักความปลอดภัย:
 * - บังคับ NODE_ENV=test (ปิด morgan, ใช้เพดาน rate limit ของ dev/test)
 * - บังคับ DATABASE_URL ให้ชี้ไปฐานข้อมูลที่ชื่อลงท้าย "_test" เท่านั้น
 *   (dotenv ที่อยู่ใน config/env.js จะไม่ทับค่าที่ตั้งไว้แล้ว)
 */
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5432/wa_education_test?schema=public';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = TEST_DATABASE_URL;

process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-0123456789abcdef';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-0123456789abcdef';
process.env.JWT_ACCESS_EXPIRES_IN ??= '15m';
process.env.JWT_REFRESH_EXPIRES_IN ??= '7d';

// bcrypt ถูกใช้หลายสิบครั้งต่อไฟล์ — ลดรอบเพื่อให้เทสต์เร็ว (production ใช้ค่าจริงใน .env)
process.env.BCRYPT_ROUNDS = '4';

process.env.CORS_ORIGIN ??= 'http://localhost:5173';
process.env.DOCS_ENABLED = 'false';
process.env.RATE_LIMIT_DISABLED = 'true';
