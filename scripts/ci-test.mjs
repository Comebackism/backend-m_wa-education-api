/**
 * รันชุดเทสต์ทั้งหมดสำหรับ CI (Jenkins) — `npm run test:ci`
 *
 * สิ่งที่ต่างจาก `npm test`:
 *   1. สร้างโฟลเดอร์ผลลัพธ์ (reports/, coverage/) ก่อน เพราะ Node จะไม่สร้างให้
 *   2. ออกรายงาน JUnit XML (ให้ Jenkins เก็บผลทดสอบรายเคส) → reports/junit.xml
 *   3. ออกรายงาน coverage แบบ LCOV → coverage/lcov.info
 *      พร้อมแปลง path ในรายงานเป็น "/" เพราะบน Windows Node เขียนเป็น "\"
 *      ซึ่งตัวอ่าน LCOV ของ Jenkins ไม่รับ
 *   4. บังคับ branch coverage ขั้นต่ำ (COVERAGE_MIN_BRANCH, ค่าเริ่มต้น 85%)
 *      เพราะ Coverage plugin ของ Jenkins อ่านค่า branch จาก LCOV ของ Node ไม่ได้
 *   5. ยังพิมพ์ตารางสรุปออก stdout ตามปกติ
 *
 * ใช้ spawnSync เพื่อส่ง argument ตรง ๆ (ไม่ผ่าน shell) จึงไม่ต้องกังวลเรื่อง quoting/glob
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const JUNIT_PATH = 'reports/junit.xml';
const LCOV_PATH = 'coverage/lcov.info';
const MIN_BRANCH = Number(process.env.COVERAGE_MIN_BRANCH ?? 85);

mkdirSync('reports', { recursive: true });
mkdirSync('coverage', { recursive: true });

const args = [
  '--import',
  './tests/setup-env.js',
  '--test',
  '--test-concurrency=1',
  '--experimental-test-coverage',
  '--test-coverage-include=src/**',
  '--test-reporter=spec',
  '--test-reporter=junit',
  '--test-reporter=lcov',
  '--test-reporter-destination=stdout',
  `--test-reporter-destination=${JUNIT_PATH}`,
  `--test-reporter-destination=${LCOV_PATH}`,
  'tests/**/*.test.js',
];

const result = spawnSync(process.execPath, args, { stdio: 'inherit' });

if (result.error) {
  console.error('[ci-test] รันเทสต์ไม่สำเร็จ:', result.error.message);
  process.exit(1);
}

let exitCode = result.status ?? 1;

// แปลง path ใน lcov ให้เป็น forward slash (มาตรฐาน LCOV) + ตรวจ branch coverage
try {
  const lcov = readFileSync(LCOV_PATH, 'utf8');
  const normalized = lcov.replace(/^SF:(.+)$/gm, (_line, filePath) => `SF:${filePath.replace(/\\/g, '/')}`);
  if (normalized !== lcov) {
    writeFileSync(LCOV_PATH, normalized);
    console.log(`[ci-test] แปลง path ใน ${LCOV_PATH} เป็น "/" เรียบร้อย`);
  }

  // รวม BRF/BRH ทุกไฟล์เป็น branch coverage ของทั้งโปรเจกต์
  let branchesFound = 0;
  let branchesHit = 0;
  for (const match of normalized.matchAll(/^BRF:(\d+)$/gm)) branchesFound += Number(match[1]);
  for (const match of normalized.matchAll(/^BRH:(\d+)$/gm)) branchesHit += Number(match[1]);

  if (branchesFound > 0) {
    const percent = (branchesHit / branchesFound) * 100;
    console.log(
      `[ci-test] branch coverage: ${percent.toFixed(2)}% (${branchesHit}/${branchesFound}) — ขั้นต่ำ ${MIN_BRANCH}%`,
    );
    if (percent < MIN_BRANCH) {
      console.error(`[ci-test] branch coverage ต่ำกว่าขั้นต่ำ (${percent.toFixed(2)}% < ${MIN_BRANCH}%)`);
      exitCode = 1;
    }
  } else {
    console.warn('[ci-test] ไม่พบข้อมูล branch (BRF/BRH) ใน lcov — ข้ามการตรวจ branch coverage');
  }
} catch (error) {
  console.warn(`[ci-test] ปรับ path/ตรวจ branch coverage ใน ${LCOV_PATH} ไม่สำเร็จ: ${error.message}`);
}

process.exit(exitCode);
