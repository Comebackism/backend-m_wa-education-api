import { prisma } from './prisma.js';
import { ApiError } from './errors.js';
import { toNumber } from './serialize.js';

/**
 * เทียบเปอร์เซ็นต์กับเกณฑ์ตัดเกรดของข้อสอบ
 * cutoffs = [{ grade: 'A', minPercent: 80 }, ...] โดย minPercent เป็น "ขอบล่างแบบรวม"
 */
export function resolveGrade(cutoffs, percent) {
  const sorted = [...cutoffs].sort((a, b) => toNumber(b.minPercent) - toNumber(a.minPercent));
  const hit = sorted.find((cutoff) => percent >= toNumber(cutoff.minPercent));
  return hit?.grade ?? null;
}

export function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

/**
 * คิดคะแนนใหม่ทั้งหมดจากการตอบของนักเรียนทุกข้อ
 *   autoScore   = ปรนัย (autoGraded = true) → ตรวจอัตโนมัติจากเฉลย
 *   manualScore = อัตนัย → คะแนนที่ครูให้ (awardedPoints)
 *   percent     = totalScore / คะแนนเต็ม * 100
 *   status      = GRADED เมื่อตรวจครบทุกข้อ, SUBMITTED = "ส่งแล้ว รอตรวจ"
 */
export async function recalculateSubmission(submissionId) {
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    include: {
      exam: { include: { cutoffs: true, questions: { select: { points: true } } } },
      answers: true,
    },
  });

  if (!submission) throw ApiError.notFound('ไม่พบการส่งข้อสอบ');

  let autoScore = 0;
  let manualScore = 0;
  let ungradedCount = 0;

  for (const answer of submission.answers) {
    if (answer.isCorrect === null || answer.awardedPoints === null) {
      ungradedCount += 1;
      continue;
    }
    if (answer.autoGraded) autoScore += toNumber(answer.awardedPoints);
    else manualScore += toNumber(answer.awardedPoints);
  }

  const totalScore = round2(autoScore + manualScore);
  const totalPoints = submission.exam.questions.reduce((sum, question) => sum + toNumber(question.points), 0);
  const percent = totalPoints > 0 ? round2((totalScore / totalPoints) * 100) : 0;
  const grade = resolveGrade(submission.exam.cutoffs, percent);
  const allGraded = ungradedCount === 0;

  const status = submission.status === 'RELEASED' ? 'RELEASED' : allGraded ? 'GRADED' : 'SUBMITTED';

  return prisma.submission.update({
    where: { id: submissionId },
    data: {
      autoScore,
      manualScore,
      totalScore,
      percent,
      grade,
      status,
      gradedAt: allGraded && !submission.gradedAt ? new Date() : submission.gradedAt,
    },
  });
}

/**
 * คิดคะแนนเต็มของข้อสอบใหม่ (เรียกหลังเพิ่ม/แก้/ลบข้อสอบ)
 */
export async function recalculateExamTotals(examId) {
  const questions = await prisma.question.findMany({
    where: { examId },
    select: { points: true },
  });
  const totalsPoints = round2(questions.reduce((sum, question) => sum + toNumber(question.points), 0));

  await prisma.exam.update({ where: { id: examId }, data: { totalsPoints } });

  const submissions = await prisma.submission.findMany({
    where: { examId, status: { in: ['SUBMITTED', 'GRADED', 'RELEASED'] } },
    select: { id: true },
  });
  for (const submission of submissions) {
    await recalculateSubmission(submission.id);
  }

  return totalsPoints;
}

/**
 * ตรวจปรนัยอัตโนมัติ ตอนกดส่งข้อสอบ
 * อัตนัยยังเป็น null → รอครูตรวจ ("ส่งแล้ว รอตรวจ")
 */
export function autoGradeAnswer(question, answer) {
  if (question.type !== 'MULTIPLE_CHOICE') {
    return { isCorrect: null, autoGraded: false, awardedPoints: null };
  }

  const correctChoice = question.choices.find((choice) => choice.isCorrect);
  const isCorrect = Boolean(correctChoice && answer.choiceId && answer.choiceId === correctChoice.id);

  return {
    isCorrect,
    autoGraded: true,
    awardedPoints: isCorrect ? toNumber(question.points) : 0,
  };
}
