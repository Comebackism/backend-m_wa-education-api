import { ApiError } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import { verifyAccessToken } from '../lib/jwt.js';

/**
 * แนบ req.user จาก access token (Authorization: Bearer <token>)
 */
export async function authenticate(req, res, next) {
  const header = req.headers.authorization ?? '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    throw ApiError.unauthorized('ต้องระบุ header: Authorization: Bearer <access token>');
  }

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    throw ApiError.unauthorized('access token ไม่ถูกต้องหรือหมดอายุ');
  }

  if (payload.type !== 'access') {
    throw ApiError.unauthorized('ต้องใช้ access token เท่านั้น');
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user || !user.isActive) {
    throw ApiError.unauthorized('ไม่พบผู้ใช้ หรือบัญชีถูกระงับการใช้งาน');
  }

  req.user = user;
  req.tokenPayload = payload;
  next();
}

/**
 * จำกัดสิทธิ์ตามบทบาท เช่น requireRole('TEACHER')
 * บทบาท ADMIN เข้าได้ทั้งฝั่งครูและฝั่งนักเรียน
 */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) throw ApiError.unauthorized();
    if (!roles.includes(req.user.role)) {
      throw ApiError.forbidden(` endpoint นี้สำหรับ ${roles.join(' / ')} เท่านั้น`);
    }
    next();
  };
}

export const teacherOnly = requireRole('TEACHER', 'ADMIN');
export const studentOnly = requireRole('STUDENT', 'ADMIN');
