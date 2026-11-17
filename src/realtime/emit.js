import { getIO } from './index.js';
import { Room } from './events.js';

/**
 * ตัวช่วยยิง event — ปลอดภัยเมื่อ realtime ยังไม่พร้อม
 * (คืน 0 และไม่โยน error ถ้ายังไม่ init io เช่นตอนเทส หรือปิด realtime ไว้)
 */

/**
 * ยิง event ให้ทุก socket ของผู้ใช้หนึ่งคน (ทุกแท็บ/ทุกอุปกรณ์)
 * @returns {number} จำนวน socket ที่ได้รับ event (0 = ไม่มีใครต่ออยู่/ยังไม่ init)
 */
export function emitToUser(userId, event, payload = {}) {
  const io = getIO();
  if (!io || !userId) return 0;

  const room = Room.user(userId);
  const body = { ...payload, serverTime: new Date().toISOString() };
  io.to(room).emit(event, body);

  return io.sockets.adapter.rooms.get(room)?.size ?? 0;
}

/** ยิงให้ผู้ใช้หลายคนพร้อมกัน — คืนจำนวนผู้ใช้ที่ยิงสำเร็จ */
export function emitToUsers(userIds, event, payload = {}) {
  const unique = [...new Set((userIds ?? []).filter(Boolean))];
  return unique.reduce((count, userId) => count + (emitToUser(userId, event, payload) > 0 ? 1 : 0), 0);
}
