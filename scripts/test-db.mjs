/**
 * เตรียมฐานข้อมูลสำหรับเทสต์ (ใช้ใน CI)
 *
 * 1) สร้างฐานข้อมูลชื่อลงท้าย "_test" ถ้ายังไม่มี (ผ่าน pg → ต่อฐานข้อมูล postgres)
 * 2) รัน `prisma migrate deploy` โดยชี้ DATABASE_URL ไปที่ฐานข้อมูลเทสต์
 *
 * ใช้: node scripts/test-db.mjs
 * กำหนดที่อยู่ฐานข้อมูลได้ด้วย TEST_DATABASE_URL (แนะนำให้ตั้งใน Jenkins)
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5432/wa_education_test?schema=public';

const parsed = new URL(TEST_DATABASE_URL);
const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ''));

if (!databaseName) {
  console.error('[test-db] TEST_DATABASE_URL ไม่มีชื่อฐานข้อมูล');
  process.exit(1);
}

if (!/_test$/.test(databaseName)) {
  console.error(`[test-db] ปลอดภัยไว้ก่อน: ชื่อฐานข้อมูลต้องลงท้าย "_test" (ได้รับ "${databaseName}")`);
  process.exit(1);
}

// ต่อฐานข้อมูล maintenance (postgres) เพื่อสร้างฐานข้อมูลเป้าหมาย
const adminUrl = new URL(TEST_DATABASE_URL);
adminUrl.pathname = '/postgres';
adminUrl.search = '';

console.log(`[test-db] ตรวจสอบฐานข้อมูล "${databaseName}" ...`);

/**
 * ต่อฐานข้อมูลแบบลองซ้ำ — บน CI บริการ PostgreSQL อาจยังไม่พร้อมตอน stage เริ่ม
 * จึงลองใหม่หลายครั้งก่อนยอมแพ้ แทนที่จะพังทันที
 */
async function connectWithRetry(connectionString, attempts = 5, delayMs = 2000) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const client = new Client({ connectionString });
    try {
      await client.connect();
      return client;
    } catch (error) {
      lastError = error;
      console.warn(`[test-db] เชื่อมต่อไม่สำเร็จ (ครั้งที่ ${attempt}/${attempts}): ${error.message}`);
      try {
        await client.end();
      } catch {
        // ไม่เป็นไร — client ที่ต่อไม่สำเร็จอาจปิดไม่ได้
      }
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastError;
}

let client;
try {
  client = await connectWithRetry(adminUrl.toString());
} catch (error) {
  console.error(`[test-db] เชื่อมต่อฐานข้อมูลไม่สำเร็จหลังลองหลายครั้ง: ${error.message}`);
  process.exit(1);
}

try {
  const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [databaseName]);
  if (exists.rowCount === 0) {
    console.log(`[test-db] สร้างฐานข้อมูล "${databaseName}"`);
    // ชื่อฐานข้อมูลผ่านการตรวจ _test แล้ว — ใส่ double quote เพื่อกันอักขระพิเศษ
    await client.query(`CREATE DATABASE "${databaseName.replace(/"/g, '""')}"`);
  } else {
    console.log(`[test-db] มีฐานข้อมูล "${databaseName}" อยู่แล้ว`);
  }
} finally {
  await client.end();
}

const prismaCli = path.resolve('node_modules/prisma/build/index.js');
if (!existsSync(prismaCli)) {
  console.error(`[test-db] ไม่พบ Prisma CLI ที่ ${prismaCli} — รัน npm ci ก่อน`);
  process.exit(1);
}

console.log('[test-db] รัน prisma migrate deploy ...');
const result = spawnSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
});

process.exit(result.status ?? 1);
