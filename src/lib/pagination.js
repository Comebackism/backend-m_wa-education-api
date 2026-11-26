/**
 * ตัวช่วยแบ่งหน้า (pagination) สำหรับ list endpoint
 *
 * หลักการสำคัญ: "ไม่ส่ง ?page / ?limit มา = คืนทั้งหมดเหมือนเดิม"
 * เพื่อไม่ให้สัญญา HTTP เดิมของ frontend เปลี่ยน (client ที่ยังไม่ส่งพารามิเตอร์ทำงานเหมือนเก่า)
 * เมื่อส่งมา → คืน `pagination` meta เพิ่มใน response (เป็น field เพิ่ม ไม่ทับของเดิม)
 */

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/**
 * อ่านค่า page/limit จาก query ที่ผ่านการ validate แล้ว
 * @returns {{page:number, limit:number, skip:number, take:number} | null} null = ไม่ต้องแบ่งหน้า
 */
export function parsePagination({ page, limit } = {}) {
  if (page === undefined && limit === undefined) return null;

  const pageNumber = page ?? 1;
  const pageSize = Math.min(limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);

  return {
    page: pageNumber,
    limit: pageSize,
    skip: (pageNumber - 1) * pageSize,
    take: pageSize,
  };
}

/** สร้าง meta ที่ส่งกลับให้ client */
export function buildPaginationMeta(pagination, total) {
  const totalPages = pagination.limit > 0 ? Math.ceil(total / pagination.limit) : 0;
  return {
    page: pagination.page,
    limit: pagination.limit,
    total,
    totalPages,
    hasNext: pagination.page < totalPages,
    hasPrev: pagination.page > 1,
  };
}

/**
 * รัน query แบบมี/ไม่มี pagination ในฟังก์ชันเดียว
 *
 * @param {object|null} pagination ผลจาก parsePagination()
 * @param {(args?: {skip?:number, take?:number}) => Promise<any[]>} findMany
 * @param {() => Promise<number>} count
 * @returns {Promise<{items: any[], pagination: object|null}>}
 */
export async function runPaginated(pagination, findMany, count) {
  if (!pagination) {
    return { items: await findMany(), pagination: null };
  }

  const [items, total] = await Promise.all([
    findMany({ skip: pagination.skip, take: pagination.take }),
    count(),
  ]);

  return { items, pagination: buildPaginationMeta(pagination, total) };
}
