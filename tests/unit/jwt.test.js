import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  hashToken,
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} from '../../src/lib/jwt.js';

/** เทสต์ JWT: แยกชนิด token ให้ชัด และ hash refresh token ก่อนเก็บ DB */

const user = { id: '11111111-1111-1111-1111-111111111111', role: 'TEACHER', email: 'teacher@test.local' };

describe('access token', () => {
  it('sign แล้ว verify ได้ และได้ payload ครบ', () => {
    const token = signAccessToken(user);
    const payload = verifyAccessToken(token);
    assert.equal(payload.sub, user.id);
    assert.equal(payload.role, 'TEACHER');
    assert.equal(payload.email, user.email);
    assert.equal(payload.type, 'access');
  });

  it('verify refresh token ด้วย access secret ไม่ผ่าน', () => {
    const refresh = signRefreshToken(user);
    assert.throws(() => verifyAccessToken(refresh));
  });
});

describe('refresh token', () => {
  it('มี type = refresh และ jti ไม่ซ้ำกัน', () => {
    const a = verifyRefreshToken(signRefreshToken(user));
    const b = verifyRefreshToken(signRefreshToken(user));
    assert.equal(a.type, 'refresh');
    assert.ok(a.jti);
    assert.notEqual(a.jti, b.jti);
  });

  it('verify access token ด้วย refresh secret ไม่ผ่าน', () => {
    assert.throws(() => verifyRefreshToken(signAccessToken(user)));
  });

  it('token ที่ถูกแก้ไม่ผ่านการตรวจ', () => {
    const token = signAccessToken(user);
    assert.throws(() => verifyAccessToken(`${token}x`));
  });
});

describe('hashToken', () => {
  it('เป็น sha256 hex ยาว 64 ตัว และคงที่', () => {
    const hash = hashToken('some-token');
    assert.match(hash, /^[0-9a-f]{64}$/);
    assert.equal(hash, hashToken('some-token'));
    assert.notEqual(hash, hashToken('other-token'));
  });
});
