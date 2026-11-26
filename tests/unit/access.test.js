import { after, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  actorId,
  getExamForStudent,
  getOwnedClassroom,
  getOwnedExam,
  getOwnedSubmission,
  isAdminActor,
} from '../../src/lib/access.js';
import { disconnectDatabase, resetDatabase } from '../helpers/db.js';
import {
  createAdmin,
  createClassroom,
  createExam,
  createPublishedExam,
  createStudent,
  createSubmission,
  createTeacher,
  enroll,
} from '../helpers/fixtures.js';
import { expectApiError } from '../helpers/api-error.js';

/** เทสต์ตัวช่วยระบุ "actor" (ฟังก์ชันล้วน) — โมดูล import prisma จึงปิด pool ท้ายไฟล์ */

after(disconnectDatabase);

const MISSING = '11111111-1111-1111-1111-111111111111';

describe('actorId', () => {
  it('รับสตริง (teacherId เดิม) → คืนสตริง', () => {
    assert.equal(actorId('user-1'), 'user-1');
  });

  it('รับ object → คืน id', () => {
    assert.equal(actorId({ id: 'user-2', role: 'TEACHER' }), 'user-2');
  });

  it('ค่าที่ไม่มี id → undefined', () => {
    assert.equal(actorId({}), undefined);
    assert.equal(actorId(null), undefined);
    assert.equal(actorId(undefined), undefined);
  });
});

describe('isAdminActor', () => {
  it('object ที่มี role ADMIN → true', () => {
    assert.equal(isAdminActor({ id: 'a', role: 'ADMIN' }), true);
  });

  it('role อื่น → false', () => {
    assert.equal(isAdminActor({ id: 't', role: 'TEACHER' }), false);
    assert.equal(isAdminActor({ id: 's', role: 'STUDENT' }), false);
  });

  it('สตริงหรือค่า null ถือว่าไม่ใช่ ADMIN', () => {
    assert.equal(isAdminActor('ADMIN'), false);
    assert.equal(isAdminActor(null), false);
    assert.equal(isAdminActor(undefined), false);
  });
});

describe('ownership helpers (ฐานข้อมูลจริง)', () => {
  beforeEach(resetDatabase);

  it('getOwnedClassroom: ADMIN เข้าถึงห้องของครูคนอื่นได้', async () => {
    const teacher = await createTeacher();
    const classroom = await createClassroom(teacher);
    const owned = await getOwnedClassroom(await createAdmin(), classroom.id);
    assert.equal(owned.id, classroom.id);
    assert.ok(owned.course === null || typeof owned.course === 'object');
  });

  it('getOwnedClassroom: ไม่พบ → 404', async () => {
    await expectApiError(getOwnedClassroom({ id: 'x', role: 'TEACHER' }, MISSING), 404);
  });

  it('getOwnedExam: ADMIN เข้าถึงข้อสอบของครูคนอื่นได้', async () => {
    const teacher = await createTeacher();
    const exam = await createExam(teacher);
    assert.equal((await getOwnedExam(await createAdmin(), exam.id)).id, exam.id);
  });

  it('getOwnedExam: ไม่พบ → 404', async () => {
    await expectApiError(getOwnedExam({ id: 'x', role: 'TEACHER' }, MISSING), 404);
  });

  it('getOwnedSubmission: ADMIN เข้าถึงใบของครูคนอื่นได้', async () => {
    const teacher = await createTeacher();
    const classroom = await createClassroom(teacher);
    const student = await createStudent();
    await enroll(student, classroom);
    const { exam } = await createPublishedExam(teacher, classroom);
    const submission = await createSubmission(exam, student);

    const owned = await getOwnedSubmission(await createAdmin(), submission.id);
    assert.equal(owned.id, submission.id);
  });

  it('getOwnedSubmission: ไม่พบ → 404', async () => {
    await expectApiError(getOwnedSubmission({ id: 'x', role: 'TEACHER' }, MISSING), 404);
  });

  it('getExamForStudent: ไม่พบข้อสอบ → 404', async () => {
    await expectApiError(getExamForStudent(MISSING, MISSING), 404);
  });
});
