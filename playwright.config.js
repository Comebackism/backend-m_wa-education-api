import { defineConfig } from '@playwright/test';

/**
 * Playwright — ทดสอบ API ผ่าน HTTP จริง (ไม่เปิดเบราว์เซอร์)
 *
 * ใช้สำหรับงานที่อยากยิงคำขอ "เหมือนผู้ใช้จริง" ออกไปนอกโปรเซสของเทสต์
 * (เช่น ผ่าน network stack จริง, ดู header/status ดิบ, ยิงพร้อมกันหลายคำขอ)
 *
 * จุดต่างจากเทสต์ node:test ที่มีอยู่ (`tests/integration/*.test.js`):
 *   - node:test เปิด Express ในโปรเซสเดียวกับเทสต์ (ง่าย เร็ว เก็บ coverage ได้)
 *   - Playwright เปิดเซิร์ฟเวอร์เป็นโปรเซสแยกผ่าน webServer แล้วยิงด้วย request context
 *     → เหมาะเป็น "ชั้นบนสุด" ที่ตรวจพฤติกรรมจากมุมคนนอก (black-box)
 *
 * หมายเหตุ
 *   - ไม่ต้อง `npx playwright install` เพราะไม่ได้เปิดเบราว์เซอร์เลย (โหมด API ล้วน)
 *     ทั้ง playwright/playwright-core ไม่มี install script และไม่ดาวน์โหลดเบราว์เซอร์ตอน `npm ci`
 *   - เทสต์แชร์ฐานข้อมูลเทสต์ร่วมกัน (TRUNCATE) จึงบังคับ workers: 1
 *   - จงใจไม่ให้ `npm test`/`test:ci` เก็บไฟล์ชุดนี้ (คนละ runner, ไม่มี coverage)
 *     ถ้าต้องการรันใช้ `npm run test:api`
 */
const PORT = Number(process.env.API_TEST_PORT ?? 4100);
const baseURL = process.env.API_BASE_URL ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './tests/api',
  testMatch: '**/*.spec.js',

  // ฐานข้อมูลเทสต์ใช้ร่วมกันและถูกล้างก่อนทุกเคส — ห้ามรันซ้อน
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,

  timeout: 30_000,
  expect: { timeout: 5_000 },

  // ออกรายงาน JUnit XML เสมอ เพื่อให้ Jenkins (junit step) อ่านผลรายเคสได้
  // → reports/playwright-junit.xml (โฟลเดอร์ reports/ ถูก .gitignore ไว้แล้ว)
  reporter: [['list'], ['junit', { outputFile: 'reports/playwright-junit.xml' }]],

  use: {
    baseURL,
    extraHTTPHeaders: { Accept: 'application/json' },
  },

  webServer: {
    // ต้อง import setup-env ก่อน เพื่อบังคับ NODE_ENV=test + DATABASE_URL ที่ลงท้าย "_test"
    command: 'node --import ./tests/setup-env.js scripts/api-test-server.mjs',
    url: `${baseURL}/health`,
    env: { PORT: String(PORT) },
    timeout: 60_000,
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
