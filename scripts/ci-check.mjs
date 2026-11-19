/**
 * ตรวจความพร้อมของเครื่องก่อนรัน CI — `node scripts/ci-check.mjs`
 *
 * ใช้เป็นด่านแรกใน Jenkinsfile เพื่อ "พังเร็ว" พร้อมข้อความที่อ่านรู้เรื่อง
 * ถ้าเครื่อง agent ยังไม่พร้อม (เช่น Node เก่าเกินไป)
 *
 * เกณฑ์: Node.js >= 24.18.0 ตามที่ประกาศไว้ใน package.json → engines
 */
import { execSync } from 'node:child_process';

const REQUIRED = { major: 24, minor: 18, patch: 0 };

// ใช้ shell เพราะบน Windows `npm` เป็น npm.cmd (execFile เรียกตรง ๆ ไม่ได้)
function commandVersion(command) {
  try {
    return execSync(`${command} -v`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

const nodeVersion = process.versions.node;
const npmVersion = commandVersion('npm');
const gitVersion = commandVersion('git');

console.log(`[ci-check] Node.js : v${nodeVersion}`);
console.log(`[ci-check] npm     : ${npmVersion ?? 'ไม่พบ npm บน PATH'}`);
console.log(`[ci-check] git     : ${gitVersion ?? 'ไม่พบ git บน PATH'}`);

const [major, minor, patch] = nodeVersion.split('.').map(Number);
const tooOld =
  major < REQUIRED.major ||
  (major === REQUIRED.major && minor < REQUIRED.minor) ||
  (major === REQUIRED.major && minor === REQUIRED.minor && patch < REQUIRED.patch);

if (tooOld) {
  console.error(
    `[ci-check] ต้องใช้ Node.js >= ${REQUIRED.major}.${REQUIRED.minor}.${REQUIRED.patch} (พบ v${nodeVersion})`,
  );
  process.exit(1);
}

if (!npmVersion) {
  console.error('[ci-check] ไม่พบ npm — ติดตั้ง Node.js ให้ครบก่อนรัน CI');
  process.exit(1);
}

console.log('[ci-check] เครื่องมือพร้อมใช้งาน');
