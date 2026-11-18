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

/**
 * Submission ที่ส่งให้ครู — เห็นคะแนนได้ทุกฟิลด์
 * (คนละหน้าที่กับ serializeStudentSubmission ด้านล่าง ซึ่งซ่อนคะแนน)
 */
export function serializeTeacherSubmission(submission) {
  return decimalFields(submission, ['autoScore', 'manualScore', 'totalScore', 'percent']);
}

/**
 * Submission ที่ส่งให้นักเรียน — "ไม่รั่วคะแนน"
 * เห็นคะแนน/เกรดเฉพาะตอนครูปล่อยผลแล้ว (RELEASED) เท่านั้น
 * ใช้ whitelist เพื่อกันฟิลด์คะแนนใหม่ ๆ หลุดออกไปโดยไม่ตั้งใจ
 */
const STUDENT_SUBMISSION_FIELDS = [
  'id',
  'examId',
  'studentId',
  'status',
  'displayMode',
  'startedAt',
  'expiresAt',
  'submittedAt',
  'createdAt',
  'updatedAt',
];

export function serializeStudentSubmission(submission) {
  if (!submission) return null;

  const result = {};
  for (const field of STUDENT_SUBMISSION_FIELDS) {
    if (submission[field] !== undefined) result[field] = submission[field];
  }

  // คำตอบที่แนบมาก็ต้องไม่มีคะแนน/ผลตรวจของแต่ละข้อ
  if (Array.isArray(submission.answers)) {
    result.answers = submission.answers.map((answer) => ({
      questionId: answer.questionId,
      choiceId: answer.choiceId ?? null,
      textAnswer: answer.textAnswer ?? null,
    }));
  }

  if (submission.status === 'RELEASED') {
    Object.assign(result, {
      autoScore: toNumber(submission.autoScore),
      manualScore: toNumber(submission.manualScore),
      totalScore: toNumber(submission.totalScore),
      percent: toNumber(submission.percent),
      grade: submission.grade,
      gradedAt: submission.gradedAt,
      releasedAt: submission.releasedAt,
    });
  }

  return result;
}
