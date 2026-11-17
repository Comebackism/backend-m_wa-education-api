import { Server } from 'socket.io';
import { corsOrigins, env } from '../config/env.js';
import { verifyAccessToken } from '../lib/jwt.js';
import { RealtimeClientEvent, RealtimeEvent, Room } from './events.js';

/**
 * ชั้น realtime (Socket.IO) — แนบอยู่บน HTTP server ตัวเดียวกับ REST API
 *
 * - ยืนยันตัวตนตอน handshake ด้วย access token (JWT) อันเดียวกับ REST
 * - เมื่อต่อได้ ทุก socket จะถูกใส่ห้อง `user:<id>` อัตโนมัติ
 *   จึงยิงถึงผู้ใช้คนหนึ่งได้ทุกแท็บ/ทุกอุปกรณ์พร้อมกันด้วย emitToUser()
 * - ถ้าไม่ได้เรียก initRealtime() (เช่นใน unit test) ระบบ realtime จะเงียบ ๆ ไม่ทำอะไร
 *   โดย REST ยังทำงานปกติทุก endpoint
 */

let io = null;

export function initRealtime(httpServer) {
  io = new Server(httpServer, {
    // ปิด serve client SDK จาก backend เพราะ frontend import จาก npm เอง
    serveClient: false,
    cors: { origin: corsOrigins, credentials: true },
  });

  // --- ยืนยันตัวตน (รับ token ได้ทั้ง handshake.auth.token และ Authorization: Bearer) ---
  io.use((socket, next) => {
    const authToken = socket.handshake.auth?.token;
    const header = socket.handshake.headers?.authorization;
    const bearer = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : null;
    const token = authToken || bearer;

    if (!token) return next(new Error('UNAUTHORIZED: ต้องแนบ access token'));

    try {
      const payload = verifyAccessToken(token);
      socket.user = { id: payload.sub, role: payload.role, email: payload.email };
      return next();
    } catch {
      return next(new Error('UNAUTHORIZED: token ไม่ถูกต้องหรือหมดอายุ'));
    }
  });

  io.on('connection', (socket) => {
    const { id, role } = socket.user;
    const room = Room.user(id);

    socket.join(room);
    socket.emit(RealtimeEvent.CONNECTED, {
      userId: id,
      role,
      room,
      serverTime: new Date().toISOString(),
    });

    // ใช้เช็คว่าฝั่ง client ต่อติดจริง (มี ack ได้ถ้าส่ง callback มา)
    socket.on(RealtimeClientEvent.PING, (ack) => {
      const payload = { pong: true, serverTime: new Date().toISOString() };
      if (typeof ack === 'function') ack(payload);
      else socket.emit('pong', payload);
    });

    socket.on('error', (error) => {
      console.error(`[realtime] socket error (${id}):`, error?.message ?? error);
    });
  });

  console.log(`[realtime] socket.io ready (${env.NODE_ENV})`);
  return io;
}

/** คืน instance ของ io (null ถ้ายังไม่ init) */
export function getIO() {
  return io;
}

export function isRealtimeReady() {
  return io !== null;
}

/** ปิดการเชื่อมต่อทั้งหมดตอน shutdown */
export function closeRealtime() {
  if (!io) return Promise.resolve();
  return new Promise((resolve) => {
    io.close(() => {
      io = null;
      resolve();
    });
  });
}
