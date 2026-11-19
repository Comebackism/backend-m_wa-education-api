/**
 * ตรวจความพร้อมของเครื่องก่อนรัน CI — `node scripts/ci-check.mjs`
 *
 * ใช้เป็นด่านแรกใน Jenkinsfile เพื่อ "พังเร็ว" พร้อมข้อความที่อ่านรู้เรื่อง
 * ถ้าเครื่อง agent ยังไม่พร้อม (เช่น Node เก่าเกินไป)
 *
 * เกณฑ์: Node.js ต้องไม่ต่ำกว่าเวอร์ชันใน `.nvmrc` (แหล่งความจริงเดียวของโปรเจกต์)
 * ถ้าอ่าน `.nvmrc` ไม่ได้จะถอยไปใช้ค่าสำรองด้านล่าง
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FALLBACK_VERSION = '24.18.0';
const NVMRC_PATH = fileURLToPath(new URL('../.nvmrc', import.meta.url));

// ใช้ shell เพราะบน Windows `npm` เป็น npm.cmd (execFile เรียกตรง ๆ ไม่ได้)
function commandVersion(command) {
  try {
    return execSync(`${command} -v`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

/** อ่านเวอร์ชันขั้นต่ำจาก .nvmrc — รองรับบรรทัดที่มีแต่เลข หรือนำหน้าด้วย v */
function requiredNodeVersion() {
  try {
    const raw = readFileSync(NVMRC_PATH, 'utf8').trim();
    const match = raw.match(/\d+\.\d+\.\d+/);
    if (match) return match[0];
  } catch {
    // ปล่อยให้ใช้ค่าสำรองด้านล่าง
  }
  return FALLBACK_VERSION;
}

function isOlderThan(actual, minimum) {
  const a = actual.split('.').map(Number);
  const b = minimum.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    if ((a[i] ?? 0) > (b[i] ?? 0)) return false;
    if ((a[i] ?? 0) < (b[i] ?? 0)) return true;
  }
  return false;
}

const required = requiredNodeVersion();
const nodeVersion = process.versions.node;
const npmVersion = commandVersion('npm');
const gitVersion = commandVersion('git');

console.log(`[ci-check] Node.js : v${nodeVersion} (ต้องการ >= ${required} ตาม .nvmrc)`);
console.log(`[ci-check] npm     : ${npmVersion ?? 'ไม่พบ npm บน PATH'}`);
console.log(`[ci-check] git     : ${gitVersion ?? 'ไม่พบ git บน PATH'}`);

if (isOlderThan(nodeVersion, required)) {
  console.error(`[ci-check] ต้องใช้ Node.js >= ${required} (พบ v${nodeVersion}) — ตรวจ .nvmrc`);
  process.exit(1);
}

if (!npmVersion) {
  console.error('[ci-check] ไม่พบ npm — ติดตั้ง Node.js ให้ครบก่อนรัน CI');
  process.exit(1);
}

console.log('[ci-check] เครื่องมือพร้อมใช้งาน');
