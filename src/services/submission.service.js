import { prisma } from '../lib/prisma.js';
import { ApiError } from '../lib/errors.js';
import { getExamForStudent, getOwnStudentSubmission } from '../lib/access.js';
import { autoGradeAnswer, recalculateSubmission } from '../lib/grading.js';
import { serializeStudentSubmission } from '../lib/serialize.js';
import { emitToUser } from '../realtime/emit.js';
import { RealtimeEvent } from '../realtime/events.js';

const MAX_TEXT_ANSWER_LENGTH = 20000;

function assertEditable(submission) {
  if (submission.status !== 'IN_PROGRESS') {
    throw ApiError.conflict('ข้อสอบชุดนี้ถูกส่งไปแล้ว ไม่สามารถแก้ไขคำตอบได้');
  }
  if (submission.expiresAt && new Date() > submission.expiresAt) {
    throw ApiError.conflict('หมดเวลาทำข้อสอบแล้ว กรุณาส่งข้อสอบ');
  }
}

/**
 * ล็อกแถว submission ด้วย SELECT ... FOR UPDATE
 * ต้องเรียกใน transaction เดียวกับการเขียนคำตอบเสมอ
 * เพื่อไม่ให้ save ที่มาช้ากว่าการ submit เขียนทับคำตอบหลังส่งแล้ว
 */
async function lockSubmission(tx, submissionId, studentId) {
  const rows = await tx.$queryRaw`
    SELECT id, status, "expiresAt"
    FROM "submissions"
    WHERE id = ${submissionId}::uuid AND "studentId" = ${studentId}::uuid
    FOR UPDATE
  `;

  const submission = rows[0];
  if (!submission) throw ApiError.notFound('ไม่พบการส่งข้อสอบ');
  return submission;
}

/**
 * เริ่มทำข้อสอบ — ถ้าเคยเริ่มไว้แล้วและยังไม่ส่ง จะคืนใบเดิม (ทำต่อได้)
 * กำหนด expiresAt จาก timeLimitMinutes ของข้อสอบ
 */
export async function startSubmission(examId, studentId, { displayMode, clientIp } = {}) {
  const exam = await getExamForStudent(
    examId,
    studentId,
    {
      _count: { select: { questions: true } },
    },
    { clientIp },
  );

  if (exam._count.questions === 0) throw ApiError.badRequest('ข้อสอบชุดนี้ยังไม่มีข้อคำถาม');

  const existing = await prisma.submission.findUnique({
    where: { examId_studentId: { examId, studentId } },
  });

  if (existing) {
    if (existing.status !== 'IN_PROGRESS') throw ApiError.conflict('คุณส่งข้อสอบชุดนี้แล้ว');
    return serializeStudentSubmission(existing);
  }

  const submission = await prisma.submission.create({
    data: {
      examId,
      studentId,
      displayMode: displayMode ?? exam.defaultDisplayMode,
      expiresAt: exam.timeLimitMinutes ? new Date(Date.now() + exam.timeLimitMinutes * 60_000) : null,
    },
  });

  return serializeStudentSubmission(submission);
}

/**
 * บันทึกคำตอบแบบ bulk (เรียกได้เรื่อย ๆ ระหว่างทำข้อสอบ)
 * answers: [{ questionId, choiceId? }] สำหรับปรนัย, [{ questionId, textAnswer? }] สำหรับอัตนัย
 */
export async function saveAnswers(submissionId, studentId, answers) {
  const submission = await getOwnStudentSubmission(studentId, submissionId);
  assertEditable(submission);

  const exam = await prisma.exam.findUnique({
    where: { id: submission.examId },
    include: { questions: { include: { choices: true } } },
  });
  const questionMap = new Map(exam.questions.map((question) => [question.id, question]));

  for (const item of answers) {
    const question = questionMap.get(item.questionId);
    if (!question) throw ApiError.badRequest(`ไม่พบข้อ ${item.questionId} ในข้อสอบชุดนี้`);

    if (question.type === 'MULTIPLE_CHOICE') {
      if (item.choiceId && !question.choices.some((choice) => choice.id === item.choiceId)) {
        throw ApiError.badRequest('ตัวเลือกที่ส่งมาไม่ตรงกับข้อนี้');
      }
    } else if (item.choiceId) {
      throw ApiError.badRequest('ข้ออัตนัยไม่ต้องส่ง choiceId');
    }
    if (item.textAnswer && item.textAnswer.length > MAX_TEXT_ANSWER_LENGTH) {
      throw ApiError.badRequest(`คำตอบยาวเกินไป (สูงสุด ${MAX_TEXT_ANSWER_LENGTH} ตัวอักษร)`);
    }
  }

  const saved = await prisma.$transaction(async (tx) => {
    // ตรวจสถานะซ้ำหลังล็อกแถว: ถ้า submit ทำงานไปก่อนแล้ว จะไม่เขียนทับคำตอบ
    assertEditable(await lockSubmission(tx, submissionId, studentId));

    for (const item of answers) {
      await tx.answer.upsert({
        where: { submissionId_questionId: { submissionId, questionId: item.questionId } },
        create: {
          submissionId,
          questionId: item.questionId,
          choiceId: item.choiceId ?? null,
          textAnswer: item.textAnswer ?? null,
        },
        update: {
          choiceId: item.choiceId ?? null,
          textAnswer: item.textAnswer ?? null,
        },
      });
    }

    return tx.answer.findMany({
      where: { submissionId, questionId: { in: answers.map((item) => item.questionId) } },
    });
  });

  return {
    savedCount: saved.length,
    answers: saved.map((answer) => ({
      questionId: answer.questionId,
      choiceId: answer.choiceId,
      textAnswer: answer.textAnswer,
    })),
  };
}

/**
 * ส่งข้อสอบ → ปรนัยตรวจอัตโนมัติ, อัตนัยรอครูตรวจ
 * สถานะ: SUBMITTED ("ส่งแล้ว รอตรวจ") หรือ GRADED ถ้าตรวจครบแล้วทุกข้อ
 */
export async function submitSubmission(submissionId, studentId, { displayMode } = {}) {
  const submission = await getOwnStudentSubmission(studentId, submissionId);
  if (submission.status !== 'IN_PROGRESS') throw ApiError.conflict('ข้อสอบชุดนี้ถูกส่งไปแล้ว');

  const exam = await prisma.exam.findUnique({
    where: { id: submission.examId },
    include: { questions: { include: { choices: true } } },
  });

  await prisma.$transaction(async (tx) => {
    // ล็อกแถวก่อน: save ที่วิ่งมาทีหลังจะต้องรอ แล้วเห็นสถานะ SUBMITTED ไม่ใช่ IN_PROGRESS
    const locked = await lockSubmission(tx, submissionId, studentId);
    if (locked.status !== 'IN_PROGRESS') throw ApiError.conflict('ข้อสอบชุดนี้ถูกส่งไปแล้ว');

    // หมายเหตุ: ไม่เช็ค expiresAt ตอน submit — ใบที่เริ่มทำไว้แล้วยังส่งได้แม้หมดเวลา
    // เพื่อไม่ให้นักเรียนเสียคำตอบที่ทำไว้ (การเริ่มใหม่/บันทึกเพิ่มยังถูกบล็อกตามเวลา)

    const savedAnswers = await tx.answer.findMany({ where: { submissionId } });
    const answerMap = new Map(savedAnswers.map((answer) => [answer.questionId, answer]));

    // สร้าง Answer ครบทุกข้อ (ข้อที่ไม่ได้ตอบก็ให้มี record → ครูเห็นว่าเว้นว่าง)
    for (const question of exam.questions) {
      const answer = answerMap.get(question.id) ?? { choiceId: null, textAnswer: null };
      const auto = autoGradeAnswer(question, answer);
      await tx.answer.upsert({
        where: { submissionId_questionId: { submissionId, questionId: question.id } },
        create: {
          submissionId,
          questionId: question.id,
          choiceId: answer.choiceId ?? null,
          textAnswer: answer.textAnswer ?? null,
          ...auto,
        },
        update: { ...auto },
      });
    }

    await tx.submission.update({
      where: { id: submissionId },
      data: {
        status: 'SUBMITTED',
        submittedAt: new Date(),
        ...(displayMode ? { displayMode } : {}),
      },
    });
  });

  const result = await recalculateSubmission(submissionId);

  // แจ้งครูเจ้าของข้อสอบว่ามีงานส่งเข้ามาใหม่ (ไว้ทำ dashboard "รอตรวจ")
  emitToUser(exam.teacherId, RealtimeEvent.SUBMISSION_SUBMITTED, {
    examId: exam.id,
    submissionId,
    studentId,
  });

  return serializeStudentSubmission(result);
}

/** สถานะการทำข้อสอบของตัวเอง (ไม่มีเฉลย/คะแนนจนกว่าจะปล่อยผล) */
export async function getStudentSubmission(studentId, submissionId) {
  const submission = await getOwnStudentSubmission(studentId, submissionId, {
    answers: { select: { questionId: true, choiceId: true, textAnswer: true } },
  });
  return serializeStudentSubmission(submission);
}
