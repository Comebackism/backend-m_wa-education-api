import { ApiError } from './errors.js';
import { isIpAllowed } from './ipAllowlist.js';
import { prisma } from './prisma.js';

/**
 * รวม helper ตรวจสิทธิ์การเข้าถึงข้อมูล (ownership / enrollment)
 * เพื่อกันไม่ให้ครูคนอื่นหรือนักเรียนคนอื่นเข้าถึงข้อมูลข้ามคน
 *
 * "actor" ที่ส่งเข้ามาคือ user object ของครู ({ id, role })
 * บทบาท ADMIN (เข้าได้ทั้งฝั่งครูและนักเรียน) ข้ามการตรวจเจ้าของได้
 * เพื่อรองรับของเดิม ฟังก์ชันยังรับ string (teacherId) ได้ด้วย
 */
export function actorId(actor) {
  return typeof actor === 'string' ? actor : actor?.id;
}

export function isAdminActor(actor) {
  return typeof actor === 'object' && actor?.role === 'ADMIN';
}

export async function getOwnedCourse(actor, courseId) {
  const course = await prisma.course.findUnique({ where: { id: courseId } });
  if (!course) throw ApiError.notFound('ไม่พบรายวิชา');
  if (!isAdminActor(actor) && course.teacherId !== actorId(actor)) throw ApiError.forbidden('รายวิชานี้ไม่ใช่ของคุณ');
  return course;
}

export async function getOwnedClassroom(actor, classroomId) {
  const classroom = await prisma.classroom.findUnique({
    where: { id: classroomId },
    include: { course: true },
  });
  if (!classroom) throw ApiError.notFound('ไม่พบห้องเรียน');
  if (!isAdminActor(actor) && classroom.teacherId !== actorId(actor)) throw ApiError.forbidden('ห้องเรียนนี้ไม่ใช่ของคุณ');
  return classroom;
}

export async function getOwnedExam(actor, examId, include) {
  const exam = await prisma.exam.findUnique({ where: { id: examId }, include });
  if (!exam) throw ApiError.notFound('ไม่พบข้อสอบ');
  if (!isAdminActor(actor) && exam.teacherId !== actorId(actor)) throw ApiError.forbidden('ข้อสอบนี้ไม่ใช่ของคุณ');
  return exam;
}

/**
 * submission ต้องเป็นของข้อสอบที่ครูคนนี้เป็นเจ้าของ
 * ตรวจเจ้าของก่อน (query เบา ๆ) แล้วค่อยดึงข้อมูลตาม include ที่ผู้เรียกต้องการ
 * เพราะ include ของผู้เรียกอาจไม่ดึง teacherId มาด้วย
 */
export async function getOwnedSubmission(actor, submissionId, include) {
  const owner = await prisma.submission.findUnique({
    where: { id: submissionId },
    select: { exam: { select: { teacherId: true } } },
  });
  if (!owner) throw ApiError.notFound('ไม่พบการส่งข้อสอบ');
  if (!isAdminActor(actor) && owner.exam.teacherId !== actorId(actor)) {
    throw ApiError.forbidden('การส่งข้อสอบนี้ไม่ใช่ข้อสอบของคุณ');
  }

  return prisma.submission.findUnique({ where: { id: submissionId }, include });
}

/** submission ต้องเป็นของนักเรียนคนนี้ */
export async function getOwnStudentSubmission(studentId, submissionId, include) {
  const owner = await prisma.submission.findUnique({
    where: { id: submissionId },
    select: { studentId: true },
  });
  if (!owner) throw ApiError.notFound('ไม่พบการส่งข้อสอบ');
  if (owner.studentId !== studentId) throw ApiError.forbidden('การส่งข้อสอบนี้ไม่ใช่ของคุณ');

  return prisma.submission.findUnique({ where: { id: submissionId }, include });
}

/**
 * ข้อสอบที่นักเรียนคนนี้มีสิทธิ์ทำ (เปิดสอบแล้ว + ถูก assign เข้าห้องที่ตัวเองอยู่)
 * ถ้าข้อสอบตั้ง IP restriction ไว้ จะตรวจ client IP ด้วย (เฉพาะตอน "เข้าทำ" — ดูรายละเอียดข้อสอบ/เริ่มทำ)
 */
export async function getExamForStudent(examId, studentId, include, { clientIp } = {}) {
  // ต้อง include assignments + classroom.enrollments เสมอ เพื่อตรวจสิทธิ์ด้านล่าง
  const exam = await prisma.exam.findUnique({
    where: { id: examId },
    include: {
      ...include,
      assignments: { include: { classroom: { include: { enrollments: true } } } },
    },
  });
  if (!exam) throw ApiError.notFound('ไม่พบข้อสอบ');
  if (exam.status !== 'PUBLISHED') throw ApiError.forbidden('ข้อสอบนี้ยังไม่เปิดให้ทำ');

  const now = new Date();
  const assignment = exam.assignments.find((item) =>
    item.classroom.enrollments.some((enrollment) => enrollment.studentId === studentId),
  );

  if (!assignment) throw ApiError.forbidden('คุณไม่ได้อยู่ในห้องเรียนที่ได้รับมอบหมายข้อสอบนี้');
  if (assignment.availableFrom && now < assignment.availableFrom) throw ApiError.forbidden('ยังไม่ถึงเวลาทำข้อสอบ');
  if (assignment.availableTo && now > assignment.availableTo) throw ApiError.forbidden('เลยเวลาทำข้อสอบแล้ว');
  if (!isIpAllowed(clientIp, exam.allowedIpRanges)) {
    throw ApiError.forbidden('เครื่องนี้ไม่ได้รับอนุญาตให้ทำข้อสอบชุดนี้ (จำกัด IP) กรุณาเชื่อมต่อผ่านเครือข่ายที่กำหนด');
  }

  return exam;
}
