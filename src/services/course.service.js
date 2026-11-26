import { prisma } from '../lib/prisma.js';
import { ApiError } from '../lib/errors.js';
import { getOwnedCourse, actorId, isAdminActor } from '../lib/access.js';
import { parsePagination, runPaginated } from '../lib/pagination.js';

export async function createCourse(teacherId, payload) {
  return prisma.course.create({
    data: {
      teacherId: actorId(teacherId),
      code: payload.code,
      title: payload.title,
      description: payload.description ?? null,
    },
  });
}

export async function listCourses(teacherId, { q, page, limit } = {}) {
  const where = {
    ...(isAdminActor(teacherId) ? {} : { teacherId: actorId(teacherId) }),
    ...(q
      ? {
          OR: [
            { code: { contains: q, mode: 'insensitive' } },
            { title: { contains: q, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  return runPaginated(
    parsePagination({ page, limit }),
    (pageArgs = {}) =>
      prisma.course.findMany({
        where,
        include: { _count: { select: { classrooms: true, exams: true } } },
        orderBy: { createdAt: 'desc' },
        ...pageArgs,
      }),
    () => prisma.course.count({ where }),
  );
}

export async function getCourseDetail(teacherId, courseId) {
  const course = await getOwnedCourse(teacherId, courseId);
  const classrooms = await prisma.classroom.findMany({
    where: { courseId },
    include: { _count: { select: { enrollments: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return { ...course, classrooms };
}

export async function updateCourse(teacherId, courseId, payload) {
  await getOwnedCourse(teacherId, courseId);
  return prisma.course.update({
    where: { id: courseId },
    data: {
      ...(payload.code !== undefined ? { code: payload.code } : {}),
      ...(payload.title !== undefined ? { title: payload.title } : {}),
      ...(payload.description !== undefined ? { description: payload.description } : {}),
    },
  });
}

export async function deleteCourse(teacherId, courseId) {
  const course = await getOwnedCourse(teacherId, courseId);
  const examCount = await prisma.exam.count({ where: { courseId: course.id } });
  if (examCount > 0) {
    throw ApiError.conflict(`รายวิชานี้มีข้อสอบอยู่ ${examCount} ชุด — ย้ายหรือลบข้อสอบก่อน`);
  }
  await prisma.course.delete({ where: { id: courseId } });
  return { id: courseId };
}
