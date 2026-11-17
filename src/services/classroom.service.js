import { prisma } from '../lib/prisma.js';
import { ApiError, publicUser } from '../lib/errors.js';
import { hashPassword } from '../lib/password.js';
import { getOwnedClassroom, getOwnedCourse } from '../lib/access.js';

const JOIN_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomCode(length = 6) {
  let code = '';
  for (let index = 0; index < length; index += 1) {
    code += JOIN_CODE_ALPHABET[Math.floor(Math.random() * JOIN_CODE_ALPHABET.length)];
  }
  return code;
}

async function generateJoinCode() {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = randomCode();
    const exists = await prisma.classroom.findUnique({ where: { joinCode: code } });
    if (!exists) return code;
  }
  throw ApiError.conflict('สร้างรหัสห้องเรียนไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
}

function randomPassword(length = 8) {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let password = '';
  for (let index = 0; index < length; index += 1) {
    password += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return password;
}

/** นักเรียนต้องอยู่ในห้องเรียนของครูคนนี้เท่านั้น */
export async function assertStudentOfTeacher(teacherId, studentId) {
  const student = await prisma.user.findFirst({
    where: {
      id: studentId,
      role: 'STUDENT',
      enrollments: { some: { classroom: { teacherId } } },
    },
  });
  if (!student) throw ApiError.notFound('ไม่พบนักเรียนคนนี้ในห้องเรียนของคุณ');
  return student;
}

export async function createClassroom(teacherId, { name, courseId }) {
  const course = await getOwnedCourse(teacherId, courseId);
  return prisma.classroom.create({
    data: { name, courseId: course.id, teacherId, joinCode: await generateJoinCode() },
    include: { course: true },
  });
}

export async function listClassrooms(teacherId, { courseId } = {}) {
  return prisma.classroom.findMany({
    where: { teacherId, ...(courseId ? { courseId } : {}) },
    include: {
      course: true,
      _count: { select: { enrollments: true, examAssignments: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getClassroomDetail(teacherId, classroomId) {
  const classroom = await getOwnedClassroom(teacherId, classroomId);
  const [students, assignments] = await Promise.all([
    listStudents(classroomId),
    prisma.examAssignment.findMany({
      where: { classroomId },
      include: { exam: { select: { id: true, title: true, status: true } } },
      orderBy: { createdAt: 'desc' },
    }),
  ]);
  return { ...classroom, students, examAssignments: assignments };
}

export async function listStudents(classroomId) {
  const enrollments = await prisma.enrollment.findMany({
    where: { classroomId },
    include: { student: true },
    orderBy: { student: { fullName: 'asc' } },
  });
  return enrollments.map((enrollment) => ({
    ...publicUser(enrollment.student),
    enrolledAt: enrollment.enrolledAt,
  }));
}

/**
 * เพิ่มนักเรียนเข้าห้องเรียน (ปุ่ม "+" ของครู)
 * - ถ้ามีบัญชีอยู่แล้ว → ส่ง studentId / email / studentCode มาเพื่อผูกเข้าห้อง
 * - ถ้ายังไม่มีบัญชี → ส่ง email + fullName มา ระบบจะสร้างบัญชีให้ พร้อมรหัสผ่านชั่วคราว
 */
export async function addStudentToClassroom(teacherId, classroomId, payload) {
  await getOwnedClassroom(teacherId, classroomId);

  let student = null;
  if (payload.studentId) {
    student = await prisma.user.findUnique({ where: { id: payload.studentId } });
  } else if (payload.email) {
    student = await prisma.user.findUnique({ where: { email: payload.email } });
  } else if (payload.studentCode) {
    student = await prisma.user.findUnique({ where: { studentCode: payload.studentCode } });
  }

  if (student && student.role !== 'STUDENT') {
    throw ApiError.badRequest('ผู้ใช้รายนี้ไม่ใช่บทบาท STUDENT');
  }

  let temporaryPassword = null;
  if (!student) {
    if (!payload.email || !payload.fullName) {
      throw ApiError.badRequest('ต้องระบุ email และ fullName เมื่อสร้างบัญชีนักเรียนใหม่');
    }
    temporaryPassword = payload.password ?? payload.studentCode ?? randomPassword();
    student = await prisma.user.create({
      data: {
        email: payload.email,
        fullName: payload.fullName,
        studentCode: payload.studentCode ?? null,
        role: 'STUDENT',
        passwordHash: await hashPassword(temporaryPassword),
      },
    });
  }

  const existing = await prisma.enrollment.findUnique({
    where: { classroomId_studentId: { classroomId, studentId: student.id } },
  });
  if (existing) throw ApiError.conflict('นักเรียนคนนี้อยู่ในห้องเรียนนี้แล้ว');

  await prisma.enrollment.create({ data: { classroomId, studentId: student.id } });

  return { student: publicUser(student), temporaryPassword };
}

export async function removeStudentFromClassroom(teacherId, classroomId, studentId) {
  await getOwnedClassroom(teacherId, classroomId);
  const result = await prisma.enrollment.deleteMany({ where: { classroomId, studentId } });
  if (result.count === 0) throw ApiError.notFound('ไม่พบนักเรียนคนนี้ในห้องเรียน');
  return { studentId, classroomId };
}

/** ตรวจสิทธิ์แบบเบา ๆ (ใช้เมื่อไม่ต้องคืนข้อมูลห้อง) */
export async function ensureOwned(teacherId, classroomId) {
  await getOwnedClassroom(teacherId, classroomId);
  return { id: classroomId };
}

export async function updateClassroom(teacherId, classroomId, { name }) {
  await getOwnedClassroom(teacherId, classroomId);
  return prisma.classroom.update({ where: { id: classroomId }, data: { name } });
}

export async function deleteClassroom(teacherId, classroomId) {
  const classroom = await getOwnedClassroom(teacherId, classroomId);

  const submissionCount = await prisma.submission.count({
    where: { exam: { assignments: { some: { classroomId: classroom.id } } } },
  });
  if (submissionCount > 0) {
    throw ApiError.conflict('ห้องเรียนนี้มีข้อสอบที่มีการส่งคำตอบแล้ว — ลบไม่ได้เพื่อไม่ให้ประวัติคะแนนหาย');
  }

  await prisma.classroom.delete({ where: { id: classroomId } });
  return { id: classroomId };
}

/** ห้องเรียนทั้งหมดที่นักเรียนคนนี้อยู่ */
export async function listStudentClassrooms(studentId) {
  const enrollments = await prisma.enrollment.findMany({
    where: { studentId },
    include: {
      classroom: {
        include: {
          course: { select: { id: true, code: true, title: true } },
          teacher: { select: { id: true, fullName: true } },
          _count: { select: { enrollments: true } },
        },
      },
    },
    orderBy: { enrolledAt: 'desc' },
  });

  return enrollments.map((enrollment) => ({
    ...enrollment.classroom,
    enrolledAt: enrollment.enrolledAt,
  }));
}

/** นักเรียนกรอกรหัสห้องเรียนเพื่อเข้าห้องเอง */export async function joinClassroom(studentId, joinCode) {
  const classroom = await prisma.classroom.findUnique({
    where: { joinCode: joinCode.toUpperCase() },
    include: { course: { select: { id: true, code: true, title: true } } },
  });
  if (!classroom) throw ApiError.notFound('ไม่พบห้องเรียนที่ตรงกับรหัสนี้');

  const existing = await prisma.enrollment.findUnique({
    where: { classroomId_studentId: { classroomId: classroom.id, studentId } },
  });
  if (existing) throw ApiError.conflict('คุณอยู่ในห้องเรียนนี้แล้ว');

  await prisma.enrollment.create({ data: { classroomId: classroom.id, studentId } });
  return classroom;
}

/** รวมรายชื่อนักเรียนทั้งหมดของครูคนนี้ (ทุกห้องเรียน) */
export async function listTeacherStudents(teacherId, { q } = {}) {
  const enrollments = await prisma.enrollment.findMany({
    where: {
      classroom: { teacherId },
      ...(q
        ? {
            student: {
              OR: [
                { fullName: { contains: q, mode: 'insensitive' } },
                { email: { contains: q, mode: 'insensitive' } },
                { studentCode: { contains: q, mode: 'insensitive' } },
              ],
            },
          }
        : {}),
    },
    include: {
      student: true,
      classroom: { select: { id: true, name: true } },
    },
    orderBy: { student: { fullName: 'asc' } },
  });

  const students = new Map();
  for (const enrollment of enrollments) {
    const current = students.get(enrollment.studentId) ?? {
      ...publicUser(enrollment.student),
      classrooms: [],
    };
    current.classrooms.push(enrollment.classroom);
    students.set(enrollment.studentId, current);
  }
  return [...students.values()];
}

export async function createStudent(teacherId, payload) {
  const { classroomId, ...studentPayload } = payload;
  if (classroomId) return addStudentToClassroom(teacherId, classroomId, studentPayload);

  if (!payload.email || !payload.fullName) {
    throw ApiError.badRequest('ต้องระบุ email และ fullName');
  }

  const exists = await prisma.user.findUnique({ where: { email: payload.email } });
  if (exists) throw ApiError.conflict('อีเมลนี้ถูกใช้งานแล้ว');

  const temporaryPassword = payload.password ?? payload.studentCode ?? randomPassword();
  const student = await prisma.user.create({
    data: {
      email: payload.email,
      fullName: payload.fullName,
      studentCode: payload.studentCode ?? null,
      role: 'STUDENT',
      passwordHash: await hashPassword(temporaryPassword),
    },
  });

  return { student: publicUser(student), temporaryPassword };
}

export async function updateStudent(teacherId, studentId, payload) {
  await assertStudentOfTeacher(teacherId, studentId);

  if (payload.studentCode) {
    const taken = await prisma.user.findFirst({
      where: { studentCode: payload.studentCode, NOT: { id: studentId } },
    });
    if (taken) throw ApiError.conflict('รหัสนักเรียนนี้ถูกใช้งานแล้ว');
  }

  const student = await prisma.user.update({
    where: { id: studentId },
    data: {
      ...(payload.fullName !== undefined ? { fullName: payload.fullName } : {}),
      ...(payload.email !== undefined ? { email: payload.email } : {}),
      ...(payload.studentCode !== undefined ? { studentCode: payload.studentCode } : {}),
      ...(payload.isActive !== undefined ? { isActive: payload.isActive } : {}),
    },
  });
  return publicUser(student);
}

/** ลบบัญชีนักเรียน (ข้อสอบที่ส่งไปแล้วจะถูกลบตามด้วย cascade) */
export async function deleteStudent(teacherId, studentId) {
  await assertStudentOfTeacher(teacherId, studentId);
  await prisma.user.delete({ where: { id: studentId } });
  return { id: studentId };
}

export async function resetStudentPassword(teacherId, studentId, newPassword) {
  await assertStudentOfTeacher(teacherId, studentId);
  const password = newPassword ?? randomPassword();
  await prisma.user.update({ where: { id: studentId }, data: { passwordHash: await hashPassword(password) } });
  return { password };
}
