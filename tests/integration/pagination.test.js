import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { disconnectDatabase, resetDatabase } from '../helpers/db.js';
import { startTestServer } from '../helpers/http.js';
import { createStudent, enroll, uniqueEmail } from '../helpers/fixtures.js';

/**
 * เทสต์ pagination ระดับ HTTP
 *
 * กฎที่ต้องคงไว้: "ไม่ส่ง ?page / ?limit มา = คืนทั้งหมดเหมือนเดิม"
 * เพื่อไม่ให้ frontend เดิมที่ยังไม่ส่งพารามิเตอร์พัง
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

async function registerTeacher() {
  const res = await server.client.post('/api/auth/teacher/register', {
    email: uniqueEmail('pager'),
    password: PASSWORD,
    fullName: 'ครูทดสอบแบ่งหน้า',
  });
  assert.equal(res.status, 201);
  return res.data.accessToken;
}

async function createCourses(token, count) {
  const created = [];
  for (let index = 1; index <= count; index += 1) {
    const res = await server.client.post(
      '/api/courses',
      { code: `C${index}`, title: `วิชา ${index}` },
      { token },
    );
    assert.equal(res.status, 201);
    created.push(res.data.course);
  }
  return created;
}

describe('pagination: GET /api/courses', () => {
  it('ไม่ส่ง page/limit → คืนทั้งหมด และไม่มี field pagination (สัญญาเดิม)', async () => {
    const token = await registerTeacher();
    await createCourses(token, 3);

    const res = await server.client.get('/api/courses', { token });
    assert.equal(res.status, 200);
    assert.equal(res.data.courses.length, 3);
    assert.equal('pagination' in res.data, false);
  });

  it('limit=2 → คืน 2 รายการ พร้อม meta ครบ', async () => {
    const token = await registerTeacher();
    await createCourses(token, 3);

    const res = await server.client.get('/api/courses?page=1&limit=2', { token });
    assert.equal(res.status, 200);
    assert.equal(res.data.courses.length, 2);
    assert.deepEqual(res.data.pagination, {
      page: 1,
      limit: 2,
      total: 3,
      totalPages: 2,
      hasNext: true,
      hasPrev: false,
    });
  });

  it('หน้าสุดท้าย: hasNext = false', async () => {
    const token = await registerTeacher();
    await createCourses(token, 3);

    const res = await server.client.get('/api/courses?page=2&limit=2', { token });
    assert.equal(res.status, 200);
    assert.equal(res.data.courses.length, 1);
    assert.equal(res.data.pagination.hasNext, false);
    assert.equal(res.data.pagination.hasPrev, true);
  });

  it('ขอหน้าที่เกินจำนวน → คืน array ว่าง แต่ total ยังถูก', async () => {
    const token = await registerTeacher();
    await createCourses(token, 3);

    const res = await server.client.get('/api/courses?page=9&limit=2', { token });
    assert.equal(res.status, 200);
    assert.deepEqual(res.data.courses, []);
    assert.equal(res.data.pagination.total, 3);
    assert.equal(res.data.pagination.totalPages, 2);
  });

  it('ส่ง limit อย่างเดียว → เริ่มที่หน้า 1 อัตโนมัติ', async () => {
    const token = await registerTeacher();
    await createCourses(token, 3);

    const res = await server.client.get('/api/courses?limit=1', { token });
    assert.equal(res.status, 200);
    assert.equal(res.data.courses.length, 1);
    assert.equal(res.data.pagination.page, 1);
  });

  it('ค่าไม่ถูกต้อง → 400', async () => {
    const token = await registerTeacher();

    for (const query of ['limit=0', 'limit=101', 'page=0', 'page=abc']) {
      const res = await server.client.get(`/api/courses?${query}`, { token });
      assert.equal(res.status, 400, `query "${query}" ต้องถูกปฏิเสธ`);
    }
  });
});

describe('pagination: GET /api/students (นับตามคน ไม่ใช่ enrollment)', () => {
  it('นักเรียนคนเดียวอยู่ 2 ห้อง → นับเป็น 1 และไม่ถูกตัดข้ามหน้า', async () => {
    const token = await registerTeacher();

    const first = await server.client.post('/api/classrooms', { name: 'ม.5/1' }, { token });
    const second = await server.client.post('/api/classrooms', { name: 'ม.5/2' }, { token });
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);

    const studentA = await createStudent({ fullName: 'ก้อง ใจดี' });
    const studentB = await createStudent({ fullName: 'นก น้อย' });
    for (const classroom of [first.data.classroom, second.data.classroom]) {
      await enroll(studentA, classroom);
      await enroll(studentB, classroom);
    }

    const res = await server.client.get('/api/students?page=1&limit=1', { token });
    assert.equal(res.status, 200);
    assert.equal(res.data.students.length, 1);
    // 2 คน (ไม่ใช่ 4 enrollment)
    assert.equal(res.data.pagination.total, 2);
    assert.equal(res.data.pagination.totalPages, 2);

    const page2 = await server.client.get('/api/students?page=2&limit=1', { token });
    assert.equal(page2.data.students.length, 1);
    assert.notEqual(page2.data.students[0].id, res.data.students[0].id);
  });
});

describe('pagination: GET /api/classrooms/:id/students', () => {
  it('แบ่งหน้ารายชื่อในห้องได้', async () => {
    const token = await registerTeacher();
    const created = await server.client.post('/api/classrooms', { name: 'ม.5/3' }, { token });
    assert.equal(created.status, 201);

    for (let index = 1; index <= 3; index += 1) {
      await enroll(await createStudent({ fullName: `นักเรียน ${index}` }), created.data.classroom);
    }

    const res = await server.client.get(`/api/classrooms/${created.data.classroom.id}/students?limit=2`, {
      token,
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.students.length, 2);
    assert.equal(res.data.pagination.total, 3);
    assert.equal(res.data.pagination.hasNext, true);
  });
});

describe('pagination: GET /api/exams', () => {
  it('กรองด้วย status แล้วแบ่งหน้าได้พร้อมกัน', async () => {
    const token = await registerTeacher();
    for (let index = 1; index <= 3; index += 1) {
      const res = await server.client.post('/api/exams', { title: `ข้อสอบ ${index}` }, { token });
      assert.equal(res.status, 201);
    }

    const res = await server.client.get('/api/exams?status=DRAFT&limit=2', { token });
    assert.equal(res.status, 200);
    assert.equal(res.data.exams.length, 2);
    assert.equal(res.data.pagination.total, 3);
  });
});
