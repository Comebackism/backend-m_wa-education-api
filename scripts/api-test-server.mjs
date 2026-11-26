/**
 * เซิร์ฟเวอร์สำหรับ Playwright API test — ใช้ใน playwright.config.js (webServer)
 *
 * ต้องรันด้วย:
 *   node --import ./tests/setup-env.js scripts/api-test-server.mjs
 * เพื่อบังคับ NODE_ENV=test และ DATABASE_URL ให้ชี้ฐานข้อมูลที่ลงท้าย "_test"
 * "ก่อน" โมดูลของแอปจะถูก import (config/env.js ตรวจค่าและ lib/prisma.js สร้าง pool ทันที)
 *
 * ไฟล์นี้เป็นของเทสต์เท่านั้น — ไม่ใช้ใน production (`npm start` ใช้ src/server.js)
 */
import { createApp } from '../src/app.js';

if (process.env.NODE_ENV !== 'test') {
  console.error('[api-test-server] ปฏิเสธการรัน: ต้องเป็นโหมดเทสต์ (NODE_ENV=test)');
  process.exit(1);
}

if (!/\/[^/?]*_test(\?|$)/.test(process.env.DATABASE_URL ?? '')) {
  console.error('[api-test-server] ปฏิเสธการรัน: DATABASE_URL ต้องเป็นฐานข้อมูลที่ลงท้าย "_test"');
  process.exit(1);
}

const port = Number(process.env.PORT ?? 4100);
const server = createApp().listen(port, '127.0.0.1', () => {
  console.log(`[api-test-server] listening on http://127.0.0.1:${port}`);
});

const shutdown = () => {
  server.close(() => process.exit(0));
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
