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

/** ?page= & ?limit= พร้อมค่าเริ่มต้น */
export const paginationQuery = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
};
