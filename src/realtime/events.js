/**
 * ชื่อ event ทั้งหมดของชั้น realtime (Socket.IO)
 *
 * หลักคิด: REST ยังเป็นแหล่งข้อมูลจริงเสมอ — event พวกนี้มีไว้ "สะกิด" ให้ client
 * รู้ว่ามีอะไรเปลี่ยนแล้วค่อยไปดึงข้อมูลใหม่ (ไม่ส่ง state ทั้งก้อนผ่าน socket)
 *
 * การตั้งชื่อ: ใช้ `<resource>:<action>` และเป็น present/past ที่อ่านแล้วรู้ทันที
 */

/** event ที่ server → client */
export const RealtimeEvent = {
  /** ส่งทันทีหลังเชื่อมต่อสำเร็จ (มีข้อมูลผู้ใช้ + ห้องที่ถูกใส่อัตโนมัติ) */
  CONNECTED: 'connected',
  /** ครูเปิดสอบ (publish) → แจ้งนักเรียนที่อยู่ในห้องซึ่งถูกมอบหมาย */
  EXAM_PUBLISHED: 'exam:published',
  /** นักเรียนส่งข้อสอบ → แจ้งครูเจ้าของข้อสอบ (ไว้โชว์จำนวนงานรอตรวจ) */
  SUBMISSION_SUBMITTED: 'submission:submitted',
  /** ครูตรวจข้อหนึ่งเสร็จ → แจ้งครูด้วยกันเอง (แท็บ/อุปกรณ์อื่น) อัปเดตความคืบหน้า */
  SUBMISSION_GRADED: 'submission:graded',
  /** ครูกด "ส่งผลไปให้นักเรียน" → แจ้งนักเรียนคนนั้นว่าดูผลได้แล้ว */
  RESULT_RELEASED: 'result:released',
  /** event ที่ client → server */
  PING: 'ping',
};

/** event ที่ client → server (แยกไว้ให้ frontend อ้างอิงง่าย ๆ) */
export const RealtimeClientEvent = {
  PING: 'ping',
};

/**
 * ชื่อห้อง (room) ที่ server ใช้จัดกลุ่ม socket
 * ตอนนี้ใช้ห้องเดียวต่อผู้ใช้หนึ่งคน → ยิงถึงได้ทุกแท็บ/ทุกอุปกรณ์ของคนนั้นพร้อมกัน
 */
export const Room = {
  user: (userId) => `user:${userId}`,
};
