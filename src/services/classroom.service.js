import { prisma } from '../lib/prisma.js';
import { ApiError, publicUser } from '../lib/errors.js';
import { hashPassword } from '../lib/password.js';
import { getOwnedClassroom, getOwnedCourse, actorId, isAdminActor } from '../lib/access.js';
import { toCsv } from '../lib/csv.js';
import { STUDENT_IMPORT_HEADERS, readStudentRosterFile } from '../lib/studentImport.js';
import { parsePagination, runPaginated } from '../lib/pagination.js';

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

function randomPassword(length = 12) {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let password = '';
  for (let index = 0; index < length; index += 1) {
    password += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return password;
}

/**
 * รหัสผ่านชั่วคราวของนักเรียนใหม่
 * - ครูระบุเองได้ (ต้องไม่ซ้ำรหัสนักเรียน)
 * - ไม่ระบุ → สุ่มเสมอ ห้ามใช้ studentCode เป็นรหัสผ่าน
 */
function resolveTemporaryPassword(payload) {
  if (payload.password && payload.password === payload.studentCode) {
    throw ApiError.badRequest('รหัสผ่านต้องไม่ซ้ำกับรหัสนักเรียน');
  }
  return payload.password ?? randomPassword();
}

/** นักเรียนต้องอยู่ในห้องเรียนของครูคนนี้เท่านั้น (ADMIN เข้าถึงได้ทุกคน) */
export async function assertStudentOfTeacher(teacherId, studentId) {
  const student = await prisma.user.findFirst({
    where: {
      id: studentId,
      role: 'STUDENT',
      ...(isAdminActor(teacherId)
        ? {}
        : { enrollments: { some: { classroom: { teacherId: actorId(teacherId) } } } }),
    },
  });
  if (!student) throw ApiError.notFound('ไม่พบนักเรียนคนนี้ในห้องเรียนของคุณ');
  return student;
}

export async function createClassroom(teacherId, { name, courseId }) {
  // ห้องเรียนไม่จำเป็นต้องผูกกับรายวิชา — ถ้าไม่ส่ง courseId มา ให้เป็นห้องเรียนลอย
  let resolvedCourseId = null;
  if (courseId) {
    const course = await getOwnedCourse(teacherId, courseId);
    resolvedCourseId = course.id;
  }

  return prisma.classroom.create({
    data: {
      name,
      courseId: resolvedCourseId,
      teacherId: actorId(teacherId),
      joinCode: await generateJoinCode(),
    },
    include: { course: true },
  });
}

export async function listClassrooms(teacherId, { courseId, page, limit } = {}) {
  const where = {
    ...(isAdminActor(teacherId) ? {} : { teacherId: actorId(teacherId) }),
    ...(courseId ? { courseId } : {}),
  };

  return runPaginated(
    parsePagination({ page, limit }),
    (pageArgs = {}) =>
      prisma.classroom.findMany({
        where,
        include: {
          course: true,
          _count: { select: { enrollments: true, examAssignments: true } },
        },
        orderBy: { createdAt: 'desc' },
        ...pageArgs,
      }),
    () => prisma.classroom.count({ where }),
  );
}

export async function getClassroomDetail(teacherId, classroomId) {
  const classroom = await getOwnedClassroom(teacherId, classroomId);
  const [studentPage, assignments] = await Promise.all([
    listStudents(classroomId),
    prisma.examAssignment.findMany({
      where: { classroomId },
      include: { exam: { select: { id: true, title: true, status: true } } },
      orderBy: { createdAt: 'desc' },
    }),
  ]);
  return { ...classroom, students: studentPage.items, examAssignments: assignments };
}

export async function listStudents(classroomId, { page, limit } = {}) {
  const where = { classroomId, student: { role: 'STUDENT' } };

  const { items, pagination } = await runPaginated(
    parsePagination({ page, limit }),
    (pageArgs = {}) =>
      prisma.enrollment.findMany({
        // เฉพาะบัญชีนักเรียนจริง (กันบัญชี ADMIN ที่ถูกผูกเข้าห้องเพื่อดูฝั่งนักเรียนโผล่ในรายชื่อ)
        where,
        include: { student: true },
        orderBy: { student: { fullName: 'asc' } },
        ...pageArgs,
      }),
    () => prisma.enrollment.count({ where }),
  );

  const students = items.map((enrollment) => ({
    ...publicUser(enrollment.student),
    enrolledAt: enrollment.enrolledAt,
  }));

  return { items: students, pagination };
}

const CSV_STUDENT_HEADERS = ['ลำดับ', 'รหัสนักเรียน', 'ชื่อ-นามสกุล', 'อีเมล', 'สถานะบัญชี', 'วันที่เข้าห้อง'];

/**
 * คอลัมน์ของแม่แบบนำเข้ารายชื่อนักเรียน (ใช้ชุดเดียวกับตัวอ่านไฟล์ใน lib/studentImport.js)
 * - รหัสนักเรียน: เว้นว่างได้ ระบบจะไม่ผูกให้
 * - รหัสผ่าน: เว้นว่างได้ ระบบจะสุ่มให้แล้วคืนค่ากลับมา
 */
const CSV_STUDENT_TEMPLATE_HEADERS = STUDENT_IMPORT_HEADERS;

/** แม่แบบ CSV ว่างสำหรับกรอกรายชื่อนักเรียน (ปุ่ม "ดาวน์โหลดแม่แบบ") */
export function buildStudentRosterTemplateCsv() {
  return {
    filename: 'student_roster_template.csv',
    content: toCsv(CSV_STUDENT_TEMPLATE_HEADERS, []),
  };
}

/**
 * ส่งออกรายชื่อนักเรียนในห้องเป็น CSV (สำหรับครู) — เปิดใน Excel ได้ทันที (UTF-8 BOM)
 */
export async function exportClassroomStudentsCsv(teacherId, classroomId) {
  const classroom = await getOwnedClassroom(teacherId, classroomId);
  const { items: students } = await listStudents(classroomId);

  const rows = students.map((student, index) => [
    index + 1,
    student.studentCode ?? '',
    student.fullName,
    student.email,
    student.isActive ? 'ใช้งาน' : 'ระงับ',
    student.enrolledAt ? new Date(student.enrolledAt).toISOString() : '',
  ]);

  return {
    classroomName: classroom.name,
    filename: `classroom-${classroom.id}-students.csv`,
    count: students.length,
    content: toCsv(CSV_STUDENT_HEADERS, rows),
  };
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
    temporaryPassword = resolveTemporaryPassword(payload);
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

/** ข้อความสรุปผลการนำเข้ารายชื่อ ให้ frontend แสดงในกล่องแจ้งเตือนได้เลย */
function buildStudentImportMessage(created, enrolled, skipped) {
  const parts = [];
  if (created > 0) parts.push(`สร้างบัญชีใหม่ ${created} คน`);
  if (enrolled > 0) parts.push(`ผูกเข้าห้อง ${enrolled} คน`);
  if (skipped > 0) parts.push(`ข้าม ${skipped} คน (อยู่ในห้องนี้แล้ว)`);
  if (parts.length === 0) return 'ไม่มีรายชื่อที่ต้องนำเข้า';
  return `นำเข้ารายชื่อนักเรียนสำเร็จ — ${parts.join(' · ')}`;
}

/**
 * นำเข้ารายชื่อนักเรียนจากไฟล์ CSV / .xlsx (ปุ่ม "นำเข้า CSV" ของครู)
 * - ตรวจทุกแถวก่อนแบบ all-or-nothing: ถ้ามีแถวผิด (รูปแบบ หรือชนกับบัญชีเดิม)
 *   จะไม่นำเข้าสักคน แล้วคืน error.details = [{ row, message }] ให้แก้ไฟล์
 * - คนที่มีบัญชีอยู่แล้ว → ผูกเข้าห้องให้ · ถ้าอยู่ในห้องนี้แล้ว → ข้าม (ไม่ถือเป็น error)
 * - คนที่ยังไม่มีบัญชี → สร้างบัญชี STUDENT ให้ พร้อมรหัสผ่าน (ครูระบุ หรือระบบสุ่ม 12 ตัว)
 * - dryRun = true → ตรวจและสรุปผลโดยไม่บันทึก
 */
export async function importStudentsFromFile(
  teacherId,
  classroomId,
  { buffer, filename },
  { dryRun = false } = {},
) {
  await getOwnedClassroom(teacherId, classroomId);

  const { students, errors } = await readStudentRosterFile(buffer, filename);
  if (errors.length > 0) {
    throw ApiError.badRequest(`ไฟล์มีข้อผิดพลาด ${errors.length} แถว — ยังไม่นำเข้ารายชื่อใดเลย`, errors);
  }

  // ---- ตรวจกับฐานข้อมูลก่อน (all-or-nothing) ----
  const emails = students.map((student) => student.email);
  const codes = students.map((student) => student.studentCode).filter(Boolean);

  const [usersByEmail, usersByCode] = await Promise.all([
    prisma.user.findMany({ where: { email: { in: emails } } }),
    codes.length > 0 ? prisma.user.findMany({ where: { studentCode: { in: codes } } }) : Promise.resolve([]),
  ]);
  const emailMap = new Map(usersByEmail.map((user) => [user.email, user]));
  const codeMap = new Map(usersByCode.map((user) => [user.studentCode, user]));

  const dbErrors = [];
  const plan = [];

  for (const row of students) {
    const matchEmail = emailMap.get(row.email) ?? null;
    const matchCode = row.studentCode ? (codeMap.get(row.studentCode) ?? null) : null;

    if (matchEmail && matchEmail.role !== 'STUDENT') {
      dbErrors.push({ row: row.rowNumber, message: 'อีเมลนี้ถูกใช้โดยบัญชีที่ไม่ใช่บทบาทนักเรียน' });
      continue;
    }
    if (matchCode && matchCode.role !== 'STUDENT') {
      dbErrors.push({ row: row.rowNumber, message: 'รหัสนักเรียนนี้ถูกใช้โดยบัญชีที่ไม่ใช่บทบาทนักเรียน' });
      continue;
    }
    if (matchEmail && matchCode && matchEmail.id !== matchCode.id) {
      dbErrors.push({ row: row.rowNumber, message: 'อีเมลกับรหัสนักเรียนตรงกับบัญชีคนละคน' });
      continue;
    }

    plan.push({ ...row, existing: matchEmail ?? matchCode ?? null });
  }

  if (dbErrors.length > 0) {
    throw ApiError.badRequest(`ไฟล์มีข้อผิดพลาด ${dbErrors.length} แถว — ยังไม่นำเข้ารายชื่อใดเลย`, dbErrors);
  }

  // ---- คนที่มีบัญชีแล้วอยู่ในห้องนี้อยู่หรือยัง ----
  const existingIds = plan.filter((row) => row.existing).map((row) => row.existing.id);
  const enrollments =
    existingIds.length > 0
      ? await prisma.enrollment.findMany({
          where: { classroomId, studentId: { in: existingIds } },
          select: { studentId: true },
        })
      : [];
  const enrolledIds = new Set(enrollments.map((enrollment) => enrollment.studentId));

  const items = plan.map((row) => {
    if (row.existing) {
      return {
        row: row.rowNumber,
        email: row.existing.email,
        fullName: row.existing.fullName,
        studentCode: row.existing.studentCode ?? row.studentCode,
        status: enrolledIds.has(row.existing.id) ? 'skipped' : 'enrolled',
        temporaryPassword: null,
      };
    }
    return {
      row: row.rowNumber,
      email: row.email,
      fullName: row.fullName,
      studentCode: row.studentCode,
      status: 'created',
      temporaryPassword: row.password ?? randomPassword(),
    };
  });

  const created = items.filter((item) => item.status === 'created').length;
  const enrolled = items.filter((item) => item.status === 'enrolled').length;
  const skipped = items.filter((item) => item.status === 'skipped').length;

  if (dryRun) {
    return {
      classroomId,
      dryRun: true,
      total: students.length,
      wouldCreate: created,
      wouldEnroll: enrolled,
      wouldSkip: skipped,
      students: items.map(({ temporaryPassword: _temporaryPassword, ...rest }) => rest),
    };
  }

  // ---- สร้างบัญชีใหม่ + ผูกเข้าห้องใน transaction เดียว ----
  const passwordHashes = new Map();
  for (const item of items) {
    if (item.status === 'created') {
      passwordHashes.set(item.row, await hashPassword(item.temporaryPassword));
    }
  }

  await prisma.$transaction(async (tx) => {
    for (const item of items) {
      if (item.status === 'skipped') continue;

      let studentId;
      if (item.status === 'created') {
        const student = await tx.user.create({
          data: {
            email: item.email,
            fullName: item.fullName,
            studentCode: item.studentCode ?? null,
            role: 'STUDENT',
            passwordHash: passwordHashes.get(item.row),
          },
        });
        studentId = student.id;
      } else {
        studentId = plan.find((row) => row.rowNumber === item.row).existing.id;
      }

      await tx.enrollment.create({ data: { classroomId, studentId } });
    }
  });

  return {
    classroomId,
    dryRun: false,
    total: students.length,
    created,
    enrolled,
    skipped,
    message: buildStudentImportMessage(created, enrolled, skipped),
    students: items,
  };
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
export async function listStudentClassrooms(studentId, { page, limit } = {}) {
  const where = { studentId };

  const { items, pagination } = await runPaginated(
    parsePagination({ page, limit }),
    (pageArgs = {}) =>
      prisma.enrollment.findMany({
        where,
        include: {
          classroom: {
            include: {
              course: { select: { id: true, code: true, title: true } },
              teacher: { select: { id: true, fullName: true } },
            },
          },
        },
        orderBy: { enrolledAt: 'desc' },
        ...pageArgs,
      }),
    () => prisma.enrollment.count({ where }),
  );

  const classrooms = items.map((enrollment) => ({
    ...enrollment.classroom,
    enrolledAt: enrollment.enrolledAt,
  }));

  return { items: classrooms, pagination };
}

/** นักเรียนกรอกรหัสห้องเรียนเพื่อเข้าห้องเอง */ export async function joinClassroom(studentId, joinCode) {
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
export async function listTeacherStudents(teacherId, { q, page, limit } = {}) {
  const teacherScope = isAdminActor(teacherId) ? {} : { teacherId: actorId(teacherId) };

  const where = {
    // เฉพาะนักเรียนจริง — ไม่นับบัญชี ADMIN ที่ผูกเข้าห้องเพื่อทดสอบฝั่งนักเรียน
    role: 'STUDENT',
    enrollments: { some: { classroom: teacherScope } },
    ...(q
      ? {
          OR: [
            { fullName: { contains: q, mode: 'insensitive' } },
            { email: { contains: q, mode: 'insensitive' } },
            { studentCode: { contains: q, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  // แบ่งหน้าบน "นักเรียน" (ไม่ใช่ enrollment) เพื่อไม่ให้คนเดียวถูกตัดข้ามหน้า
  const { items, pagination } = await runPaginated(
    parsePagination({ page, limit }),
    (pageArgs = {}) =>
      prisma.user.findMany({
        where,
        include: {
          enrollments: {
            where: { classroom: teacherScope },
            include: { classroom: { select: { id: true, name: true } } },
          },
        },
        orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
        ...pageArgs,
      }),
    () => prisma.user.count({ where }),
  );

  const students = items.map((student) => {
    const { enrollments, ...rest } = student;
    return {
      ...publicUser(rest),
      classrooms: enrollments.map((enrollment) => enrollment.classroom),
    };
  });

  return { items: students, pagination };
}

export async function createStudent(teacherId, payload) {
  const { classroomId, ...studentPayload } = payload;
  if (classroomId) return addStudentToClassroom(teacherId, classroomId, studentPayload);

  if (!payload.email || !payload.fullName) {
    throw ApiError.badRequest('ต้องระบุ email และ fullName');
  }

  const exists = await prisma.user.findUnique({ where: { email: payload.email } });
  if (exists) throw ApiError.conflict('อีเมลนี้ถูกใช้งานแล้ว');

  const temporaryPassword = resolveTemporaryPassword(payload);
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

/**
 * "ลบนักเรียน" = เอานักเรียนออกจากทุกห้องเรียนของครูคนนี้เท่านั้น
 * - ไม่ลบบัญชีผู้ใช้ และไม่แตะข้อมูลของครูคนอื่น
 * - ประวัติการส่งข้อสอบ/คำตอบยังอยู่ครบ (ตรวจย้อนหลังได้)
 * ชื่อฟังก์ชันสื่อตรงกับสิ่งที่ทำ (unenroll) แม้ route จะยังเป็น DELETE /students/:id
 * ถ้าต้องการปิดการใช้งานบัญชีจริง ๆ ให้ใช้ PATCH /students/:id { isActive: false }
 */
export async function removeStudentFromTeacherClassrooms(teacherId, studentId) {
  await assertStudentOfTeacher(teacherId, studentId);

  const removed = await prisma.enrollment.deleteMany({
    where: isAdminActor(teacherId)
      ? { studentId }
      : { studentId, classroom: { teacherId: actorId(teacherId) } },
  });

  const remainingEnrollments = await prisma.enrollment.count({ where: { studentId } });

  return {
    id: studentId,
    removedFromClassrooms: removed.count,
    remainingEnrollments,
  };
}

export async function resetStudentPassword(teacherId, studentId, newPassword) {
  await assertStudentOfTeacher(teacherId, studentId);
  const password = newPassword ?? randomPassword();
  await prisma.user.update({
    where: { id: studentId },
    data: { passwordHash: await hashPassword(password) },
  });
  return { password };
}
