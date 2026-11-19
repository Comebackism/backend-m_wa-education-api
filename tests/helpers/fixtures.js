import { prisma } from '../../src/lib/prisma.js';
import { hashPassword } from '../../src/lib/password.js';
import { DEFAULT_CUTOFFS } from '../../src/services/exam.service.js';

/**
 * ตัวสร้างข้อมูลตัวอย่างสำหรับ integration test
 * ทุกฟังก์ชันคืน record จริงจากฐานข้อมูลเทสต์
 */

let sequence = 0;
export function uniqueEmail(prefix = 'user') {
  sequence += 1;
  return `${prefix}.${Date.now()}.${sequence}@test.local`;
}

export const DEFAULT_PASSWORD = 'Password123!';

export async function createUser({
  role = 'TEACHER',
  email,
  password = DEFAULT_PASSWORD,
  fullName = 'ผู้ใช้ทดสอบ',
  studentCode = null,
  isActive = true,
} = {}) {
  return prisma.user.create({
    data: {
      email: email ?? uniqueEmail(role.toLowerCase()),
      passwordHash: await hashPassword(password),
      fullName,
      role,
      studentCode,
      isActive,
    },
  });
}

export function createTeacher(options = {}) {
  return createUser({ ...options, role: 'TEACHER' });
}

export function createStudent(options = {}) {
  return createUser({ ...options, role: 'STUDENT' });
}

export function createAdmin(options = {}) {
  return createUser({ ...options, role: 'ADMIN' });
}

export async function createCourse(teacher, overrides = {}) {
  return prisma.course.create({
    data: {
      code: overrides.code ?? `COURSE-${Date.now()}-${(sequence += 1)}`,
      title: overrides.title ?? 'รายวิชาทดสอบ',
      description: overrides.description ?? null,
      teacherId: teacher.id,
    },
  });
}

export async function createClassroom(teacher, overrides = {}) {
  return prisma.classroom.create({
    data: {
      name: overrides.name ?? 'ม.1/1',
      joinCode: overrides.joinCode ?? `CODE${Date.now()}${(sequence += 1)}`.slice(0, 20),
      courseId: overrides.courseId ?? null,
      teacherId: teacher.id,
    },
  });
}

export async function enroll(student, classroom) {
  return prisma.enrollment.create({
    data: { studentId: student.id, classroomId: classroom.id },
  });
}

export async function createExam(teacher, overrides = {}) {
  return prisma.exam.create({
    data: {
      title: overrides.title ?? 'ข้อสอบทดสอบ',
      description: overrides.description ?? null,
      status: overrides.status ?? 'DRAFT',
      courseId: overrides.courseId ?? null,
      teacherId: teacher.id,
      timeLimitMinutes: overrides.timeLimitMinutes ?? null,
      allowedIpRanges: overrides.allowedIpRanges ?? [],
      defaultDisplayMode: overrides.defaultDisplayMode ?? 'SINGLE_PAGE',
      questionsPerPage: overrides.questionsPerPage ?? 10,
      totalsPoints: overrides.totalsPoints ?? 0,
    },
  });
}

/** เพิ่มข้อปรนัย 1 ข้อ (choices 4 ตัว, เฉลยตัวแรก) */
export async function addChoiceQuestion(exam, {
  prompt = 'ข้อใดถูกต้อง?',
  points = 2,
  order = 1,
  correctIndex = 0,
  labels = ['A', 'B', 'C', 'D'],
} = {}) {
  return prisma.question.create({
    data: {
      examId: exam.id,
      type: 'MULTIPLE_CHOICE',
      prompt,
      points,
      order,
      explanation: 'คำอธิบายเฉลย',
      choices: {
        create: labels.map((label, index) => ({
          label,
          text: `ตัวเลือก ${label}`,
          isCorrect: index === correctIndex,
          order: index,
        })),
      },
    },
    include: { choices: { orderBy: { order: 'asc' } } },
  });
}

/** เพิ่มข้ออัตนัย 1 ข้อ */
export function addTextQuestion(exam, { type = 'SHORT_ANSWER', prompt = 'จงอธิบาย', points = 2, order = 2 } = {}) {
  return prisma.question.create({
    data: {
      examId: exam.id,
      type,
      prompt,
      points,
      order,
      referenceText: 'แนวคำตอบ',
      explanation: 'คำอธิบาย',
    },
  });
}

export async function addDefaultCutoffs(exam) {
  await prisma.gradeCutoff.createMany({
    data: DEFAULT_CUTOFFS.map((cutoff) => ({ examId: exam.id, ...cutoff })),
  });
  return prisma.gradeCutoff.findMany({ where: { examId: exam.id }, orderBy: { minPercent: 'desc' } });
}

export async function assignClassroom(exam, classroom) {
  return prisma.examAssignment.create({ data: { examId: exam.id, classroomId: classroom.id } });
}

export function createSubmission(exam, student, overrides = {}) {
  return prisma.submission.create({
    data: {
      examId: exam.id,
      studentId: student.id,
      status: overrides.status ?? 'IN_PROGRESS',
      displayMode: overrides.displayMode ?? 'SINGLE_PAGE',
      startedAt: overrides.startedAt ?? new Date(),
      expiresAt: overrides.expiresAt ?? null,
      submittedAt: overrides.submittedAt ?? null,
      gradedAt: overrides.gradedAt ?? null,
      releasedAt: overrides.releasedAt ?? null,
      autoScore: overrides.autoScore ?? 0,
      manualScore: overrides.manualScore ?? 0,
      totalScore: overrides.totalScore ?? 0,
      percent: overrides.percent ?? 0,
      grade: overrides.grade ?? null,
    },
  });
}

/**
 * ชุดข้อสอบ "พร้อมสอบ" — ข้อปรนัย 1 ข้อ (2 คะแนน) + ข้ออัตนัย 1 ข้อ (2 คะแนน)
 * มอบหมายให้ classroom แล้ว ตั้งเกณฑ์ตัดเกรดมาตรฐาน และตั้งสถานะ PUBLISHED
 */
export async function createPublishedExam(teacher, classroom, { status = 'PUBLISHED', withText = true } = {}) {
  const exam = await createExam(teacher, { status: 'DRAFT', title: 'ข้อสอบพร้อมสอบ' });
  const mc = await addChoiceQuestion(exam, { points: 2, order: 1 });
  const text = withText ? await addTextQuestion(exam, { points: 2, order: 2 }) : null;

  await assignClassroom(exam, classroom);
  await addDefaultCutoffs(exam);
  await prisma.exam.update({
    where: { id: exam.id },
    data: { status, totalsPoints: withText ? 4 : 2 },
  });

  return { exam: await prisma.exam.findUnique({ where: { id: exam.id } }), mc, text };
}