import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * เทสต์การบูตแอปในโหมดที่ไม่ใช่เทสต์ (NODE_ENV=development + DOCS_ENABLED=true)
 * เพื่อยืนยันว่าส่วนที่ผูกกับ environment ทำงานจริง:
 *   - เปิด morgan logger (app.js)
 *   - เมานต์เส้นทาง Swagger docs (app.js → docs.routes.js)
 *
 * spawn โปรเซสลูกแยก เพื่อให้ config/env.js อ่านค่าที่ต่างจากโหมดเทสต์ได้
 */

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));

let child;
let baseUrl;

function waitForPort(proc, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('บูตแอปไม่สำเร็จภายในเวลาที่กำหนด'));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      proc.stdout.off('data', onData);
      proc.off('exit', onExit);
      proc.off('error', onError);
    }

    function onData(chunk) {
      buffer += chunk.toString();
      const match = /PORT=(\d+)/.exec(buffer);
      if (match) {
        cleanup();
        resolve(Number(match[1]));
      }
    }

    function onExit(code) {
      cleanup();
      reject(new Error(`โปรเซสลูกจบก่อนกำหนด (code=${code})\n${buffer}`));
    }

    function onError(error) {
      cleanup();
      reject(error);
    }

    proc.stdout.on('data', onData);
    proc.on('exit', onExit);
    proc.on('error', onError);
  });
}

before(async () => {
  child = spawn(process.execPath, ['tests/helpers/boot-app.mjs'], {
    cwd: projectRoot,
    env: { ...process.env, NODE_ENV: 'development', DOCS_ENABLED: 'true' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', () => {}); // กัน stderr ท่วมถ้าโปรเซสลูกเขียน log

  const port = await waitForPort(child);
  baseUrl = `http://127.0.0.1:${port}`;
});

after(() => {
  if (child && !child.killed) child.kill('SIGTERM');
});

describe('บูตแอปในโหมด development', () => {
  it('GET /health → ok', async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ok');
  });

  it('DOCS_ENABLED=true → เข้า /api/docs/openapi.json ได้', async () => {
    const res = await fetch(`${baseUrl}/api/docs/openapi.json`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.match(body.openapi, /^3\./);
  });
});

describe('ตรวจ environment ตอนบูต', () => {
  it('DATABASE_URL ว่าง → ปิดโปรเซสทันทีด้วย exit code 1 พร้อมบอกสาเหตุ', async () => {
    const proc = spawn(process.execPath, ['src/server.js'], {
      cwd: projectRoot,
      // ตั้งเป็นสตริงว่าง เพื่อไม่ให้ dotenv ใน .env ทับค่า
      env: { ...process.env, DATABASE_URL: '', PORT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    const code = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        proc.kill();
        reject(new Error('โปรเซสไม่จบภายในเวลาที่กำหนด'));
      }, 30_000);
      proc.on('exit', (exitCode) => {
        clearTimeout(timer);
        resolve(exitCode);
      });
      proc.on('error', reject);
    });

    assert.equal(code, 1);
    assert.match(stderr, /\[env\] invalid environment configuration/);
    assert.match(stderr, /DATABASE_URL/);
  });
});
