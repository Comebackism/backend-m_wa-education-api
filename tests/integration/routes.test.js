import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { disconnectDatabase, prisma, resetDatabase } from '../helpers/db.js';
import { startTestServer } from '../helpers/http.js';
import {
  createClassroom,
  createPublishedExam,
  createStudent,
  createTeacher,
  enroll,
  uniqueEmail,
} from '../helpers/fixtures.js';
import * as submissionService from '../../src/services/submission.service.js';

/**
 * เทสต์ครอบเส้นทาง HTTP ที่เหลือ (CRUD ทั้งหมด) เพื่อยืนยันสัญญา route เดิม
 * ข้อมูลตั้งต้นสร้างผ่าน helper/service เพื่อความรวดเร็ว แล้วยิง HTTP จริง
 */

let server;

before(async () => {
  server = await startTestServer();
});
after(async () => {
  await server.close();
  await disconnectDatabase();
});
beforeEach(resetDatabase);

const PASSWORD = 'Password123!';

/** สมัครครูผ่าน HTTP แล้วคืน { token, userId } */
async function teacherToken() {
  const res = await server.client.post('/api/auth/teacher/register', {
    email: uniqueEmail('teacher'),
    password: PASSWORD,
    fullName: 'ครู',
  });
  assert.equal(res.status, 201);
  return { token: res.data.accessToken, userId: res.data.user.id };
}

/** สร้างนักเรียน+เข้าห้องด้วย helper แล้วล็อกอินผ่าน HTTP เพื่อเอา token */
async function studentToken(classroom, overrides = {}) {
  const student = await createStudent({ password: PASSWORD, ...overrides });
  if (classroom) await enroll(student, classroom);
  const res = await server.client.post('/api/auth/login', {
    email: student.email,
    password: PASSWORD,
    role: 'STUDENT',
  });
  assert.equal(res.status, 200);
  return { token: res.data.accessToken, student };
}

async function setupSubmitted(teacherId, classroom) {
  const teacher = { id: teacherId, role: 'TEACHER' };
  const { exam, mc, text } = await createPublishedExam(teacher, classroom);
  const student = await createStudent();
  await enroll(student, classroom);
  const started = await submissionService.startSubmission(exam.id, student.id);
  await submissionService.saveAnswers(started.id, student.id, [
    { questionId: mc.id, choiceId: mc.choices[0].id },
  ]);
  await submissionService.submitSubmission(started.id, student.id);
  const textAnswer = await prisma.answer.findFirst({
    where: { submissionId: started.id, questionId: text.id },
  });
  return { exam, mc, text, student, submissionId: started.id, textAnswerId: textAnswer.id };
}

describe('course routes', () => {
  it('CRUD ครบวงจร', async () => {
    const { token } = await teacherToken();
    const created = await server.client.post('/api/courses', { code: 'MATH', title: 'คณิต' }, { token });
    assert.equal(created.status, 201);
    const courseId = created.data.course.id;

    const list = await server.client.get('/api/courses?q=math', { token });
    assert.equal(list.data.courses.length, 1);

    const detail = await server.client.get(`/api/courses/${courseId}`, { token });
    assert.equal(detail.data.course.id, courseId);

    const patched = await server.client.patch(`/api/courses/${courseId}`, { title: 'คณิตศาสตร์' }, { token });
    assert.equal(patched.data.course.title, 'คณิตศาสตร์');

    const removed = await server.client.del(`/api/courses/${courseId}`, { token });
    assert.equal(removed.status, 200);
  });

  it('validation: รหัสวิชาว่าง → 400', async () => {
    const { token } = await teacherToken();
    const res = await server.client.post('/api/courses', { code: '', title: 'x' }, { token });
    assert.equal(res.status, 400);
  });
});

describe('classroom routes', () => {
  it('CRUD + รายชื่อ + export + ลบนักเรียนออกจากห้อง', async () => {
    const { token } = await teacherToken();
    const created = await server.client.post('/api/classrooms', { name: 'ม.1/1' }, { token });
    const classroomId = created.data.classroom.id;

    const list = await server.client.get('/api/classrooms', { token });
    assert.equal(list.data.classrooms.length, 1);

    const detail = await server.client.get(`/api/classrooms/${classroomId}`, { token });
    assert.equal(detail.data.classroom.id, classroomId);

    const patched = await server.client.patch(`/api/classrooms/${classroomId}`, { name: 'ม.1/2' }, { token });
    assert.equal(patched.data.classroom.name, 'ม.1/2');

    const added = await server.client.post(
      `/api/classrooms/${classroomId}/students`,
      { email: uniqueEmail('kid'), fullName: 'เด็ก' },
      { token },
    );
    assert.equal(added.status, 201);
    const studentId = added.data.student.id;

    const students = await server.client.get(`/api/classrooms/${classroomId}/students`, { token });
    assert.equal(students.data.students.length, 1);

    const csv = await server.client.get(`/api/classrooms/${classroomId}/students/export`, { token });
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get('content-type'), /text\/csv/);

    const removedStudent = await server.client.del(`/api/classrooms/${classroomId}/students/${studentId}`, {
      token,
    });
    assert.equal(removedStudent.status, 200);

    const removed = await server.client.del(`/api/classrooms/${classroomId}`, { token });
    assert.equal(removed.status, 200);
  });

  it('เพิ่มนักเรียนโดยไม่มีตัวระบุ → 400', async () => {
    const { token } = await teacherToken();
    const classroom = await server.client.post('/api/classrooms', { name: 'ม.2/1' }, { token });
    const res = await server.client.post(
      `/api/classrooms/${classroom.data.classroom.id}/students`,
      {},
      { token },
    );
    assert.equal(res.status, 400);
  });

  it('นักเรียนเข้าห้องด้วยรหัสผ่าน /join', async () => {
    const teacher = await createTeacher();
    await createClassroom(teacher, { joinCode: 'HELLO1' });
    const student = await createStudent({ password: PASSWORD });
    const login = await server.client.post('/api/auth/login', {
      email: student.email,
      password: PASSWORD,
      role: 'STUDENT',
    });

    const join = await server.client.post(
      '/api/classrooms/join',
      { joinCode: 'HELLO1' },
      { token: login.data.accessToken },
    );
    assert.equal(join.status, 201);
    assert.equal(join.data.classroom.joinCode, 'HELLO1');
  });
});

describe('student routes', () => {
  it('สร้างนักเรียนใหม่ผ่าน POST /students (ไม่ผูกห้อง) → คืนรหัสผ่านชั่วคราว', async () => {
    const { token } = await teacherToken();
    const email = uniqueEmail('floating');
    const res = await server.client.post('/api/students', { email, fullName: 'เด็กไม่มีห้อง' }, { token });
    assert.equal(res.status, 201);
    assert.equal(res.data.student.email, email);
    assert.equal(res.data.temporaryPassword.length, 12);
  });

  it('รายชื่อ + แก้ไข + เอา ออกจากห้องเรียนของครู', async () => {
    const { token } = await teacherToken();
    const classroom = await server.client.post('/api/classrooms', { name: 'ม.3/1' }, { token });
    const added = await server.client.post(
      `/api/classrooms/${classroom.data.classroom.id}/students`,
      { email: uniqueEmail('kid'), fullName: 'เด็กเดิม' },
      { token },
    );
    const studentId = added.data.student.id;

    const list = await server.client.get('/api/students', { token });
    assert.equal(list.data.students.length, 1);

    const patched = await server.client.patch(`/api/students/${studentId}`, { fullName: 'ชื่อใหม่' }, { token });
    assert.equal(patched.data.student.fullName, 'ชื่อใหม่');

    const removed = await server.client.del(`/api/students/${studentId}`, { token });
    assert.equal(removed.data.removedFromClassrooms, 1);
  });
});

describe('exam routes', () => {
  async function makeExam(token) {
    const classroom = await server.client.post('/api/classrooms', { name: 'ม.4/1' }, { token });
    const created = await server.client.post(
      '/api/exams',
      { title: 'ข้อสอบ', timeLimitMinutes: 30 },
      { token },
    );
    return { classroomId: classroom.data.classroom.id, examId: created.data.exam.id };
  }

  it('list / detail / patch / default-cutoffs / close / delete', async () => {
    const { token } = await teacherToken();
    const { examId } = await makeExam(token);

    const list = await server.client.get('/api/exams?status=DRAFT', { token });
    assert.equal(list.data.exams.length, 1);

    const detail = await server.client.get(`/api/exams/${examId}`, { token });
    assert.equal(detail.data.exam.id, examId);

    const patched = await server.client.patch(`/api/exams/${examId}`, { title: 'แก้ชื่อ' }, { token });
    assert.equal(patched.data.exam.title, 'แก้ชื่อ');

    const defaults = await server.client.get('/api/exams/default-cutoffs', { token });
    assert.equal(defaults.data.cutoffs.length, 8);

    const closed = await server.client.post(`/api/exams/${examId}/close`, {}, { token });
    assert.equal(closed.data.exam.status, 'CLOSED');

    const removed = await server.client.del(`/api/exams/${examId}`, { token });
    assert.equal(removed.status, 200);
  });

  it('questions: add / reorder / patch / delete', async () => {
    const { token } = await teacherToken();
    const { examId } = await makeExam(token);

    const first = await server.client.post(
      `/api/exams/${examId}/questions`,
      { type: 'SHORT_ANSWER', prompt: 'a', points: 2 },
      { token },
    );
    const second = await server.client.post(
      `/api/exams/${examId}/questions`,
      { type: 'SHORT_ANSWER', prompt: 'b', points: 3 },
      { token },
    );
    assert.equal(first.status, 201);

    const reordered = await server.client.put(
      `/api/exams/${examId}/questions/order`,
      {
        items: [
          { id: first.data.question.id, order: 2 },
          { id: second.data.question.id, order: 1 },
        ],
      },
      { token },
    );
    assert.equal(reordered.status, 200);

    const patched = await server.client.patch(
      `/api/exams/${examId}/questions/${first.data.question.id}`,
      { points: 5 },
      { token },
    );
    assert.equal(Number(patched.data.question.points), 5);

    const removed = await server.client.del(`/api/exams/${examId}/questions/${second.data.question.id}`, {
      token,
    });
    assert.equal(removed.status, 200);
  });

  it('questions/import (multipart): dryRun + ของจริง', async () => {
    const { token } = await teacherToken();
    const { examId } = await makeExam(token);

    const { QUESTION_IMPORT_HEADERS } = await import('../../src/lib/questionImport.js');
    const { toCsvRows } = await import('../helpers/csv.js');
    const content = toCsvRows(
      [[...QUESTION_IMPORT_HEADERS], ['ปรนัย', 'ข้อใดถูก?', '2', 'ก', 'ข', 'ค', 'ง', 'A', '', '']],
      {
        bom: true,
      },
    );

    const dryForm = new FormData();
    dryForm.append('file', new Blob([content]), 'q.csv');
    const dry = await server.client.post(`/api/exams/${examId}/questions/import?dryRun=true`, dryForm, {
      token,
    });
    assert.equal(dry.status, 200);
    assert.equal(dry.data.wouldImport, 1);

    const realForm = new FormData();
    realForm.append('file', new Blob([content]), 'q.csv');
    const real = await server.client.post(`/api/exams/${examId}/questions/import`, realForm, { token });
    assert.equal(real.status, 201);
    assert.equal(real.data.imported, 1);
  });

  it('cutoffs: put แล้ว get กลับ', async () => {
    const { token } = await teacherToken();
    const { examId } = await makeExam(token);
    const put = await server.client.put(
      `/api/exams/${examId}/cutoffs`,
      {
        cutoffs: [
          { grade: 'A', minPercent: 50 },
          { grade: 'F', minPercent: 0 },
        ],
      },
      { token },
    );
    assert.equal(put.data.cutoffs.length, 2);

    const get = await server.client.get(`/api/exams/${examId}/cutoffs`, { token });
    assert.equal(get.data.cutoffs.length, 2);
  });

  it('assignments: post แล้ว delete', async () => {
    const { token } = await teacherToken();
    const { examId, classroomId } = await makeExam(token);
    const assigned = await server.client.post(`/api/exams/${examId}/assignments`, { classroomId }, { token });
    assert.equal(assigned.status, 201);

    const removed = await server.client.del(
      `/api/exams/${examId}/assignments/${assigned.data.assignment.id}`,
      { token },
    );
    assert.equal(removed.status, 200);
  });

  it('validation: allowedIpRanges ที่ไม่ใช่ IP → 400', async () => {
    const { token } = await teacherToken();
    const res = await server.client.post(
      '/api/exams',
      { title: 'x', allowedIpRanges: ['999.1.1.1'] },
      { token },
    );
    assert.equal(res.status, 400);
    assert.equal(res.data.error.code, 'BAD_REQUEST');
  });

  it('request-ip: ส่ง X-Forwarded-For แล้วได้ IP ที่ normalize', async () => {
    const { token } = await teacherToken();
    const res = await server.client.get('/api/exams/request-ip', {
      token,
      headers: { 'X-Forwarded-For': '203.0.113.7' },
    });
    assert.equal(res.status, 200);
    assert.ok('normalizedIp' in res.data);
  });
});

describe('grading routes', () => {
  it('รายการ → รายละเอียด → ตรวจอัตนัย → ปล่อยผลใบ → export → stats', async () => {
    const { token, userId } = await teacherToken();
    // สร้างห้องของครูจริงเพื่อให้ตรวจเจ้าของผ่าน
    const created = await server.client.post('/api/classrooms', { name: 'ม.5/1' }, { token });
    const myClassroom = await prisma.classroom.findUnique({ where: { id: created.data.classroom.id } });

    const { exam, textAnswerId, submissionId } = await setupSubmitted(userId, myClassroom);

    const list = await server.client.get(`/api/grading/exams/${exam.id}/submissions`, { token });
    assert.equal(list.status, 200);
    assert.equal(list.data.submissions.length, 1);

    const detail = await server.client.get(`/api/grading/submissions/${submissionId}`, { token });
    assert.equal(detail.data.submission.ungradedCount, 1);

    const graded = await server.client.patch(
      `/api/grading/answers/${textAnswerId}`,
      { isCorrect: true, awardedPoints: 2, graderComment: 'ดี' },
      { token },
    );
    assert.equal(graded.status, 200);
    assert.equal(graded.data.submission.status, 'GRADED');

    const released = await server.client.post(
      `/api/grading/submissions/${submissionId}/release`,
      {},
      { token },
    );
    assert.equal(released.data.submission.status, 'RELEASED');

    const stats = await server.client.get(`/api/grading/exams/${exam.id}/stats`, { token });
    assert.equal(stats.data.stats.summary.released, 1);

    const csv = await server.client.get(`/api/grading/exams/${exam.id}/export?status=RELEASED`, { token });
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get('content-type'), /text\/csv/);

    const releaseAll = await server.client.post(`/api/grading/exams/${exam.id}/release`, {}, { token });
    assert.equal(releaseAll.status, 200);
  });

  it('ตรวจข้อปรนัยผ่าน HTTP → 400', async () => {
    const { token, userId } = await teacherToken();
    const created = await server.client.post('/api/classrooms', { name: 'ม.5/2' }, { token });
    const classroom = await prisma.classroom.findUnique({ where: { id: created.data.classroom.id } });
    const { mc, submissionId } = await setupSubmitted(userId, classroom);

    const mcAnswer = await prisma.answer.findFirst({ where: { submissionId, questionId: mc.id } });
    const res = await server.client.patch(
      `/api/grading/answers/${mcAnswer.id}`,
      { isCorrect: false },
      { token },
    );
    assert.equal(res.status, 400);
  });
});

describe('my routes (นักเรียน)', () => {
  it('classrooms / submissions / answers / submit / รอผล / เห็นผลหลังปล่อย', async () => {
    const { token: teacherTokenValue, userId } = await teacherToken();
    const created = await server.client.post(
      '/api/classrooms',
      { name: 'ม.6/1' },
      { token: teacherTokenValue },
    );
    const classroom = await prisma.classroom.findUnique({ where: { id: created.data.classroom.id } });
    const { exam, mc, text } = await createPublishedExam({ id: userId, role: 'TEACHER' }, classroom);

    const { token } = await studentToken(classroom);

    const classrooms = await server.client.get('/api/my/classrooms', { token });
    assert.equal(classrooms.data.classrooms.length, 1);

    const started = await server.client.post(
      `/api/my/exams/${exam.id}/submissions`,
      { displayMode: 'PAGINATED' },
      { token },
    );
    const submissionId = started.data.submission.id;

    const fetched = await server.client.get(`/api/my/submissions/${submissionId}`, { token });
    assert.equal(fetched.data.submission.status, 'IN_PROGRESS');

    const saved = await server.client.put(
      `/api/my/submissions/${submissionId}/answers`,
      { answers: [{ questionId: mc.id, choiceId: mc.choices[0].id }] },
      { token },
    );
    assert.equal(saved.data.savedCount, 1);

    const submitted = await server.client.post(`/api/my/submissions/${submissionId}/submit`, {}, { token });
    assert.equal(submitted.status, 200);

    // ยังไม่ปล่อยผล → เปิดผลตรง ๆ ไม่ได้
    const tooEarly = await server.client.get(`/api/my/results/${submissionId}`, { token });
    assert.equal(tooEarly.status, 403);

    // ครูตรวจอัตนัย + ปล่อยผล
    const textAnswer = await prisma.answer.findFirst({ where: { submissionId, questionId: text.id } });
    await server.client.patch(
      `/api/grading/answers/${textAnswer.id}`,
      { isCorrect: true, awardedPoints: 2 },
      { token: teacherTokenValue },
    );
    await server.client.post(
      `/api/grading/submissions/${submissionId}/release`,
      {},
      { token: teacherTokenValue },
    );

    // ปล่อยแล้ว → เห็นคะแนน/เฉลยผ่านเส้นทางนักเรียน
    const result = await server.client.get(`/api/my/results/${submissionId}`, { token });
    assert.equal(result.status, 200);
    assert.equal(result.data.result.summary.totalScore, 4);
    assert.equal(
      result.data.result.questions.some((question) => question.choices?.some((choice) => choice.isCorrect)),
      true,
    );
  });
});
