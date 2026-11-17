import rateLimit from 'express-rate-limit';

const jsonMessage = (message) => ({
  error: { code: 'TOO_MANY_REQUESTS', message },
});

/** กัน brute-force ที่ endpoint login */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: jsonMessage('พยายามเข้าสู่ระบบหลายครั้งเกินไป กรุณาลองใหม่ภายหลัง'),
});

/** กันการสร้างบัญชีรัว ๆ */
export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: jsonMessage('สมัครสมาชิกหลายครั้งเกินไป กรุณาลองใหม่ภายหลัง'),
});
