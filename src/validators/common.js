import { z } from 'zod';

/** UUID ตามรูปแบบของ Prisma @db.Uuid */
export const uuid = z.uuid();

export const idParams = (key = 'id') => z.object({ [key]: uuid });

/** query string แบบ optional */
export const optionalQueryString = z.string().trim().min(1).optional();

/** บังคับให้ query เป็น boolean */
export const booleanQuery = z
  .enum(['true', 'false'])
  .optional()
  .transform((value) => value === 'true');

/**
 * ?page= & ?limit= สำหรับ list endpoint
 *
 * ทั้งคู่เป็น optional (ไม่มี default) เพื่อให้แยกได้ว่า "client ไม่ได้ขอแบ่งหน้า"
 * → endpoint จะคืนทั้งหมดเหมือนพฤติกรรมเดิม
 */
export const paginationQuery = {
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
};

/** แทรก paginationQuery เข้า schema ของ query ได้ เช่น z.object({ q, ...paginationQuery }) */
export const withPagination = (shape = {}) => z.object({ ...shape, ...paginationQuery });
