import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { ApiError, publicUser } from '../../src/lib/errors.js';

/** เทสต์ error มาตรฐานของระบบ + การตัดฟิลด์ลับออกจาก user */

describe('ApiError', () => {
  it('เป็น Error และเก็บ statusCode/code/message', () => {
    const error = new ApiError(418, 'ฉันคือกาน้ำชา');
    assert.ok(error instanceof Error);
    assert.equal(error.name, 'ApiError');
    assert.equal(error.statusCode, 418);
    assert.equal(error.message, 'ฉันคือกาน้ำชา');
  });

  it('badRequest = 400 + details', () => {
    const error = ApiError.badRequest('ข้อมูลไม่ถูกต้อง', [{ field: 'email' }]);
    assert.equal(error.statusCode, 400);
    assert.equal(error.code, 'BAD_REQUEST');
    assert.deepEqual(error.details, [{ field: 'email' }]);
  });

  it('unauthorized = 401 พร้อมข้อความเริ่มต้น', () => {
    const error = ApiError.unauthorized();
    assert.equal(error.statusCode, 401);
    assert.equal(error.code, 'UNAUTHORIZED');
    assert.equal(error.message, 'ต้องเข้าสู่ระบบก่อน');
  });

  it('forbidden = 403 พร้อมข้อความเริ่มต้น', () => {
    const error = ApiError.forbidden();
    assert.equal(error.statusCode, 403);
    assert.equal(error.code, 'FORBIDDEN');
  });

  it('notFound = 404 พร้อมข้อความเริ่มต้น', () => {
    const error = ApiError.notFound();
    assert.equal(error.statusCode, 404);
    assert.equal(error.code, 'NOT_FOUND');
  });

  it('conflict = 409', () => {
    const error = ApiError.conflict('ซ้ำ');
    assert.equal(error.statusCode, 409);
    assert.equal(error.code, 'CONFLICT');
  });

  it('unprocessable = 422', () => {
    const error = ApiError.unprocessable('ยังตรวจไม่ครบ');
    assert.equal(error.statusCode, 422);
    assert.equal(error.code, 'UNPROCESSABLE_ENTITY');
  });

  it('กำหนด code เริ่มต้นตาม statusCode', () => {
    assert.equal(new ApiError(400, 'x').code, 'BAD_REQUEST');
    assert.equal(new ApiError(401, 'x').code, 'UNAUTHORIZED');
    assert.equal(new ApiError(403, 'x').code, 'FORBIDDEN');
    assert.equal(new ApiError(404, 'x').code, 'NOT_FOUND');
    assert.equal(new ApiError(409, 'x').code, 'CONFLICT');
    assert.equal(new ApiError(422, 'x').code, 'UNPROCESSABLE_ENTITY');
  });

  it('statusCode ที่ไม่รู้จัก → INTERNAL_ERROR', () => {
    assert.equal(new ApiError(500, 'boom').code, 'INTERNAL_ERROR');
    assert.equal(new ApiError(503, 'boom').code, 'INTERNAL_ERROR');
  });

  it('ส่ง code เองทับค่าเริ่มต้นได้', () => {
    assert.equal(new ApiError(400, 'x', { code: 'CUSTOM' }).code, 'CUSTOM');
  });
});

describe('publicUser', () => {
  it('ตัด passwordHash ออก', () => {
    const result = publicUser({ id: 'u1', email: 'a@b.c', passwordHash: 'secret' });
    assert.deepEqual(result, { id: 'u1', email: 'a@b.c' });
    assert.equal('passwordHash' in result, false);
  });

  it('null/undefined → null', () => {
    assert.equal(publicUser(null), null);
    assert.equal(publicUser(undefined), null);
  });
});
