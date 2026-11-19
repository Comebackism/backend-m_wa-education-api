import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { actorId, isAdminActor } from '../../src/lib/access.js';
import { disconnectDatabase } from '../helpers/db.js';

/** เทสต์ตัวช่วยระบุ "actor" (ฟังก์ชันล้วน) — โมดูล import prisma จึงปิด pool ท้ายไฟล์ */

after(disconnectDatabase);

describe('actorId', () => {
  it('รับสตริง (teacherId เดิม) → คืนสตริง', () => {
    assert.equal(actorId('user-1'), 'user-1');
  });

  it('รับ object → คืน id', () => {
    assert.equal(actorId({ id: 'user-2', role: 'TEACHER' }), 'user-2');
  });

  it('ค่าที่ไม่มี id → undefined', () => {
    assert.equal(actorId({}), undefined);
    assert.equal(actorId(null), undefined);
    assert.equal(actorId(undefined), undefined);
  });
});

describe('isAdminActor', () => {
  it('object ที่มี role ADMIN → true', () => {
    assert.equal(isAdminActor({ id: 'a', role: 'ADMIN' }), true);
  });

  it('role อื่น → false', () => {
    assert.equal(isAdminActor({ id: 't', role: 'TEACHER' }), false);
    assert.equal(isAdminActor({ id: 's', role: 'STUDENT' }), false);
  });

  it('สตริงหรือค่า null ถือว่าไม่ใช่ ADMIN', () => {
    assert.equal(isAdminActor('ADMIN'), false);
    assert.equal(isAdminActor(null), false);
    assert.equal(isAdminActor(undefined), false);
  });
});
