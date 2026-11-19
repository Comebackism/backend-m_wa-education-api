import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { hashPassword, verifyPassword } from '../../src/lib/password.js';

/** เทสต์ hash/ตรวจรหัสผ่าน (bcryptjs) — env เทสต์ตั้ง BCRYPT_ROUNDS=4 ให้เร็ว */

describe('password', () => {
  it('hash ต่างจากรหัสผ่านจริง และ long/prefix ของ bcrypt', async () => {
    const hash = await hashPassword('Password123!');
    assert.notEqual(hash, 'Password123!');
    assert.match(hash, /^\$2[aby]\$/);
  });

  it('salt เปลี่ยนทุกครั้ง → hash ไม่ซ้ำ', async () => {
    const [a, b] = await Promise.all([hashPassword('same'), hashPassword('same')]);
    assert.notEqual(a, b);
  });

  it('ตรวจรหัสผ่านถูก/ผิด', async () => {
    const hash = await hashPassword('Password123!');
    assert.equal(await verifyPassword('Password123!', hash), true);
    assert.equal(await verifyPassword('wrong', hash), false);
  });
});
