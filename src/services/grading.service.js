import { prisma } from '../lib/prisma.js';
import { ApiError } from '../lib/errors.js';
import { getOwnedExam, getOwnedSubmission } from '../lib/access.js';
import { recalculateSubmission, round2 } from '../lib/grading.js';
import { serializeSubmission, toNumber } from '../lib/serialize.js';
import { emitToUser, emitToUsers } from '../realtime/emit.js';
import { RealtimeEvent } from '../realtime/events.js';

const studentSelect = { select: { id: true, fullName: true, email: true, studentCode: true } };

export async function listExamSubmissions(teacherId, examId, { status } = {}) {
  await getOwnedExam(teacherId, examId);

  const submissions = await prisma.submission.findMany({
    where: { examId, ...(status ? { status } : {}) },
    include: {
      student: studentSelect,
      // นับจากคำตอบที่ยังไม่ตรวจ (isCorrect = null) ไม่ใช่จาก totalScore
      // เพราะข้อผสมอาจมีคะแนนปรนัยแล้วแต่ยังเหลืออัตนัยที่ต้องตรวจ
      _count: { select: { answers: { where: { isCorrect: null } } } },
    },
    orderBy: [{ submittedAt: 'desc' }, { createdAt: 'desc' }],
  });

  return submissions.map((submission) => {
    const { _count, ...rest } = submission;
    const ungradedCount = _count.answers;
    const serialized = serializeSubmission(rest);
    return {
      ...serialized,
      ungradedCount,
      needsGrading: submission.status === 'SUBMITTED' && ungradedCount > 0,
    };
  });
}

/** รายละเอียดการส่ง + คำตอบทุกข้อ ให้ครูตรวจ */
export async function getSubmissionDetail(teacherId, submissionId) {
  const submission = await getOwnedSubmission(teacherId, submissionId, {
    student: studentSelect,
    exam: { select: { id: true, title: true, totalsPoints: true } },
    answers: {
      include: {
        question: { include: { choices: { orderBy: { order: 'asc' } } } },
      },
      orderBy: { question: { order: 'asc' } },
    },
  });

  const ungradedCount = submission.answers.filter((answer) => answer.isCorrect === null).length;

  return {
    ...serializeSubmission(submission),
    ungradedCount,
    answers: submission.answers.map((answer) => ({
      id: answer.id,
      questionId: answer.questionId,
      type: answer.question.type,
      prompt: answer.question.prompt,
      points: toNumber(answer.question.points),
      referenceText: answer.question.referenceText,
      explanation: answer.question.explanation,
      choices: answer.question.choices,
      choiceId: answer.choiceId,
      textAnswer: answer.textAnswer,
      correctChoiceId: answer.question.choices.find((choice) => choice.isCorrect)?.id ?? null,
      isCorrect: answer.isCorrect,
      autoGraded: answer.autoGraded,
      awardedPoints: toNumber(answer.awardedPoints),
      graderComment: answer.graderComment,
    })),
  };
}

/**
 * ครูตรวจอัตนัย: ตัดสินถูก/ไม่ถูก + ใส่หมายเหตุ (และปรับคะแนนได้)
 * ปรนัยถูกตรวจอัตโนมัติแล้ว จึงไม่ให้แก้ผ่าน endpoint นี้
 */
export async function gradeAnswer(teacherId, answerId, payload) {
  const answer = await prisma.answer.findUnique({
    where: { id: answerId },
    include: { question: true, submission: { include: { exam: true } } },
  });

  if (!answer) throw ApiError.notFound('ไม่พบคำตอบข้อนี้');
  if (answer.submission.exam.teacherId !== teacherId) throw ApiError.forbidden('คำตอบนี้ไม่อยู่ในข้อสอบของคุณ');
  if (answer.question.type === 'MULTIPLE_CHOICE') {
    throw ApiError.badRequest('ข้อปรนัยถูกตรวจอัตโนมัติแล้ว ไม่ต้องตรวจเอง');
  }
  if (answer.submission.status === 'IN_PROGRESS') {
    throw ApiError.conflict('นักเรียนยังไม่ส่งข้อสอบชุดนี้');
  }

  const maxPoints = toNumber(answer.question.points);
  const awardedPoints = payload.awardedPoints !== undefined
    ? payload.awardedPoints
    : (payload.isCorrect ? maxPoints : 0);

  if (awardedPoints < 0 || awardedPoints > maxPoints) {
    throw ApiError.badRequest(`คะแนนที่ให้ต้องอยู่ระหว่าง 0 ถึง ${maxPoints}`);
  }

  await prisma.answer.update({
    where: { id: answerId },
    data: {
      isCorrect: payload.isCorrect,
      awardedPoints: round2(awardedPoints),
      graderComment: payload.graderComment ?? null,
      gradedById: teacherId,
      gradedAt: new Date(),
    },
  });

  // คิดคะแนน + สถานะใหม่ทันที (ตรวจครบเมื่อไรก็เป็น GRADED + ได้เกรดเลย)
  await recalculateSubmission(answer.submissionId);

  // แจ้งครูด้วยกันเอง (แท็บ/อุปกรณ์อื่น) ให้รีเฟรชความคืบหน้าการตรวจ
  emitToUser(teacherId, RealtimeEvent.SUBMISSION_GRADED, {
    examId: answer.submission.examId,
    submissionId: answer.submissionId,
    answerId,
  });

  return getSubmissionDetail(teacherId, answer.submissionId);
}

/** ปุ่ม "ส่งผลไปให้นักเรียน" */
export async function releaseSubmission(teacherId, submissionId) {
  const submission = await getOwnedSubmission(teacherId, submissionId);
  if (submission.status === 'IN_PROGRESS') throw ApiError.conflict('นักเรียนยังไม่ส่งข้อสอบชุดนี้');

  const ungraded = await prisma.answer.count({ where: { submissionId, isCorrect: null } });
  if (ungraded > 0) throw ApiError.unprocessable(`ยังตรวจไม่ครบ เหลืออีก ${ungraded} ข้อ`);

  await recalculateSubmission(submissionId);

  const released = serializeSubmission(await prisma.submission.update({
    where: { id: submissionId },
    data: { status: 'RELEASED', releasedAt: new Date() },
  }));

  // แจ้งนักเรียนทันทีว่าดูผลได้แล้ว (ก่อนหน้านี้จะถูกซ่อนไว้)
  emitToUser(submission.studentId, RealtimeEvent.RESULT_RELEASED, {
    examId: submission.examId,
    submissionId,
  });

  return released;
}

/** ปล่อยผลทั้งชุดข้อสอบ (เฉพาะคนที่ตรวจครบแล้ว) */
export async function releaseExamResults(teacherId, examId) {
  await getOwnedExam(teacherId, examId);

  const candidates = await prisma.submission.findMany({
    where: { examId, status: { in: ['SUBMITTED', 'GRADED'] } },
    select: { id: true, studentId: true, answers: { select: { isCorrect: true } } },
  });

  const ready = candidates.filter((submission) => submission.answers.every((answer) => answer.isCorrect !== null));
  const skipped = candidates.length - ready.length;

  for (const submission of ready) {
    await recalculateSubmission(submission.id);
  }

  const result = await prisma.submission.updateMany({
    where: { id: { in: ready.map((submission) => submission.id) } },
    data: { status: 'RELEASED', releasedAt: new Date() },
  });

  // แจ้งนักเรียนทุกคนที่ถูกปล่อยผลในรอบนี้
  emitToUsers(ready.map((submission) => submission.studentId), RealtimeEvent.RESULT_RELEASED, { examId });

  return { released: result.count, skipped, message: skipped > 0 ? `ปล่อยผลแล้ว ${result.count} คน (ข้าม ${skipped} คนที่ยังตรวจไม่ครบ)` : `ปล่อยผลแล้ว ${result.count} คน` };
}
