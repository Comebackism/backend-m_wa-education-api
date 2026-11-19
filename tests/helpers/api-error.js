import assert from 'node:assert/strict';

/**
 * ตรวจว่า promise โยน ApiError ที่มี statusCode ตามที่คาด
 * - messagePattern: ตรวจข้อความหลัก (error.message)
 * - detailsPattern: ตรวจข้อความใน error.details (เช่น [{ row, message }] ของการนำเข้าไฟล์)
 */
export async function expectApiError(promise, statusCode, messagePattern, detailsPattern) {
  await assert.rejects(promise, (error) => {
    assert.equal(
      error.statusCode,
      statusCode,
      `คาด statusCode ${statusCode} แต่ได้ ${error.statusCode} (${error.message})`,
    );
    if (messagePattern) assert.match(error.message, messagePattern);
    if (detailsPattern) {
      const text = (error.details ?? [])
        .map((detail) => `${detail?.row ?? ''} ${detail?.message ?? detail}`)
        .join(' | ');
      assert.match(text, detailsPattern, `details ไม่ตรง: ${text}`);
    }
    return true;
  });
}
