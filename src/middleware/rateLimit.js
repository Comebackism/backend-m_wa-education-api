import rateLimit from 'express-rate-limit';
import { env, isProduction } from '../config/env.js';

const jsonMessage = (message) => ({
  error: { code: 'TOO_MANY_REQUESTS', message },
});

/**
 * เพดานของ production ตรึงไว้ในโค้ด ไม่ขึ้นกับ env
 * เพื่อกันตั้ง env ผิดแล้วหลุดการกัน brute-force
 */
const PROD_LOGIN_LIMIT = 10; // ครั้ง / 15 นาที
const PROD_REGISTER_LIMIT = 20; // ครั้ง / 1 ชั่วโมง
const PROD_CHANGE_PASSWORD_LIMIT = 10; // ครั้ง / 15 นาที

/**
 * ปิด limiter เพื่อทดสอบได้ด้วย `RATE_LIMIT_DISABLED=true`
 * — มีผลเฉพาะโหมดที่ไม่ใช่ production เท่านั้น
 */
const skipWhenDisabled = () => !isProduction && env.RATE_LIMIT_DISABLED === 'true';

/** กัน brute-force ที่ endpoint login */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: isProduction ? PROD_LOGIN_LIMIT : env.LOGIN_RATE_LIMIT_MAX,
  skip: skipWhenDisabled,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: jsonMessage('พยายามเข้าสู่ระบบหลายครั้งเกินไป กรุณาลองใหม่ภายหลัง'),
});

/** กันการสร้างบัญชีรัว ๆ */
export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: isProduction ? PROD_REGISTER_LIMIT : env.REGISTER_RATE_LIMIT_MAX,
  skip: skipWhenDisabled,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: jsonMessage('สมัครสมาชิกหลายครั้งเกินไป กรุณาลองใหม่ภายหลัง'),
});

/** กันเดารหัสผ่านปัจจุบันซ้ำ ๆ ที่ endpoint เปลี่ยนรหัสผ่าน */
export const changePasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: isProduction ? PROD_CHANGE_PASSWORD_LIMIT : env.CHANGE_PASSWORD_RATE_LIMIT_MAX,
  skip: skipWhenDisabled,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: jsonMessage('เปลี่ยนรหัสผ่านหลายครั้งเกินไป กรุณาลองใหม่ภายหลัง'),
});