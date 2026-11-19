import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { corsOrigins, docsEnabled, env, isProduction } from '../../src/config/env.js';

/** เทสต์ค่าที่อ่านจาก environment (เทสต์รันด้วย node --import ./tests/setup-env.js) */

describe('env', () => {
  it('โหมดเทสต์ถูกบังคับ และค่าปลอดภัยของเทสต์ถูกใช้', () => {
    assert.equal(env.NODE_ENV, 'test');
    assert.equal(env.BCRYPT_ROUNDS, 4);
    assert.equal(env.RATE_LIMIT_DISABLED, 'true');
  });

  it('แปลงชนิดข้อมูลให้ถูกต้อง', () => {
    assert.equal(typeof env.PORT, 'number');
    assert.equal(typeof env.LOGIN_RATE_LIMIT_MAX, 'number');
  });

  it('DATABASE_URL ชี้ฐานข้อมูลเทสต์ (_test)', () => {
    assert.match(env.DATABASE_URL, /_test(\?|$)/);
  });
});

describe('ค่าที่คำนวณจาก env', () => {
  it('corsOrigins เป็น array ของ origin', () => {
    assert.ok(Array.isArray(corsOrigins));
    assert.ok(corsOrigins.includes('http://localhost:5173'));
  });

  it('isProduction = false ในโหมดเทสต์', () => {
    assert.equal(isProduction, false);
  });

  it('docsEnabled = false เมื่อ DOCS_ENABLED=false', () => {
    assert.equal(docsEnabled, false);
  });
});
