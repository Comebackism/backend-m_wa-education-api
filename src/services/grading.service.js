import { prisma } from '../lib/prisma.js';
import { ApiError } from '../lib/errors.js';
import { getOwnedExam, getOwnedSubmission } from '../lib/access.js';
import { recalculateSubmission, round2 } from '../lib/grading.js';
import { serializeTeacherSubmission, toNumber } from '../lib/serialize.js';
import { toCsv } from '../lib/csv.js';
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
    const serialized = serializeTeacherSubmission(rest);
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
    ...serializeTeacherSubmission(submission),
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

  const released = serializeTeacherSubmission(await prisma.submission.update({
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

/**
 * สถิติภาพรวมของข้อสอบ 1 ชุด (สำหรับหน้าตรวจ/dashboard ของครู) — read-only
 * ครอบคลุม: จำนวนใบตามสถานะ, งานที่ยังต้องตรวจ/รอปล่อยผล,
 * คะแนนเฉลี่ย–สูงสุด–ต่ำสุด, การกระจายเกรด และอัตราตอบถูกของแต่ละข้อ
 */
export async function getExamStats(teacherId, examId) {
  const exam = await getOwnedExam(teacherId, examId, {
    questions: {
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, type: true, prompt: true, points: true, order: true },
    },
    cutoffs: { orderBy: { minPercent: 'desc' } },
  });

  const submissions = await prisma.submission.findMany({
    where: { examId },
    select: {
      status: true,
      totalScore: true,
      percent: true,
      grade: true,
      answers: { select: { questionId: true, choiceId: true, textAnswer: true, isCorrect: true, awardedPoints: true } },
    },
  });

  const counts = { IN_PROGRESS: 0, SUBMITTED: 0, GRADED: 0, RELEASED: 0 };
  let needsGrading = 0;

  // สะสมต่อข้อ ไว้คำนวณอัตราตอบถูก
  const perQuestion = new Map(
    exam.questions.map((question) => [question.id, { answered: 0, graded: 0, correct: 0, awarded: 0 }]),
  );

  const scored = [];
  for (const submission of submissions) {
    counts[submission.status] = (counts[submission.status] ?? 0) + 1;

    const ungraded = submission.answers.filter((answer) => answer.isCorrect === null).length;
    if (submission.status === 'SUBMITTED' && ungraded > 0) needsGrading += 1;

    // นับคะแนนเฉพาะใบที่ตรวจครบแล้ว (ไม่เอาคะแนนบางส่วนของใบที่ยังตรวจไม่ครบมาปน)
    if (submission.status === 'GRADED' || submission.status === 'RELEASED') scored.push(submission);

    for (const answer of submission.answers) {
      const bucket = perQuestion.get(answer.questionId);
      if (!bucket) continue;
      const hasAnswer = answer.choiceId !== null || (answer.textAnswer !== null && answer.textAnswer !== '');
      if (hasAnswer) bucket.answered += 1;
      if (answer.isCorrect !== null) bucket.graded += 1;
      if (answer.isCorrect === true) bucket.correct += 1;
      if (answer.awardedPoints !== null) bucket.awarded += toNumber(answer.awardedPoints);
    }
  }

  const mean = (list) => (list.length ? round2(list.reduce((sum, value) => sum + value, 0) / list.length) : 0);
  const totalScores = scored.map((submission) => toNumber(submission.totalScore));
  const percents = scored.map((submission) => toNumber(submission.percent));

  return {
    exam: {
      id: exam.id,
      title: exam.title,
      status: exam.status,
      totalsPoints: toNumber(exam.totalsPoints),
    },
    summary: {
      submissions: submissions.length,
      inProgress: counts.IN_PROGRESS,
      submitted: counts.SUBMITTED,
      graded: counts.GRADED,
      released: counts.RELEASED,
      needsGrading, /// ยังมีคำตอบที่ isCorrect = null (ต้องตรวจอัตนัยต่อ)
      pendingRelease: counts.GRADED, /// ตรวจครบแล้ว รอครูปล่อยผล
    },
    scores: {
      scoredCount: scored.length,
      averageTotal: mean(totalScores),
      averagePercent: mean(percents),
      highest: totalScores.length ? round2(Math.max(...totalScores)) : 0,
      lowest: totalScores.length ? round2(Math.min(...totalScores)) : 0,
    },
    gradeDistribution: exam.cutoffs.map((cutoff) => ({
      grade: cutoff.grade,
      minPercent: toNumber(cutoff.minPercent),
      count: scored.filter((submission) => submission.grade === cutoff.grade).length,
    })),
    questions: exam.questions.map((question) => {
      const bucket = perQuestion.get(question.id);
      return {
        questionId: question.id,
        order: question.order,
        type: question.type,
        prompt: question.prompt,
        points: toNumber(question.points),
        answeredCount: bucket.answered,
        gradedCount: bucket.graded,
        correctCount: bucket.correct,
        correctRate: bucket.graded > 0 ? round2((bucket.correct / bucket.graded) * 100) : null,
        averageAwardedPoints: bucket.graded > 0 ? round2(bucket.awarded / bucket.graded) : null,
      };
    }),
  };
}

const CSV_STATUS_LABEL = {
  IN_PROGRESS: 'กำลังทำ',
  SUBMITTED: 'ส่งแล้ว รอตรวจ',
  GRADED: 'ตรวจแล้ว รอปล่อยผล',
  RELEASED: 'ปล่อยผลแล้ว',
};

const CSV_HEADERS = [
  'ลำดับ',
  'รหัสนักเรียน',
  'ชื่อ-นามสกุล',
  'อีเมล',
  'สถานะ',
  'ข้อที่ยังไม่ตรวจ',
  'คะแนนปรนัย',
  'คะแนนอัตนัย',
  'คะแนนรวม',
  'คะแนนเต็ม',
  'เปอร์เซ็นต์',
  'เกรด',
  'ส่งเมื่อ',
  'ปล่อยผลเมื่อ',
];

/**
 * ส่งออกผลคะแนนทั้งชุดเป็น CSV (สำหรับครู) — เปิดใน Excel ได้ทันที (UTF-8 BOM)
 * รองรับ ?status= เพื่อกรองเฉพาะสถานะ (เช่น RELEASED อย่างเดียว)
 */
export async function exportExamResultsCsv(teacherId, examId, { status } = {}) {
  const exam = await getOwnedExam(teacherId, examId);

  const submissions = await prisma.submission.findMany({
    where: { examId, ...(status ? { status } : {}) },
    include: {
      student: { select: { fullName: true, email: true, studentCode: true } },
      _count: { select: { answers: { where: { isCorrect: null } } } },
    },
    orderBy: [{ student: { studentCode: 'asc' } }, { student: { fullName: 'asc' } }],
  });

  const totalsPoints = toNumber(exam.totalsPoints);

  const rows = submissions.map((submission, index) => {
    const started = submission.status !== 'IN_PROGRESS';
    const finished = submission.status === 'GRADED' || submission.status === 'RELEASED';

    return [
      index + 1,
      submission.student.studentCode,
      submission.student.fullName,
      submission.student.email,
      CSV_STATUS_LABEL[submission.status] ?? submission.status,
      submission._count.answers,
      started ? toNumber(submission.autoScore) : '',
      started ? toNumber(submission.manualScore) : '',
      started ? toNumber(submission.totalScore) : '',
      totalsPoints,
      started ? toNumber(submission.percent) : '',
      finished ? submission.grade : '',
      submission.submittedAt ? submission.submittedAt.toISOString() : '',
      submission.releasedAt ? submission.releasedAt.toISOString() : '',
    ];
  });

  return {
    title: exam.title,
    filename: `exam-results-${exam.id}.csv`,
    count: submissions.length,
    content: toCsv(CSV_HEADERS, rows),
  };
}
