import { prisma } from '../lib/prisma.js';
import { ApiError } from '../lib/errors.js';
import { getExamForStudent, getOwnedClassroom, getOwnedCourse, getOwnedExam } from '../lib/access.js';
import { recalculateExamTotals, recalculateSubmission } from '../lib/grading.js';
import { serializeStudentSubmission } from '../lib/serialize.js';
import { emitToUsers } from '../realtime/emit.js';
import { RealtimeEvent } from '../realtime/events.js';

/** เกณฑ์ตัดเกรดมาตรฐาน A–F (เปอร์เซ็นต์) — ใช้เมื่อครูไม่ได้กำหนดเอง */
export const DEFAULT_CUTOFFS = [
  { grade: 'A', minPercent: 80 },
  { grade: 'B+', minPercent: 75 },
  { grade: 'B', minPercent: 70 },
  { grade: 'C+', minPercent: 65 },
  { grade: 'C', minPercent: 60 },
  { grade: 'D+', minPercent: 55 },
  { grade: 'D', minPercent: 50 },
  { grade: 'F', minPercent: 0 },
];

const questionInclude = {
  choices: { orderBy: { order: 'asc' } },
};

export async function createExam(teacherId, payload) {
  if (payload.courseId) await getOwnedCourse(teacherId, payload.courseId);

  return prisma.exam.create({
    data: {
      title: payload.title,
      description: payload.description ?? null,
      courseId: payload.courseId ?? null,
      teacherId,
      timeLimitMinutes: payload.timeLimitMinutes ?? null,
      defaultDisplayMode: payload.defaultDisplayMode ?? 'SINGLE_PAGE',
      questionsPerPage: payload.questionsPerPage ?? 10,
    },
    include: { questions: true, cutoffs: true, course: true },
  });
}

export async function listExams(teacherId, { status, courseId } = {}) {
  return prisma.exam.findMany({
    where: { teacherId, ...(status ? { status } : {}), ...(courseId ? { courseId } : {}) },
    include: {
      course: { select: { id: true, code: true, title: true } },
      _count: { select: { questions: true, submissions: true, assignments: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getExamDetail(teacherId, examId) {
  const exam = await getOwnedExam(teacherId, examId, {
    course: true,
    questions: { include: questionInclude, orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] },
    cutoffs: { orderBy: { minPercent: 'desc' } },
    assignments: {
      include: {
        classroom: {
          select: { id: true, name: true, joinCode: true, _count: { select: { enrollments: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    },
    _count: { select: { submissions: true } },
  });

  const statusCounts = await prisma.submission.groupBy({
    by: ['status'],
    where: { examId },
    _count: { _all: true },
  });

  return { ...exam, submissionStats: statusCounts.map((row) => ({ status: row.status, count: row._count._all })) };
}

export async function updateExam(teacherId, examId, payload) {
  await getOwnedExam(teacherId, examId);
  if (payload.courseId) await getOwnedCourse(teacherId, payload.courseId);

  return prisma.exam.update({
    where: { id: examId },
    data: {
      ...(payload.title !== undefined ? { title: payload.title } : {}),
      ...(payload.description !== undefined ? { description: payload.description } : {}),
      ...(payload.courseId !== undefined ? { courseId: payload.courseId } : {}),
      ...(payload.timeLimitMinutes !== undefined ? { timeLimitMinutes: payload.timeLimitMinutes } : {}),
      ...(payload.defaultDisplayMode !== undefined ? { defaultDisplayMode: payload.defaultDisplayMode } : {}),
      ...(payload.questionsPerPage !== undefined ? { questionsPerPage: payload.questionsPerPage } : {}),
    },
  });
}

export async function deleteExam(teacherId, examId, { force = false } = {}) {
  await getOwnedExam(teacherId, examId);
  const submissionCount = await prisma.submission.count({ where: { examId } });

  if (submissionCount > 0 && !force) {
    throw ApiError.conflict(`ข้อสอบนี้มีการส่งคำตอบแล้ว ${submissionCount} ครั้ง — ถ้าต้องการลบจริงให้ส่ง force = true`);
  }

  await prisma.exam.delete({ where: { id: examId } });
  return { id: examId };
}

// ---------------------------------------------------------------------------
// questions
// ---------------------------------------------------------------------------

function validateQuestionPayload(type, choices) {
  if (type !== 'MULTIPLE_CHOICE') return;

  if (!choices || choices.length < 2) {
    throw ApiError.badRequest('ข้อปรนัยต้องมีตัวเลือกอย่างน้อย 2 ตัวเลือก');
  }
  const correctCount = choices.filter((choice) => choice.isCorrect).length;
  if (correctCount !== 1) {
    throw ApiError.badRequest('ข้อปรนัยต้องมีเฉลยที่ถูกต้อง 1 ตัวเลือกเท่านั้น');
  }
}

export async function addQuestion(teacherId, examId, payload) {
  await getOwnedExam(teacherId, examId);
  validateQuestionPayload(payload.type, payload.choices);

  const last = await prisma.question.findFirst({
    where: { examId },
    orderBy: { order: 'desc' },
    select: { order: true },
  });

  const question = await prisma.question.create({
    data: {
      examId,
      type: payload.type,
      prompt: payload.prompt,
      points: payload.points,
      order: payload.order ?? (last?.order ?? 0) + 1,
      referenceText: payload.referenceText ?? null,
      explanation: payload.explanation ?? null,
      ...(payload.type === 'MULTIPLE_CHOICE'
        ? {
            choices: {
              create: payload.choices.map((choice, index) => ({
                label: choice.label,
                text: choice.text,
                isCorrect: choice.isCorrect,
                order: choice.order ?? index,
              })),
            },
          }
        : {}),
    },
    include: questionInclude,
  });

  await recalculateExamTotals(examId);
  return question;
}

export async function updateQuestion(teacherId, examId, questionId, payload) {
  await getOwnedExam(teacherId, examId);

  const existing = await prisma.question.findFirst({ where: { id: questionId, examId }, include: questionInclude });
  if (!existing) throw ApiError.notFound('ไม่พบข้อสอบข้อนี้');

  const nextType = payload.type ?? existing.type;
  const nextChoices = payload.choices;
  validateQuestionPayload(nextType, nextType === 'MULTIPLE_CHOICE' ? nextChoices ?? existing.choices : undefined);

  const question = await prisma.$transaction(async (tx) => {
    if (nextChoices !== undefined) {
      await tx.choice.deleteMany({ where: { questionId } });
    }

    return tx.question.update({
      where: { id: questionId },
      data: {
        ...(payload.type !== undefined ? { type: payload.type } : {}),
        ...(payload.prompt !== undefined ? { prompt: payload.prompt } : {}),
        ...(payload.points !== undefined ? { points: payload.points } : {}),
        ...(payload.order !== undefined ? { order: payload.order } : {}),
        ...(payload.referenceText !== undefined ? { referenceText: payload.referenceText } : {}),
        ...(payload.explanation !== undefined ? { explanation: payload.explanation } : {}),
        ...(nextChoices !== undefined
          ? {
              choices: {
                create: nextChoices.map((choice, index) => ({
                  label: choice.label,
                  text: choice.text,
                  isCorrect: choice.isCorrect,
                  order: choice.order ?? index,
                })),
              },
            }
          : {}),
      },
      include: questionInclude,
    });
  });

  await recalculateExamTotals(examId);
  return question;
}

export async function deleteQuestion(teacherId, examId, questionId) {
  await getOwnedExam(teacherId, examId);
  const result = await prisma.question.deleteMany({ where: { id: questionId, examId } });
  if (result.count === 0) throw ApiError.notFound('ไม่พบข้อสอบข้อนี้');

  await recalculateExamTotals(examId);
  return { id: questionId };
}

export async function reorderQuestions(teacherId, examId, items) {
  await getOwnedExam(teacherId, examId);
  const ids = items.map((item) => item.id);
  const owned = await prisma.question.findMany({ where: { examId, id: { in: ids } }, select: { id: true } });
  if (owned.length !== ids.length) throw ApiError.badRequest('มีข้อสอบบางข้อที่ไม่ได้อยู่ในชุดนี้');

  await prisma.$transaction(
    items.map((item) => prisma.question.update({ where: { id: item.id }, data: { order: item.order } })),
  );
  return prisma.question.findMany({ where: { examId }, orderBy: { order: 'asc' }, select: { id: true, order: true } });
}

// ---------------------------------------------------------------------------
// grade cutoffs & assignments
// ---------------------------------------------------------------------------

export async function replaceCutoffs(teacherId, examId, cutoffs) {
  await getOwnedExam(teacherId, examId);

  const grades = cutoffs.map((cutoff) => cutoff.grade);
  if (new Set(grades).size !== grades.length) {
    throw ApiError.badRequest('มีเกรดซ้ำกันในเกณฑ์ตัดเกรด');
  }

  await prisma.$transaction(async (tx) => {
    await tx.gradeCutoff.deleteMany({ where: { examId } });
    await tx.gradeCutoff.createMany({
      data: cutoffs.map((cutoff) => ({ examId, grade: cutoff.grade, minPercent: cutoff.minPercent })),
    });
  });

  // เกณฑ์เปลี่ยน → คะแนนเกรดของคนที่ตรวจแล้วต้องคิดใหม่
  const submissions = await prisma.submission.findMany({
    where: { examId, status: { in: ['SUBMITTED', 'GRADED', 'RELEASED'] } },
    select: { id: true },
  });
  for (const submission of submissions) {
    await recalculateSubmission(submission.id);
  }

  return prisma.gradeCutoff.findMany({ where: { examId }, orderBy: { minPercent: 'desc' } });
}

export async function assignClassroom(teacherId, examId, payload) {
  await getOwnedExam(teacherId, examId);
  await getOwnedClassroom(teacherId, payload.classroomId);

  const existing = await prisma.examAssignment.findUnique({
    where: { examId_classroomId: { examId, classroomId: payload.classroomId } },
  });
  if (existing) throw ApiError.conflict('มอบหมายข้อสอบให้ห้องเรียนนี้แล้ว');

  return prisma.examAssignment.create({
    data: {
      examId,
      classroomId: payload.classroomId,
      availableFrom: payload.availableFrom ?? null,
      availableTo: payload.availableTo ?? null,
    },
    include: { classroom: { select: { id: true, name: true } } },
  });
}

export async function unassignClassroom(teacherId, examId, assignmentId) {
  await getOwnedExam(teacherId, examId);
  const result = await prisma.examAssignment.deleteMany({ where: { id: assignmentId, examId } });
  if (result.count === 0) throw ApiError.notFound('ไม่พบการมอบหมายนี้');
  return { id: assignmentId };
}

export async function getCutoffs(teacherId, examId) {
  await getOwnedExam(teacherId, examId);
  return prisma.gradeCutoff.findMany({ where: { examId }, orderBy: { minPercent: 'desc' } });
}

// ---------------------------------------------------------------------------
// publishing
// ---------------------------------------------------------------------------

export async function publishExam(teacherId, examId) {
  const exam = await getOwnedExam(teacherId, examId, { _count: { select: { questions: true, assignments: true } } });
  if (exam._count.questions === 0) throw ApiError.badRequest('ยังไม่มีข้อสอบในชุดนี้');
  if (exam._count.assignments === 0) throw ApiError.badRequest('ยังไม่ได้มอบหมายข้อสอบให้ห้องเรียนใดเลย');

  // ยังไม่ตั้งเกณฑ์ตัดเกรด → ใส่ A–F มาตรฐานให้ก่อน
  const cutoffCount = await prisma.gradeCutoff.count({ where: { examId } });
  if (cutoffCount === 0) {
    await prisma.gradeCutoff.createMany({
      data: DEFAULT_CUTOFFS.map((cutoff) => ({ examId, ...cutoff })),
    });
  }

  const published = await prisma.exam.update({ where: { id: examId }, data: { status: 'PUBLISHED' } });

  // แจ้งนักเรียนที่อยู่ในห้องซึ่งถูกมอบหมาย (เฉพาะตอนเปิดสอบครั้งแรก)
  if (exam.status !== 'PUBLISHED') {
    const assignments = await prisma.examAssignment.findMany({
      where: { examId },
      select: { classroom: { select: { enrollments: { select: { studentId: true } } } } },
    });
    const studentIds = assignments.flatMap((assignment) =>
      assignment.classroom.enrollments.map((enrollment) => enrollment.studentId),
    );
    emitToUsers(studentIds, RealtimeEvent.EXAM_PUBLISHED, { examId, title: published.title });
  }

  return published;
}

export async function closeExam(teacherId, examId) {
  await getOwnedExam(teacherId, examId);
  return prisma.exam.update({ where: { id: examId }, data: { status: 'CLOSED' } });
}

// ---------------------------------------------------------------------------
// student side
// ---------------------------------------------------------------------------

export async function listStudentExams(studentId) {
  const exams = await prisma.exam.findMany({
    where: {
      status: 'PUBLISHED',
      assignments: { some: { classroom: { enrollments: { some: { studentId } } } } },
    },
    include: {
      course: { select: { id: true, code: true, title: true } },
      _count: { select: { questions: true } },
      submissions: {
        where: { studentId },
        select: { id: true, status: true, startedAt: true, expiresAt: true, submittedAt: true, totalScore: true, percent: true, grade: true },
      },
    },
    orderBy: { updatedAt: 'desc' },
  });

  return exams.map((exam) => {
    const { submissions, _count, ...rest } = exam;
    const raw = submissions[0] ?? null;
    // "ไม่รั่ว": โชว์คะแนน/เกรดเฉพาะเมื่อครูกดปล่อยผลแล้วเท่านั้น
    const released = raw?.status === 'RELEASED';
    const mySubmission = raw
      ? {
          id: raw.id,
          status: raw.status,
          startedAt: raw.startedAt,
          expiresAt: raw.expiresAt,
          submittedAt: raw.submittedAt,
          ...(released
            ? { totalScore: Number(raw.totalScore), percent: Number(raw.percent), grade: raw.grade }
            : {}),
        }
      : null;

    return {
      ...rest,
      questionsCount: _count.questions,
      mySubmission,
      canStart: !raw || raw.status === 'IN_PROGRESS',
    };
  });
}

/**
 * รายละเอียดข้อสอบสำหรับนักเรียน — "ไม่รั่ว": ไม่มีเฉลย/คำอธิบาย/คะแนนของข้อ
 */
export async function getStudentExamDetail(examId, studentId) {
  const exam = await getExamForStudent(examId, studentId, {
    questions: {
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      include: {
        choices: {
          orderBy: { order: 'asc' },
          select: { id: true, label: true, text: true, order: true },
        },
      },
    },
    assignments: { include: { classroom: { include: { enrollments: { select: { studentId: true } } } } } },
  });

  const submission = await prisma.submission.findUnique({
    where: { examId_studentId: { examId, studentId } },
    include: { answers: { select: { questionId: true, choiceId: true, textAnswer: true } } },
  });

  const answered = new Map((submission?.answers ?? []).map((answer) => [answer.questionId, answer]));

  return {
    id: exam.id,
    title: exam.title,
    description: exam.description,
    status: exam.status,
    timeLimitMinutes: exam.timeLimitMinutes,
    defaultDisplayMode: exam.defaultDisplayMode,
    questionsPerPage: exam.questionsPerPage,
    totalsPoints: Number(exam.totalsPoints),
    serverTime: new Date(),
    questions: exam.questions.map((question) => ({
      id: question.id,
      type: question.type,
      prompt: question.prompt,
      order: question.order,
      choices: question.choices,
      myAnswer: answered.get(question.id) ?? null,
    })),
    mySubmission: serializeStudentSubmission(submission),
  };
}
