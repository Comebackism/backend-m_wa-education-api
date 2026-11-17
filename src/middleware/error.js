import { ApiError } from '../lib/errors.js';
import { isProduction } from '../config/env.js';

export function notFoundHandler(req, res) {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `ไม่พบ endpoint: ${req.method} ${req.originalUrl}`,
    },
  });
}

/**
 * error handler ตัวสุดท้าย — แปลง error ทุกชนิดให้เป็น JSON รูปแบบเดียวกัน
 * { error: { code, message, details? } }
 */
export function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
  }

  // Prisma error ที่พบบ่อย
  if (err?.name === 'PrismaClientKnownRequestError') {
    if (err.code === 'P2002') {
      const target = Array.isArray(err.meta?.target) ? err.meta.target.join(', ') : err.meta?.target;
      return res.status(409).json({
        error: { code: 'CONFLICT', message: `ข้อมูลซ้ำกับที่มีอยู่แล้ว${target ? ` (${target})` : ''}` },
      });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'ไม่พบข้อมูลที่ต้องการ' } });
    }
    if (err.code === 'P2003') {
      return res.status(409).json({ error: { code: 'CONFLICT', message: 'ข้อมูลอ้างอิงไม่ถูกต้องหรือยังถูกใช้งานอยู่' } });
    }
  }

  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'JSON ใน body ไม่ถูกต้อง' } });
  }

  console.error('[unhandled error]', err);

  return res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: isProduction ? 'เกิดข้อผิดพลาดภายในระบบ' : err?.message ?? 'unknown error',
      ...(isProduction ? {} : { stack: err?.stack }),
    },
  });
}
