import { after, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { disconnectDatabase, prisma, resetDatabase } from '../helpers/db.js';
import {
  createClassroom,
  createCourse,
  createExam,
  createStudent,
  createTeacher,
  enroll,
  uniqueEmail,
} from '../helpers/fixtures.js';
import { expectApiError } from '../helpers/api-error.js';
import * as courseService from '../../src/services/course.service.js';
import * as classroomService from '../../src/services/classroom.service.js';

/** เทสต์รายวิชา + ห้องเรียน + ตรวจสิทธิ์เจ้าของ (access) กับฐานข้อมูลจริง */

beforeEach(resetDatabase);
after(disconnectDatabase);

describe('course service', () => {
  it('สร้างและดึงรายวิชาเฉพาะของตัวเอง', async () => {
    const teacher = await createTeacher();
    const stranger = await createTeacher();
    await courseService.createCourse(teacher, { code: 'MATH', title: 'คณิตศาสตร์' });
    await courseService.createCourse(stranger, { code: 'THAI', title: 'ภาษาไทย' });

    const { items: mine } = await courseService.listCourses(teacher);
    assert.equal(mine.length, 1);
    assert.equal(mine[0].code, 'MATH');
  });

  it('ค้นหาด้วย q แบบไม่สนตัวพิมพ์', async () => {
    const teacher = await createTeacher();
    await courseService.createCourse(teacher, { code: 'SCI101', title: 'วิทยาศาสตร์' });
    await courseService.createCourse(teacher, { code: 'ART', title: 'ศิลปะ' });
    const { items: found } = await courseService.listCourses(teacher, { q: 'sci' });
    assert.equal(found.length, 1);
    assert.equal(found[0].code, 'SCI101');
  });

  it('getCourseDetail แนบห้องเรียนในรายวิชา', async () => {
    const teacher = await createTeacher();
    const course = await createCourse(teacher);
    await createClassroom(teacher, { courseId: course.id, name: 'ม.4/1' });

    const detail = await courseService.getCourseDetail(teacher, course.id);
    assert.equal(detail.classrooms.length, 1);
    assert.equal(detail.classrooms[0]._count.enrollments, 0);
  });

  it('แก้ไข/ลบรายวิชา และกันลบเมื่อมีข้อสอบ', async () => {
    const teacher = await createTeacher();
    const course = await createCourse(teacher);
    const updated = await courseService.updateCourse(teacher, course.id, { title: 'ใหม่' });
    assert.equal(updated.title, 'ใหม่');

    await createExam(teacher, { courseId: course.id });
    await expectApiError(courseService.deleteCourse(teacher, course.id), 409, /มีข้อสอบ/);

    await prisma.exam.deleteMany({ where: { courseId: course.id } });
    await courseService.deleteCourse(teacher, course.id);
    assert.equal(await prisma.course.count(), 0);
  });

  it('รายวิชาของครูคนอื่น → 403 / ไม่มีอยู่ → 404', async () => {
    const owner = await createTeacher();
    const course = await createCourse(owner);
    await expectApiError(courseService.getCourseDetail(await createTeacher(), course.id), 403);
    await expectApiError(courseService.getCourseDetail(owner, '11111111-1111-1111-1111-111111111111'), 404);
  });

  it('ADMIN เห็นรายวิชาของทุกคนใน listCourses', async () => {
    const { createAdmin } = await import('../helpers/fixtures.js');
    const first = await createTeacher();
    const second = await createTeacher();
    await courseService.createCourse(first, { code: 'MATH', title: 'คณิตศาสตร์' });
    await courseService.createCourse(second, { code: 'THAI', title: 'ภาษาไทย' });

    const admin = await createAdmin();
    const { items } = await courseService.listCourses(admin);
    assert.equal(items.length, 2);

    // ครูทั่วไปยังเห็นเฉพาะของตัวเอง (คุมว่า branch ADMIN ไม่รั่วไปหาคนอื่น)
    const { items: mine } = await courseService.listCourses(first);
    assert.equal(mine.length, 1);
  });

  it('ADMIN แก้รายวิชาของครูคนอื่นได้ แต่ครูคนอื่นถูกปฏิเสธ', async () => {
    const { createAdmin } = await import('../helpers/fixtures.js');
    const owner = await createTeacher();
    const course = await createCourse(owner);

    const admin = await createAdmin();
    const updated = await courseService.updateCourse(admin, course.id, { title: 'แก้โดยแอดมิน' });
    assert.equal(updated.title, 'แก้โดยแอดมิน');

    await expectApiError(courseService.updateCourse(await createTeacher(), course.id, { title: 'x' }), 403);
  });

  it('updateCourse แก้ทีละฟิลด์ (code / description) และรับ description = null', async () => {
    const teacher = await createTeacher();
    const course = await courseService.createCourse(teacher, {
      code: 'PHY',
      title: 'ฟิสิกส์',
      description: 'คำอธิบายเดิม',
    });
    assert.equal(course.description, 'คำอธิบายเดิม');

    const codeOnly = await courseService.updateCourse(teacher, course.id, { code: 'PHY2' });
    assert.equal(codeOnly.code, 'PHY2');
    assert.equal(codeOnly.title, 'ฟิสิกส์');
    assert.equal(codeOnly.description, 'คำอธิบายเดิม');

    const cleared = await courseService.updateCourse(teacher, course.id, { description: null });
    assert.equal(cleared.description, null);
    assert.equal(cleared.code, 'PHY2');
  });
});

describe('classroom service', () => {
  it('สร้างห้องเรียนลอย (ไม่ผูกวิชา) และห้องที่ผูกวิชา', async () => {
    const teacher = await createTeacher();
    const floating = await classroomService.createClassroom(teacher, { name: 'ม.1/1' });
    assert.equal(floating.courseId, null);
    assert.ok(floating.joinCode);

    const course = await createCourse(teacher);
    const linked = await classroomService.createClassroom(teacher, { name: 'ม.1/2', courseId: course.id });
    assert.equal(linked.courseId, course.id);
  });

  it('ผูกวิชาของครูคนอื่น → 403', async () => {
    const owner = await createTeacher();
    const course = await createCourse(owner);
    await expectApiError(
      classroomService.createClassroom(await createTeacher(), { name: 'x', courseId: course.id }),
      403,
    );
  });

  it('getClassroomDetail แนบนักเรียนและงานที่มอบหมาย', async () => {
    const teacher = await createTeacher();
    const classroom = await createClassroom(teacher);
    const student = await createStudent({ fullName: 'ก้อง' });
    await enroll(student, classroom);
    const exam = await createExam(teacher, { title: 'สอบ' });
    await prisma.examAssignment.create({ data: { examId: exam.id, classroomId: classroom.id } });

    const detail = await classroomService.getClassroomDetail(teacher, classroom.id);
    assert.equal(detail.students.length, 1);
    assert.equal(detail.students[0].fullName, 'ก้อง');
    assert.equal(detail.examAssignments.length, 1);
  });

  it('listStudents ไม่นับบัญชี ADMIN ที่ผูกเข้าห้อง', async () => {
    const { createAdmin } = await import('../helpers/fixtures.js');
    const teacher = await createTeacher();
    const classroom = await createClassroom(teacher);
    await enroll(await createStudent(), classroom);
    await enroll(await createAdmin(), classroom);

    const { items: students } = await classroomService.listStudents(classroom.id);
    assert.equal(students.length, 1);
    assert.equal(students[0].role, 'STUDENT');
  });

  it('แก้ชื่อห้อง และกันลบเมื่อมีข้อสอบที่มีการส่งแล้ว', async () => {
    const teacher = await createTeacher();
    const classroom = await createClassroom(teacher);
    const renamed = await classroomService.updateClassroom(teacher, classroom.id, { name: 'ม.2/3' });
    assert.equal(renamed.name, 'ม.2/3');

    const student = await createStudent();
    await enroll(student, classroom);
    const exam = await createExam(teacher);
    await prisma.examAssignment.create({ data: { examId: exam.id, classroomId: classroom.id } });
    await prisma.submission.create({ data: { examId: exam.id, studentId: student.id } });

    await expectApiError(classroomService.deleteClassroom(teacher, classroom.id), 409, /ลบไม่ได้/);
  });

  it('joinClassroom: ไม่พบรหัส → 404, เข้าซ้ำ → 409', async () => {
    const teacher = await createTeacher();
    const classroom = await createClassroom(teacher, { joinCode: 'ABC123' });
    const student = await createStudent();

    await expectApiError(classroomService.joinClassroom(student.id, 'NOPE00'), 404, /ไม่พบห้องเรียน/);

    const joined = await classroomService.joinClassroom(student.id, 'abc123');
    assert.equal(joined.id, classroom.id);
    await expectApiError(classroomService.joinClassroom(student.id, 'ABC123'), 409, /อยู่ในห้องเรียนนี้แล้ว/);
  });

  it('listStudentClassrooms รวมห้องที่นักเรียนอยู่', async () => {
    const teacher = await createTeacher();
    const first = await createClassroom(teacher, { name: 'A' });
    const second = await createClassroom(teacher, { name: 'B' });
    const student = await createStudent();
    await enroll(student, first);
    await enroll(student, second);

    const { items: classrooms } = await classroomService.listStudentClassrooms(student.id);
    assert.equal(classrooms.length, 2);
  });

  it('listTeacherStudents รวมนักเรียนทุกห้องและตัดคนซ้ำ', async () => {
    const teacher = await createTeacher();
    const first = await createClassroom(teacher);
    const second = await createClassroom(teacher);
    const student = await createStudent({ fullName: 'สมชาย' });
    await enroll(student, first);
    await enroll(student, second);
    await enroll(await createStudent({ fullName: 'สมหญิง' }), first);

    const { items: students } = await classroomService.listTeacherStudents(teacher);
    assert.equal(students.length, 2);
    const somchai = students.find((item) => item.fullName === 'สมชาย');
    assert.equal(somchai.classrooms.length, 2);
  });

  it('listTeacherStudents ค้นหาด้วย q ได้ทั้งชื่อ อีเมล และรหัสนักเรียน', async () => {
    const teacher = await createTeacher();
    const classroom = await createClassroom(teacher);
    await enroll(await createStudent({ fullName: 'อลิสา ใจดี', studentCode: 'A100' }), classroom);
    await enroll(await createStudent({ fullName: 'บอย', email: 'boy.search@test.local' }), classroom);

    assert.equal((await classroomService.listTeacherStudents(teacher, { q: 'อลิสา' })).items.length, 1);
    assert.equal((await classroomService.listTeacherStudents(teacher, { q: 'boy.search' })).items.length, 1);
    assert.equal((await classroomService.listTeacherStudents(teacher, { q: 'A100' })).items.length, 1);
    assert.equal((await classroomService.listTeacherStudents(teacher, { q: 'ไม่พบเลย' })).items.length, 0);
  });

  it('อัปเดตนักเรียน: รหัสซ้ำ → 409', async () => {
    const teacher = await createTeacher();
    const classroom = await createClassroom(teacher);
    const first = await createStudent({ studentCode: 'S001' });
    const second = await createStudent({ studentCode: 'S002' });
    await enroll(first, classroom);
    await enroll(second, classroom);

    await expectApiError(
      classroomService.updateStudent(teacher, second.id, { studentCode: 'S001' }),
      409,
      /ถูกใช้งานแล้ว/,
    );
  });

  it('อัปเดตนักเรียนนอกห้องของครู → 404', async () => {
    const teacher = await createTeacher();
    const stranger = await createStudent();
    await expectApiError(classroomService.updateStudent(teacher, stranger.id, { fullName: 'x' }), 404);
  });

  it('เอาออกจากห้องเรียนของครูคนนี้โดยไม่ลบบัญชี', async () => {
    const teacher = await createTeacher();
    const other = await createTeacher();
    const mine = await createClassroom(teacher);
    const theirs = await createClassroom(other);
    const student = await createStudent();
    await enroll(student, mine);
    await enroll(student, theirs);

    const result = await classroomService.removeStudentFromTeacherClassrooms(teacher, student.id);
    assert.equal(result.removedFromClassrooms, 1);
    assert.equal(result.remainingEnrollments, 1);
    assert.equal(await prisma.user.count({ where: { id: student.id } }), 1);
  });

  it('ส่งออกรายชื่อนักเรียนเป็น CSV (มี BOM)', async () => {
    const teacher = await createTeacher();
    const classroom = await createClassroom(teacher, { name: 'ม.5/1' });
    const student = await createStudent({ fullName: 'เด็กดี', studentCode: 'S999' });
    await enroll(student, classroom);

    const result = await classroomService.exportClassroomStudentsCsv(teacher, classroom.id);
    assert.equal(result.count, 1);
    assert.equal(result.content.charCodeAt(0), 0xfeff);
    assert.ok(result.content.includes('เด็กดี'));
    assert.ok(result.content.includes('S999'));
  });

  it('CSV แสดงสถานะ "ระงับ" ของนักเรียนที่ถูกปิดบัญชี', async () => {
    const teacher = await createTeacher();
    const classroom = await createClassroom(teacher);
    const student = await createStudent({ fullName: 'ถูกระงับ', isActive: false });
    await enroll(student, classroom);

    const result = await classroomService.exportClassroomStudentsCsv(teacher, classroom.id);
    assert.ok(result.content.includes('ระงับ'));
  });

  it('listClassrooms กรองตาม courseId', async () => {
    const teacher = await createTeacher();
    const course = await createCourse(teacher);
    await createClassroom(teacher, { name: 'ในวิชา', courseId: course.id });
    await createClassroom(teacher, { name: 'ลอย' });

    const { items } = await classroomService.listClassrooms(teacher, { courseId: course.id });
    assert.equal(items.length, 1);
    assert.equal(items[0].name, 'ในวิชา');
  });

  it('เอาออกจากห้องเรียนกลาง (removeStudentFromClassroom) ไม่พบนักเรียน → 404', async () => {
    const teacher = await createTeacher();
    const classroom = await createClassroom(teacher);
    const stranger = await createStudent();

    await expectApiError(
      classroomService.removeStudentFromClassroom(teacher, classroom.id, stranger.id),
      404,
      /ไม่พบนักเรียน/,
    );
  });

  it('อัปเดตนักเรียนแก้ทีละฟิลด์ (ชื่อ / อีเมล / รหัส / สถานะ)', async () => {
    const teacher = await createTeacher();
    const classroom = await createClassroom(teacher);
    const student = await createStudent({ fullName: 'เดิม' });
    await enroll(student, classroom);

    const renamed = await classroomService.updateStudent(teacher, student.id, { fullName: 'ใหม่' });
    assert.equal(renamed.fullName, 'ใหม่');
    assert.equal(renamed.email, student.email);

    const newEmail = uniqueEmail('newmail');
    assert.equal(
      (await classroomService.updateStudent(teacher, student.id, { email: newEmail })).email,
      newEmail,
    );
    assert.equal(
      (await classroomService.updateStudent(teacher, student.id, { studentCode: 'S777' })).studentCode,
      'S777',
    );
    assert.equal(
      (await classroomService.updateStudent(teacher, student.id, { isActive: false })).isActive,
      false,
    );
  });

  it('ADMIN เห็นห้องเรียน/นักเรียนของทุกคน และจัดการข้ามครูได้', async () => {
    const { createAdmin } = await import('../helpers/fixtures.js');
    const teacher = await createTeacher();
    const classroom = await createClassroom(teacher);
    const student = await createStudent();
    await enroll(student, classroom);
    const admin = await createAdmin();

    assert.equal((await classroomService.listClassrooms(admin)).items.length, 1);
    assert.equal((await classroomService.listTeacherStudents(admin)).items.length, 1);
    assert.equal((await classroomService.assertStudentOfTeacher(admin, student.id)).id, student.id);

    const removed = await classroomService.removeStudentFromTeacherClassrooms(admin, student.id);
    assert.equal(removed.removedFromClassrooms, 1);
  });

  it('ห้องเรียนของครูคนอื่น → 403', async () => {
    const owner = await createTeacher();
    const classroom = await createClassroom(owner);
    await expectApiError(classroomService.ensureOwned(await createTeacher(), classroom.id), 403);
  });
});
