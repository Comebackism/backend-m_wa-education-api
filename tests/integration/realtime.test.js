import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { io as ioClient } from 'socket.io-client';

import { disconnectDatabase, resetDatabase } from '../helpers/db.js';
import { createStudent, createTeacher } from '../helpers/fixtures.js';
import { createApp } from '../../src/app.js';
import { signAccessToken, signRefreshToken } from '../../src/lib/jwt.js';
import { emitToUser, emitToUsers } from '../../src/realtime/emit.js';
import { closeRealtime, getIO, initRealtime, isRealtimeReady } from '../../src/realtime/index.js';

/**
 * เทสต์ชั้น realtime จริง — เปิด Socket.IO บน HTTP server เดียวกับ REST
 * ครอบคลุม: handshake/auth, การเข้าห้อง user:<id>, ping/pong และ emitToUser
 */

let server;
let baseUrl;

before(async () => {
  const app = createApp();
  server = createServer(app);
  initRealtime(server);
  server.listen(0);
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await closeRealtime();
  await new Promise((resolve) => server.close(resolve));
  await disconnectDatabase();
});

beforeEach(resetDatabase);

function connect(auth) {
  return ioClient(baseUrl, { auth, transports: ['websocket'], reconnection: false, forceNew: true });
}

function once(socket, event, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout: ไม่ได้รับ event "${event}"`)), timeoutMs);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

function connectError(socket, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout: ไม่เกิด connect_error')), timeoutMs);
    socket.once('connect_error', (error) => {
      clearTimeout(timer);
      resolve(error);
    });
    socket.once('connect', () => {
      clearTimeout(timer);
      reject(new Error('connect สำเร็จทั้งที่ไม่ควร'));
    });
  });
}

describe('initRealtime', () => {
  it('หลัง init → getIO() ไม่เป็น null และ isRealtimeReady() true', () => {
    assert.ok(getIO());
    assert.equal(isRealtimeReady(), true);
  });
});

describe('handshake / auth', () => {
  it('ไม่มี token → connect_error UNAUTHORIZED', async () => {
    const socket = connect({});
    const error = await connectError(socket);
    assert.match(error.message, /UNAUTHORIZED/);
    socket.close();
  });

  it('token ปลอม → connect_error', async () => {
    const socket = connect({ token: 'not-a-real-token' });
    const error = await connectError(socket);
    assert.match(error.message, /UNAUTHORIZED/);
    socket.close();
  });

  it('ใช้ refresh token ต่อ socket → connect_error', async () => {
    const teacher = await createTeacher();
    const socket = connect({ token: signRefreshToken(teacher) });
    const error = await connectError(socket);
    assert.match(error.message, /UNAUTHORIZED/);
    socket.close();
  });

  it('บัญชีถูกระงับ → connect_error', async () => {
    const teacher = await createTeacher({ isActive: false });
    const socket = connect({ token: signAccessToken(teacher) });
    const error = await connectError(socket);
    assert.match(error.message, /UNAUTHORIZED/);
    socket.close();
  });

  it('รับ token ทาง Authorization: Bearer ได้ด้วย', async () => {
    const teacher = await createTeacher();
    const socket = ioClient(baseUrl, {
      extraHeaders: { authorization: `Bearer ${signAccessToken(teacher)}` },
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
    });
    const hello = await once(socket, 'connected');
    assert.equal(hello.userId, teacher.id);
    socket.close();
  });
});

describe('connection', () => {
  it('ต่อสำเร็จ → ได้ event connected พร้อมห้อง user:<id>', async () => {
    const student = await createStudent();
    const socket = connect({ token: signAccessToken(student) });
    const hello = await once(socket, 'connected');
    assert.equal(hello.userId, student.id);
    assert.equal(hello.role, 'STUDENT');
    assert.equal(hello.room, `user:${student.id}`);
    socket.close();
  });

  it('ping → ได้ ack pong', async () => {
    const teacher = await createTeacher();
    const socket = connect({ token: signAccessToken(teacher) });
    await once(socket, 'connected');

    const pong = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout: pong')), 10_000);
      socket.emit('ping', (payload) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });
    assert.equal(pong.pong, true);
    socket.close();
  });

  it('ping แบบไม่มี ack → ยิง event "pong" กลับ', async () => {
    const teacher = await createTeacher();
    const socket = connect({ token: signAccessToken(teacher) });
    await once(socket, 'connected');

    const received = once(socket, 'pong');
    socket.emit('ping');
    const payload = await received;
    assert.equal(payload.pong, true);
    socket.close();
  });
});

describe('emitToUser / emitToUsers', () => {
  it('ยิงถึง socket ที่ต่ออยู่จริง และคืนจำนวน socket', async () => {
    const teacher = await createTeacher();
    const socket = connect({ token: signAccessToken(teacher) });
    await once(socket, 'connected');

    const received = once(socket, 'exam:published');
    const count = emitToUser(teacher.id, 'exam:published', { examId: 'exam-1' });
    assert.equal(count, 1);

    const payload = await received;
    assert.equal(payload.examId, 'exam-1');
    assert.ok(payload.serverTime);
    socket.close();
  });

  it('ไม่มีใครต่ออยู่ → คืน 0', async () => {
    const teacher = await createTeacher();
    assert.equal(emitToUser(teacher.id, 'exam:published'), 0);
  });

  it('emitToUsers ตัดค่าซ้ำและคืนจำนวนผู้ใช้ที่ยิงสำเร็จ', async () => {
    const teacher = await createTeacher();
    const socket = connect({ token: signAccessToken(teacher) });
    await once(socket, 'connected');

    assert.equal(emitToUsers([teacher.id, teacher.id, 'no-such-user'], 'result:released', {}), 1);
    socket.close();
  });
});
