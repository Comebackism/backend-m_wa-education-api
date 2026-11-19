import { prisma } from '../lib/prisma.js';
import { ApiError } from '../lib/errors.js';
import { toNumber } from '../lib/serialize.js';

/**
 * ฝั่งนักเรียน — ดูผลสอบ
 * กฎ "ไม่รั่ว": เห็นคะแนน/เฉลย/หมายเหตุของครู เฉพาะเมื่อสถานะ = RELEASED (ครูกดปล่อยผลแล้ว)
 */

export async function listStudentResults(studentId, { examId } = {}) {
  const submissions = await prisma.submission.findMany({
    where: { studentId, status: { in: ['SUBMITTED', 'GRADED', 'RELEASED'] }, ...(examId ? { examId } : {}) },
    include: {
      exam: {
        select: {
          id: true,
          title: true,
          totalsPoints: true,
          course: { select: { code: true, title: true } },
        },
      },
    },
    orderBy: [{ submittedAt: 'desc' }],
  });

  return submissions.map((submission) => {
    const released = submission.status === 'RELEASED';
    return {
      submissionId: submission.id,
      exam: submission.exam,
      status: submission.status,
      submittedAt: submission.submittedAt,
      pendingTeacherAction: !released,
      ...(released
        ? {
            totalPoints: toNumber(submission.exam.totalsPoints),
            autoScore: toNumber(submission.autoScore),
            manualScore: toNumber(submission.manualScore),
            totalScore: toNumber(submission.totalScore),
            percent: toNumber(submission.percent),
            grade: submission.grade,
            releasedAt: submission.releasedAt,
          }
        : {}),
    };
  });
}

export async function getStudentResult(studentId, submissionId) {
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    include: {
      exam: {
        include: {
          cutoffs: { orderBy: { minPercent: 'desc' } },
          questions: {
            include: { choices: { orderBy: { order: 'asc' } } },
            orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
          },
        },
      },
      answers: true,
    },
  });

  if (!submission) throw ApiError.notFound('ไม่พบผลสอบนี้');
  if (submission.studentId !== studentId) throw ApiError.forbidden('ผลสอบนี้ไม่ใช่ของคุณ');
  if (submission.status !== 'RELEASED') {
    throw ApiError.forbidden('ผลสอบยังไม่ถูกปล่อย กรุณารอครูประกาศผล');
  }

  const answerMap = new Map(submission.answers.map((answer) => [answer.questionId, answer]));

  return {
    submissionId: submission.id,
    exam: {
      id: submission.exam.id,
      title: submission.exam.title,
      totalsPoints: toNumber(submission.exam.totalsPoints),
      cutoffs: submission.exam.cutoffs.map((cutoff) => ({
        grade: cutoff.grade,
        minPercent: toNumber(cutoff.minPercent),
      })),
    },
    status: submission.status,
    submittedAt: submission.submittedAt,
    releasedAt: submission.releasedAt,
    summary: {
      autoScore: toNumber(submission.autoScore),
      manualScore: toNumber(submission.manualScore),
      totalScore: toNumber(submission.totalScore),
      percent: toNumber(submission.percent),
      grade: submission.grade,
    },
    questions: submission.exam.questions.map((question) => {
      const answer = answerMap.get(question.id);
      return {
        questionId: question.id,
        type: question.type,
        prompt: question.prompt,
        points: toNumber(question.points),
        explanation: question.explanation,
        referenceText: question.referenceText,
        choices: question.choices.map((choice) => ({
          id: choice.id,
          label: choice.label,
          text: choice.text,
          isCorrect: choice.isCorrect,
        })),
        myAnswer: {
          choiceId: answer?.choiceId ?? null,
          textAnswer: answer?.textAnswer ?? null,
        },
        result: {
          isCorrect: answer?.isCorrect ?? null,
          awardedPoints: toNumber(answer?.awardedPoints),
          autoGraded: answer?.autoGraded ?? false,
          // หมายเหตุของครู: ผิดเพราะอะไร / ถูกเพราะอะไร
          teacherComment: answer?.graderComment ?? null,
        },
      };
    }),
  };
}
