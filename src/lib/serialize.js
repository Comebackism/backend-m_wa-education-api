/**
 * Prisma คืนค่า Decimal เป็น object (ไม่ใช่ number) → JSON ออกมาเป็น string
 * helper นี้แปลงเป็น number ให้ frontend ใช้งานตรง ๆ
 */
export function toNumber(value) {
  if (value === null || value === undefined) return value;
  const num = Number(value);
  return Number.isNaN(num) ? value : num;
}

export function decimalFields(source, fields) {
  const result = { ...source };
  for (const field of fields) {
    if (field in result) result[field] = toNumber(result[field]);
  }
  return result;
}

export function serializeQuestion(question) {
  return {
    ...decimalFields(question, ['points']),
    choices: question.choices?.map((choice) => ({ ...choice })),
  };
}

export function serializeSubmission(submission) {
  return decimalFields(submission, ['autoScore', 'manualScore', 'totalScore', 'percent']);
}
