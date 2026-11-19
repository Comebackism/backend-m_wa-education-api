import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

import { disconnectDatabase, prisma, resetDatabase } from '../helpers/db.js';
import { startTestServer } from '../helpers/http.js';
import { createClassroom, createTeacher, uniqueEmail } from '../helpers/fixtures.js';
import { toCsvRows } from '../helpers/csv.js';
import { env } from '../../src/config/env.js';
import { STUDENT_IMPORT_HEADERS } from '../../src/lib/studentImport.js';
import { QUESTION_IMPORT_HEADERS } from '../../src/lib/questionImport.js';

/**
 * เทสต์ระดับ HTTP ผ่าน Express จริง (fetch ของ Node)
 * ครอบคลุม: สุขภาพระบบ, 404, การยืนยันตัวตน/สิทธิ์, validation,
 * การนำเข้าไฟล์ multipart, และเส้นทางหลักของครู/นักเรียน
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

async function registerTeacher(email) {
  const res = await server.client.post('/api/auth/teacher/register', {
    email,
    password: PASSWORD,
    fullName: 'ครูสมัครใหม่',
  });
  assert.equal(res.status, 201);
  return res.data;
}

describe('พื้นฐาน', () => {
  it('GET /health → ok', async () => {
    const res = await server.client.get('/health');
    assert.equal(res.status, 200);
    assert.equal(res.data.status, 'ok');
  });

  it('GET /api → บอกรายการ endpoint', async () => {
    const res = await server.client.get('/api');
    assert.equal(res.status, 200);
    assert.equal(res.data.endpoints.auth, '/api/auth');
  });

  it('เส้นทางที่ไม่รู้จัก → 404 NOT_FOUND', async () => {
    const res = await server.client.get('/api/ไม่มีอยู่');
    assert.equal(res.status, 404);
    assert.equal(res.data.error.code, 'NOT_FOUND');
  });

  it('ไม่ส่ง token → 401', async () => {
    const res = await server.client.get('/api/auth/me');
    assert.equal(res.status, 401);
    assert.equal(res.data.error.code, 'UNAUTHORIZED');
  });

  it('token ผิด → 401', async () => {
    const res = await server.client.get('/api/auth/me', { token: 'not-a-token' });
    assert.equal(res.status, 401);
  });

  it('JSON เพี้ยน → 400', async () => {
    const res = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{bad json',
    });
    assert.equal(res.status, 400);
  });
});

describe('auth ผ่าน HTTP', () => {
  it('สมัครครูแล้วได้ token และดึง /me ได้ (ไม่ leak passwordHash)', async () => {
    const email = uniqueEmail('teacher');
    const data = await registerTeacher(email);
    assert.ok(data.accessToken && data.refreshToken);
    assert.equal(data.user.email, email);
    assert.equal('passwordHash' in data.user, false);

    const me = await server.client.get('/api/auth/me', { token: data.accessToken });
    assert.equal(me.status, 200);
    assert.equal(me.data.user.email, email);
  });

  it('validation: อีเมลผิด/รหัสสั้น → 400 พร้อม field', async () => {
    const res = await server.client.post('/api/auth/teacher/register', {
      email: 'not-an-email',
      password: 'short',
      fullName: '',
    });
    assert.equal(res.status, 400);
    assert.equal(res.data.error.code, 'BAD_REQUEST');
    assert.ok(res.data.error.details.some((detail) => detail.field.startsWith('body.')));
  });

  it('ล็อกอินผิดรหัสผ่าน → 401', async () => {
    const { user } = await registerTeacher(uniqueEmail('teacher'));
    const res = await server.client.post('/api/auth/login', {
      email: user.email,
      password: 'wrong',
      role: 'TEACHER',
    });
    assert.equal(res.status, 401);
    assert.match(res.data.error.message, /ไม่ถูกต้อง/);
  });

  it('refresh แล้ว token เก่าใช้ไม่ได้', async () => {
    const { refreshToken } = await registerTeacher(uniqueEmail('teacher'));
    const rotated = await server.client.post('/api/auth/refresh', { refreshToken });
    assert.equal(rotated.status, 200);

    const again = await server.client.post('/api/auth/refresh', { refreshToken });
    assert.equal(again.status, 401);
  });

  it('logout → 204 และ refresh ต่อไม่ได้', async () => {
    const { refreshToken } = await registerTeacher(uniqueEmail('teacher'));
    const out = await server.client.post('/api/auth/logout', { refreshToken });
    assert.equal(out.status, 204);
    const res = await server.client.post('/api/auth/refresh', { refreshToken });
    assert.equal(res.status, 401);
  });

  it('เปลี่ยนรหัสผ่าน: รหัสเดิมผิด → 400, สำเร็จ → ออก token ใหม่', async () => {
    const email = uniqueEmail('teacher');
    const { accessToken } = await registerTeacher(email);

    const bad = await server.client.patch(
      '/api/auth/password',
      { currentPassword: 'wrong', newPassword: 'NewPassword1!' },
      { token: accessToken },
    );
    assert.equal(bad.status, 400);

    const ok = await server.client.patch(
      '/api/auth/password',
      { currentPassword: PASSWORD, newPassword: 'NewPassword1!' },
      { token: accessToken },
    );
    assert.equal(ok.status, 200);
    assert.ok(ok.data.accessToken);

    const login = await server.client.post('/api/auth/login', {
      email,
      password: 'NewPassword1!',
      role: 'TEACHER',
    });
    assert.equal(login.status, 200);
  });

  it('รหัสใหม่ซ้ำรหัสเดิม → 400', async () => {
    const { accessToken } = await registerTeacher(uniqueEmail('teacher'));
    const res = await server.client.patch(
      '/api/auth/password',
      { currentPassword: PASSWORD, newPassword: PASSWORD },
      { token: accessToken },
    );
    assert.equal(res.status, 400);
  });

  it('token ที่ verify ผ่านแต่ type ไม่ใช่ access → 401', async () => {
    const teacher = await createTeacher();
    // เซ็นด้วย access secret แต่ type = refresh (กรณีตรวจชั้นสองของ middleware)
    const wrongType = jwt.sign({ sub: teacher.id, role: 'TEACHER', type: 'refresh' }, env.JWT_ACCESS_SECRET, {
      expiresIn: '15m',
      issuer: 'wa-education-api',
    });
    const res = await server.client.get('/api/auth/me', { token: wrongType });
    assert.equal(res.status, 401);
    assert.match(res.data.error.message, /access token เท่านั้น/);
  });

  it('บัญชีถูกระงับการใช้งาน → 401', async () => {
    const data = await registerTeacher(uniqueEmail('teacher'));
    await prisma.user.update({ where: { id: data.user.id }, data: { isActive: false } });

    const res = await server.client.get('/api/auth/me', { token: data.accessToken });
    assert.equal(res.status, 401);
    assert.match(res.data.error.message, /ถูกระงับ/);
  });

  it('token ของผู้ใช้ที่ถูกลบไปแล้ว → 401', async () => {
    const data = await registerTeacher(uniqueEmail('teacher'));
    await prisma.user.delete({ where: { id: data.user.id } });

    const res = await server.client.get('/api/auth/me', { token: data.accessToken });
    assert.equal(res.status, 401);
  });
});

describe('การแยกบทบาท', () => {
  it('นักเรียนเรียกเส้นทางครู → 403', async () => {
    const teacher = await createTeacher();
    await createClassroom(teacher, { joinCode: 'CLS001' });

    const email = uniqueEmail('student');
    const res = await server.client.post('/api/auth/student/register', {
      email,
      password: PASSWORD,
      fullName: 'นักเรียน',
      joinCode: 'CLS001',
    });
    assert.equal(res.status, 201);

    const courses = await server.client.get('/api/courses', { token: res.data.accessToken });
    assert.equal(courses.status, 403);
  });

  it('ครูเรียกเส้นทางนักเรียน → 403', async () => {
    const { accessToken } = await registerTeacher(uniqueEmail('teacher'));
    const res = await server.client.get('/api/my/exams', { token: accessToken });
    assert.equal(res.status, 403);
  });
});

describe('ดาวน์โหลดแม่แบบ CSV', () => {
  it('GET /api/students/template → CSV พร้อมหัวคอลัมน์', async () => {
    const { accessToken } = await registerTeacher(uniqueEmail('teacher'));
    const res = await server.client.get('/api/students/template', { token: accessToken });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/csv/);
    for (const header of STUDENT_IMPORT_HEADERS) assert.ok(res.text.includes(header), header);
  });

  it('GET /api/exams/questions/import-template → CSV', async () => {
    const { accessToken } = await registerTeacher(uniqueEmail('teacher'));
    const res = await server.client.get('/api/exams/questions/import-template', { token: accessToken });
    assert.equal(res.status, 200);
    for (const header of QUESTION_IMPORT_HEADERS) assert.ok(res.text.includes(header), header);
  });
});

describe('นำเข้ารายชื่อนักเรียนผ่าน multipart', () => {
  it('?dryRun=true → 200 และไม่บันทึก', async () => {
    const { accessToken } = await registerTeacher(uniqueEmail('teacher'));
    const created = await server.client.post('/api/classrooms', { name: 'ม.6/1' }, { token: accessToken });
    const classroomId = created.data.classroom.id;

    const form = new FormData();
    form.append(
      'file',
      new Blob([
        toCsvRows([[...STUDENT_IMPORT_HEADERS], ['S1', 'เด็กใหม่', uniqueEmail('new'), 'KidPass123!']], {
          bom: true,
        }),
      ]),
      'roster.csv',
    );

    const res = await server.client.post(`/api/classrooms/${classroomId}/students/import?dryRun=true`, form, {
      token: accessToken,
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.dryRun, true);
    assert.equal(res.data.wouldCreate, 1);
    assert.equal(await prisma.user.count(), 1); // มีแค่ครู
  });

  it('นำเข้าจริง → 201 และสร้างบัญชี', async () => {
    const { accessToken } = await registerTeacher(uniqueEmail('teacher'));
    const created = await server.client.post('/api/classrooms', { name: 'ม.6/2' }, { token: accessToken });
    const classroomId = created.data.classroom.id;

    const form = new FormData();
    form.append(
      'file',
      new Blob([
        toCsvRows([[...STUDENT_IMPORT_HEADERS], ['S2', 'เด็กจริง', uniqueEmail('real'), 'KidPass123!']], {
          bom: true,
        }),
      ]),
      'roster.csv',
    );

    const res = await server.client.post(`/api/classrooms/${classroomId}/students/import`, form, {
      token: accessToken,
    });
    assert.equal(res.status, 201);
    assert.equal(res.data.created, 1);
    assert.equal(await prisma.user.count(), 2);
  });

  it('ไม่แนบไฟล์ → 400', async () => {
    const { accessToken } = await registerTeacher(uniqueEmail('teacher'));
    const created = await server.client.post('/api/classrooms', { name: 'ม.6/3' }, { token: accessToken });
    const form = new FormData();
    const res = await server.client.post(
      `/api/classrooms/${created.data.classroom.id}/students/import`,
      form,
      {
        token: accessToken,
      },
    );
    assert.equal(res.status, 400);
    assert.match(res.data.error.message, /ต้องแนบไฟล์/);
  });
});

describe('เส้นทางหลักของนักเรียนผ่าน HTTP', () => {
  it('สมัคร → ดูข้อสอบ → เริ่มทำ → บันทึก → ส่ง → รอผล', async () => {
    // เตรียมข้อมูลด้วย service เพื่อความรวดเร็ว
    const { createPublishedExam } = await import('../helpers/fixtures.js');
    const teacher = await createTeacher();
    const classroom = await createClassroom(teacher, { joinCode: 'JOIN99' });
    const { exam, mc } = await createPublishedExam(teacher, classroom);

    const email = uniqueEmail('student');
    const registered = await server.client.post('/api/auth/student/register', {
      email,
      password: PASSWORD,
      fullName: 'นักเรียนทดสอบ',
      joinCode: 'JOIN99',
    });
    assert.equal(registered.status, 201);
    const token = registered.data.accessToken;

    const exams = await server.client.get('/api/my/exams', { token });
    assert.equal(exams.status, 200);
    assert.equal(exams.data.exams.length, 1);

    const detail = await server.client.get(`/api/my/exams/${exam.id}`, { token });
    assert.equal(detail.status, 200);
    assert.equal('explanation' in detail.data.exam.questions[0], false);

    const started = await server.client.post(`/api/my/exams/${exam.id}/submissions`, {}, { token });
    assert.equal(started.status, 201);
    const submissionId = started.data.submission.id;

    const saved = await server.client.put(
      `/api/my/submissions/${submissionId}/answers`,
      { answers: [{ questionId: mc.id, choiceId: mc.choices[0].id }] },
      { token },
    );
    assert.equal(saved.status, 200);
    assert.equal(saved.data.savedCount, 1);

    const submitted = await server.client.post(`/api/my/submissions/${submissionId}/submit`, {}, { token });
    assert.equal(submitted.status, 200);
    assert.equal(submitted.data.submission.status, 'SUBMITTED');

    // ยังไม่ปล่อยผล → results ว่าง, เปิดผลตรง ๆ ไม่ได้
    const results = await server.client.get('/api/my/results', { token });
    assert.equal(results.data.results.length, 1);
    assert.equal('totalScore' in results.data.results[0], false);

    const direct = await server.client.get(`/api/my/results/${submissionId}`, { token });
    assert.equal(direct.status, 403);
  });
});

describe('เส้นทางครู: ข้อสอบและตรวจผ่าน HTTP', () => {
  it('สร้างข้อสอบ → เพิ่มข้อ → เผยแพร่ → ดูสถิติ', async () => {
    const { accessToken } = await registerTeacher(uniqueEmail('teacher'));
    const classroom = await server.client.post('/api/classrooms', { name: 'ม.4/9' }, { token: accessToken });

    const examRes = await server.client.post(
      '/api/exams',
      { title: 'สอบเก็บคะแนน', timeLimitMinutes: 60 },
      { token: accessToken },
    );
    assert.equal(examRes.status, 201);
    const examId = examRes.data.exam.id;

    const question = await server.client.post(
      `/api/exams/${examId}/questions`,
      {
        type: 'MULTIPLE_CHOICE',
        prompt: '1+1=?',
        points: 2,
        choices: [
          { label: 'A', text: '1', isCorrect: false },
          { label: 'B', text: '2', isCorrect: true },
        ],
      },
      { token: accessToken },
    );
    assert.equal(question.status, 201);

    const assign = await server.client.post(
      `/api/exams/${examId}/assignments`,
      { classroomId: classroom.data.classroom.id },
      { token: accessToken },
    );
    assert.equal(assign.status, 201);

    const published = await server.client.post(`/api/exams/${examId}/publish`, {}, { token: accessToken });
    assert.equal(published.status, 200);
    assert.equal(published.data.exam.status, 'PUBLISHED');

    const stats = await server.client.get(`/api/grading/exams/${examId}/stats`, { token: accessToken });
    assert.equal(stats.status, 200);
    assert.equal(stats.data.stats.summary.submissions, 0);

    const cutoffs = await server.client.get(`/api/exams/${examId}/cutoffs`, { token: accessToken });
    assert.equal(cutoffs.data.cutoffs.length, 8);
  });

  it('IP: /api/exams/request-ip คืนค่า normalized', async () => {
    const { accessToken } = await registerTeacher(uniqueEmail('teacher'));
    const res = await server.client.get('/api/exams/request-ip', { token: accessToken });
    assert.equal(res.status, 200);
    assert.ok('normalizedIp' in res.data);
  });

  it('validation: สร้างข้อสอบไม่มีชื่อ → 400', async () => {
    const { accessToken } = await registerTeacher(uniqueEmail('teacher'));
    const res = await server.client.post('/api/exams', { title: '' }, { token: accessToken });
    assert.equal(res.status, 400);
    assert.equal(res.data.error.details[0].field, 'body.title');
  });

  it('reset-password ของนักเรียนในห้อง → คืนรหัสใหม่', async () => {
    const { accessToken } = await registerTeacher(uniqueEmail('teacher'));
    const classroom = await server.client.post('/api/classrooms', { name: 'ม.3/7' }, { token: accessToken });
    const studentEmail = uniqueEmail('kid');
    const added = await server.client.post(
      `/api/classrooms/${classroom.data.classroom.id}/students`,
      { email: studentEmail, fullName: 'เด็ก' },
      { token: accessToken },
    );
    assert.equal(added.status, 201);

    const reset = await server.client.post(
      `/api/students/${added.data.student.id}/reset-password`,
      {},
      { token: accessToken },
    );
    assert.equal(reset.status, 200);
    assert.equal(reset.data.password.length, 12);
  });
});
