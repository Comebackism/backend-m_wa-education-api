import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { emitToUser, emitToUsers } from '../../src/realtime/emit.js';
import { RealtimeClientEvent, RealtimeEvent, Room } from '../../src/realtime/events.js';
import { closeRealtime, getIO, isRealtimeReady } from '../../src/realtime/index.js';

/**
 * เทสต์ชั้น realtime ตอน "ยังไม่ init io"
 * (unit test ไม่เปิด socket — ต้องไม่ throw และคืน 0 แบบเงียบ ๆ)
 */

describe('emit', () => {
  it('ยังไม่ init io → emit คืน 0 ไม่ throw', () => {
    assert.equal(emitToUser('user-1', RealtimeEvent.EXAM_PUBLISHED, { examId: 'e1' }), 0);
  });

  it('ไม่มี userId → 0', () => {
    assert.equal(emitToUser(null, 'x'), 0);
    assert.equal(emitToUser('', 'x'), 0);
  });

  it('emitToUsers ตัดค่าซ้ำและค่าว่าง', () => {
    assert.equal(emitToUsers(['a', 'a', 'b', null, ''], 'x'), 0);
    assert.equal(emitToUsers(undefined, 'x'), 0);
  });
});

describe('events / rooms', () => {
  it('ชื่อ event หลักตรงตามที่ตกลง', () => {
    assert.equal(RealtimeEvent.CONNECTED, 'connected');
    assert.equal(RealtimeEvent.EXAM_PUBLISHED, 'exam:published');
    assert.equal(RealtimeEvent.SUBMISSION_SUBMITTED, 'submission:submitted');
    assert.equal(RealtimeEvent.SUBMISSION_GRADED, 'submission:graded');
    assert.equal(RealtimeEvent.RESULT_RELEASED, 'result:released');
    assert.equal(RealtimeClientEvent.PING, 'ping');
  });

  it('room ต่อผู้ใช้หนึ่งคน', () => {
    assert.equal(Room.user('abc'), 'user:abc');
  });
});

describe('index', () => {
  it('ยังไม่ init → getIO() เป็น null และ isRealtimeReady() false', () => {
    assert.equal(getIO(), null);
    assert.equal(isRealtimeReady(), false);
  });

  it('closeRealtime ตอนยังไม่ init → resolve เฉย ๆ', async () => {
    await closeRealtime();
    assert.equal(getIO(), null);
  });
});
