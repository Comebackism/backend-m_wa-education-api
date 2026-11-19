import { after, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { disconnectDatabase, prisma, resetDatabase } from '../helpers/db.js';
import {
  DEFAULT_PASSWORD,
  createClassroom,
  createStudent,
  createTeacher,
  enroll,
  uniqueEmail,
} from '../helpers/fixtures.js';
import { expectApiError } from '../helpers/api-error.js';
import { buildXlsxBuffer, toCsvRows } from '../helpers/csv.js';
import { STUDENT_IMPORT_HEADERS } from '../../src/lib/studentImport.js';
import { verifyPassword } from '../../src/lib/password.js';
import * as classroomService from '../../src/services/classroom.service.js';

/** เทสต์นำเข้ารายชื่อนักเรียนจริง (all-or-nothing, ผูก/ข้าม, dryRun) กับฐานข้อมูลจริง */

beforeEach(resetDatabase);
after(disconnectDatabase);

const HEADER = [...STUDENT_IMPORT_HEADERS];

function rosterBuffer(rows, { xlsx = false } = {}) {
  if (xlsx) return buildXlsxBuffer([HEADER, ...rows]);
  return Promise.resolve(Buffer.from(toCsvRows([HEADER, ...rows], { bom: true }), 'utf8'));
}

describe('importStudentsFromFile — สร้างบัญชีใหม่', () => {
  it('สร้างบัญชี + ผูกเข้าห้อง และรหัสผ่านที่คืนมาใช้ล็อกอินได้', async () => {
    const teacher = await createTeacher();
    const classroom = await createClassroom(teacher);

    const email = uniqueEmail('newkid');
    const buffer = await rosterBuffer([['S100', 'เด็กใหม่ ใจดี', email, 'KidPass123!']]);
    const result = await classroomService.importStudentsFromFile(
      teacher,
      classroom.id,
      { buffer, filename: 'roster.csv' },
      {},
    );

    assert.equal(result.created, 1);
    assert.equal(result.enrolled, 0);
    assert.equal(result.skipped, 0);
    assert.match(result.message, /สร้างบัญชีใหม่ 1 คน/);

    const student = await prisma.user.findUnique({ where: { email } });
    assert.equal(student.role, 'STUDENT');
    assert.equal(student.fullName, 'เด็กใหม่ ใจดี');
    assert.equal(student.studentCode, 'S100');
    assert.equal(await verifyPassword('KidPass123!', student.passwordHash), true);

    const enrollment = await prisma.enrollment.findFirst({ where: { classroomId: classroom.id, studentId: student.id } });
    assert.ok(enrollment);
  });

  it('ไม่ระบุรหัสผ่าน → ระบบสุ่มให้ 12 ตัว และล็อกอินได้', async () => {
    const teacher = await createTeacher();
    const classroom = await createClassroom(teacher);
    const email = uniqueEmail('random');

    const buffer = await rosterBuffer([['', 'ไม่มีรหัส', email, '']]);
    const result = await classroomService.importStudentsFromFile(teacher, classroom.id, { buffer, filename: 'r.csv' }, {});

    const entry = result.students[0];
    assert.equal(entry.temporaryPassword.length, 12);
    const student = await prisma.user.findUnique({ where: { email } });
    assert.equal(await verifyPassword(entry.temporaryPassword, student.passwordHash), true);
  });

  it('อ่านไฟล์ .xlsx ได้', async () => {
    const teacher = await createTeacher();
    const classroom = await createClassroom(teacher);
    const buffer = await rosterBuffer([['S1', 'เอ็กเซล', uniqueEmail('xlsx'), 'Passw0rd!']], { xlsx: true });

    const result = await classroomService.importStudentsFromFile(teacher, classroom.id, { buffer, filename: 'r.xlsx' }, {});
    assert.equal(result.created, 1);
  });
});

describe('importStudentsFromFile — บัญชีเดิม', () => {
  it('มีบัญชีแล้วแต่ยังไม่อยู่ในห้อง → ผูกเข้าห้อง', async () => {
    const teacher = await createTeacher();
    const classroom = await createClassroom(teacher);
    const student = await createStudent({ email: uniqueEmail('existing'), studentCode: 'EX01' });

    const buffer = await rosterBuffer([['EX01', student.fullName, student.email, '']]);
    const result = await classroomService.importStudentsFromFile(teacher, classroom.id, { buffer, filename: 'r.csv' }, {});

    assert.equal(result.created, 0);
    assert.equal(result.enrolled, 1);
    assert.match(result.message, /ผูกเข้าห้อง 1 คน/);
    assert.equal(await prisma.user.count(), 2); // ครู + นักเรียนเดิม (ไม่สร้างซ้ำ)
  });

  it('อยู่ในห้องนี้แล้ว → ข้าม (ไม่ถือเป็น error)', async () => {
    const teacher = await createTeacher();
    const classroom = await createClassroom(teacher);
    const student = await createStudent({ email: uniqueEmail('member') });
    await enroll(student, classroom);

    const buffer = await rosterBuffer([[student.studentCode ?? '', student.fullName, student.email, '']]);
    const result = await classroomService.importStudentsFromFile(teacher, classroom.id, { buffer, filename: 'r.csv' }, {});

    assert.equal(result.skipped, 1);
    assert.equal(result.enrolled, 0);
    assert.match(result.message, /ข้าม 1 คน/);
  });

  it('อีเมลตรงกับบัญชีครู → error ทั้งไฟล์', async () => {
    const teacher = await createTeacher();
    const classroom = await createClassroom(teacher);

    const buffer = await rosterBuffer([['', 'ไม่ใช่เด็ก', teacher.email, '']]);
    await expectApiError(
      classroomService.importStudentsFromFile(teacher, classroom.id, { buffer, filename: 'r.csv' }, {}),
      400,
      /ยังไม่นำเข้ารายชื่อใดเลย/,
      /ไม่ใช่บทบาทนักเรียน/,
    );
  });

  it('รหัสนักเรียนตรงกับบัญชีที่ไม่ใช่บทบาทนักเรียน → error ทั้งไฟล์', async () => {
    const teacher = await createTeacher({ studentCode: 'TCH999' });
    const classroom = await createClassroom(teacher);

    const buffer = await rosterBuffer([['TCH999', 'ไม่ใช่เด็ก', uniqueEmail('code'), '']]);
    await expectApiError(
      classroomService.importStudentsFromFile(teacher, classroom.id, { buffer, filename: 'r.csv' }, {}),
      400,
      /ยังไม่นำเข้ารายชื่อใดเลย/,
      /รหัสนักเรียนนี้ถูกใช้โดยบัญชีที่ไม่ใช่บทบาทนักเรียน/,
    );
  });

  it('อีเมลกับรหัสนักเรียนตรงกับบัญชีคนละคน → error ทั้งไฟล์', async () => {
    const teacher = await createTeacher();
    const classroom = await createClassroom(teacher);
    const byEmail = await createStudent({ email: uniqueEmail('email-owner') });
    await createStudent({ studentCode: 'CODE777' });

    const buffer = await rosterBuffer([['CODE777', 'สลับคน', byEmail.email, '']]);
    await expectApiError(
      classroomService.importStudentsFromFile(teacher, classroom.id, { buffer, filename: 'r.csv' }, {}),
      400,
      /ยังไม่นำเข้ารายชื่อใดเลย/,
      /ตรงกับบัญชีคนละคน/,
    );
  });
});

describe('importStudentsFromFile — all-or-nothing', () => {
  it('มีแถวผิด 1 แถว → ไม่สร้างสักคน และคืนเลขแถว', async () => {
    const teacher = await createTeacher();
    const classroom = await createClassroom(teacher);
    const goodEmail = uniqueEmail('good');

    const buffer = await rosterBuffer([
      ['S1', 'ถูกต้อง', goodEmail, 'Passw0rd!'],
      ['S2', 'อีเมลพัง', 'not-an-email', 'Passw0rd!'],
    ]);

    await expectApiError(
      classroomService.importStudentsFromFile(teacher, classroom.id, { buffer, filename: 'r.csv' }, {}),
      400,
      /ยังไม่นำเข้ารายชื่อใดเลย/,
    );

    assert.equal(await prisma.user.count({ where: { email: goodEmail } }), 0);
    assert.equal(await prisma.enrollment.count({ where: { classroomId: classroom.id } }), 0);
  });

  it('error มาพร้อม details [{ row, message }]', async () => {
    const teacher = await createTeacher();
    const classroom = await createClassroom(teacher);

    await expectApiError(
      classroomService.importStudentsFromFile(
        teacher,
        classroom.id,
        { buffer: Buffer.from(toCsvRows([HEADER, ['S1', 'ไม่มีอีเมล', '', '']]), 'utf8'), filename: 'r.csv' },
        {},
      ),
      400,
      /ยังไม่นำเข้ารายชื่อใดเลย/,
      /2\s+ต้องระบุอีเมล/,
    );
  });

  it('อีเมลซ้ำในไฟล์เดียว → error ทั้งไฟล์', async () => {
    const teacher = await createTeacher();
    const classroom = await createClassroom(teacher);
    const email = uniqueEmail('dup');

    await expectApiError(
      classroomService.importStudentsFromFile(
        teacher,
        classroom.id,
        { buffer: await rosterBuffer([['', 'A', email, ''], ['', 'B', email, '']]), filename: 'r.csv' },
        {},
      ),
      400,
      /ยังไม่นำเข้ารายชื่อใดเลย/,
      /ซ้ำกับแถวที่/,
    );
  });
});

describe('importStudentsFromFile — dryRun', () => {
  it('สรุปผลโดยไม่บันทึกอะไรลง DB', async () => {
    const teacher = await createTeacher();
    const classroom = await createClassroom(teacher);
    const existing = await createStudent({ email: uniqueEmail('exists') });
    await enroll(existing, classroom);
    const newEmail = uniqueEmail('fresh');

    const buffer = await rosterBuffer([
      ['', 'คนใหม่', newEmail, ''],
      ['', 'คนเดิม', existing.email, ''],
      ['', 'คนเดิมอีกห้อง', (await createStudent({ email: uniqueEmail('other') })).email, ''],
    ]);
    const before = await prisma.user.count();

    const result = await classroomService.importStudentsFromFile(
      teacher,
      classroom.id,
      { buffer, filename: 'r.csv' },
      { dryRun: true },
    );

    assert.equal(result.dryRun, true);
    assert.equal(result.wouldCreate, 1);
    assert.equal(result.wouldEnroll, 1);
    assert.equal(result.wouldSkip, 1);
    assert.equal(result.students.every((entry) => entry.temporaryPassword === undefined), true);
    assert.equal(await prisma.user.count({ where: { email: newEmail } }), 0);
    assert.equal(await prisma.user.count(), before);
  });
});

describe('importStudentsFromFile — สิทธิ์', () => {
  it('ห้องของครูคนอื่น → 403', async () => {
    const owner = await createTeacher();
    const intruder = await createTeacher();
    const classroom = await createClassroom(owner);

    await expectApiError(
      classroomService.importStudentsFromFile(
        intruder,
        classroom.id,
        { buffer: await rosterBuffer([['', 'A', uniqueEmail('a'), '']]), filename: 'r.csv' },
        {},
      ),
      403,
      /ไม่ใช่ของคุณ/,
    );
  });

  it('ADMIN นำเข้าห้องของครูคนอื่นได้', async () => {
    const { createAdmin } = await import('../helpers/fixtures.js');
    const owner = await createTeacher();
    const admin = await createAdmin();
    const classroom = await createClassroom(owner);

    const result = await classroomService.importStudentsFromFile(
      admin,
      classroom.id,
      { buffer: await rosterBuffer([['', 'A', uniqueEmail('admin-import'), 'Passw0rd!']]), filename: 'r.csv' },
      {},
    );
    assert.equal(result.created, 1);
  });
});

describe('buildStudentRosterTemplateCsv', () => {
  it('คืนไฟล์แม่แบบที่มีหัวคอลัมน์ครบ', () => {
    const { filename, content } = classroomService.buildStudentRosterTemplateCsv();
    assert.equal(filename, 'student_roster_template.csv');
    for (const header of HEADER) assert.ok(content.includes(header), header);
  });
});

describe('addStudentToClassroom', () => {
  it('สร้างบัญชีใหม่พร้อมรหัสผ่านชั่วคราวที่ใช้ได้', async () => {
    const teacher = await createTeacher();
    const classroom = await createClassroom(teacher);
    const email = uniqueEmail('added');

    const { student, temporaryPassword } = await classroomService.addStudentToClassroom(teacher, classroom.id, {
      email,
      fullName: 'เพิ่มเอง',
    });

    assert.equal(student.role, 'STUDENT');
    assert.equal(temporaryPassword.length, 12);
    const stored = await prisma.user.findUnique({ where: { id: student.id } });
    assert.equal(await verifyPassword(temporaryPassword, stored.passwordHash), true);
  });

  it('ผูกนักเรียนเดิมด้วยอีเมล', async () => {
    const teacher = await createTeacher();
    const classroom = await createClassroom(teacher);
    const student = await createStudent();

    const result = await classroomService.addStudentToClassroom(teacher, classroom.id, { email: student.email });
    assert.equal(result.student.id, student.id);
    assert.equal(result.temporaryPassword, null);
  });

  it('ผูกนักเรียนเดิมด้วยรหัสนักเรียน', async () => {
    const teacher = await createTeacher();
    const classroom = await createClassroom(teacher);
    const student = await createStudent({ studentCode: 'LOOKUP01' });

    const result = await classroomService.addStudentToClassroom(teacher, classroom.id, { studentCode: 'LOOKUP01' });
    assert.equal(result.student.id, student.id);
    assert.equal(await prisma.enrollment.count({ where: { classroomId: classroom.id } }), 1);
  });

  it('ไม่มีทั้ง email/studentCode แล้วสร้างใหม่ก็ไม่ระบุชื่อ → 400', async () => {
    const teacher = await createTeacher();
    const classroom = await createClassroom(teacher);
    await expectApiError(
      classroomService.addStudentToClassroom(teacher, classroom.id, {}),
      400,
      /ต้องระบุ email และ fullName/,
    );
  });

  it('นักเรียนอยู่ในห้องแล้ว → 409', async () => {
    const teacher = await createTeacher();
    const classroom = await createClassroom(teacher);
    const student = await createStudent();
    await enroll(student, classroom);

    await expectApiError(
      classroomService.addStudentToClassroom(teacher, classroom.id, { studentId: student.id }),
      409,
      /อยู่ในห้องเรียนนี้แล้ว/,
    );
  });

  it('รหัสผ่านซ้ำรหัสนักเรียน → 400', async () => {
    const teacher = await createTeacher();
    const classroom = await createClassroom(teacher);
    await expectApiError(
      classroomService.addStudentToClassroom(teacher, classroom.id, {
        email: uniqueEmail('x'),
        fullName: 'X',
        studentCode: 'CODE123',
        password: 'CODE123',
      }),
      400,
      /ต้องไม่ซ้ำกับรหัสนักเรียน/,
    );
  });

  it('บัญชีที่ไม่ใช่ STUDENT → 400', async () => {
    const teacher = await createTeacher();
    const classroom = await createClassroom(teacher);
    const otherTeacher = await createTeacher();

    await expectApiError(
      classroomService.addStudentToClassroom(teacher, classroom.id, { studentId: otherTeacher.id }),
      400,
      /ไม่ใช่บทบาท STUDENT/,
    );
  });
});

describe('resetStudentPassword', () => {
  it('สุ่มรหัสผ่านใหม่ 12 ตัวที่ใช้ล็อกอินได้', async () => {
    const teacher = await createTeacher();
    const classroom = await createClassroom(teacher);
    const student = await createStudent();
    await enroll(student, classroom);

    const { password } = await classroomService.resetStudentPassword(teacher, student.id);
    assert.equal(password.length, 12);

    const stored = await prisma.user.findUnique({ where: { id: student.id } });
    assert.equal(await verifyPassword(password, stored.passwordHash), true);
  });

  it('นักเรียนนอกห้องของครู → 404', async () => {
    const teacher = await createTeacher();
    const stranger = await createStudent();
    await expectApiError(classroomService.resetStudentPassword(teacher, stranger.id), 404);
  });

  it('รหัสผ่านเก่าใช้ไม่ได้แล้ว', async () => {
    const teacher = await createTeacher();
    const classroom = await createClassroom(teacher);
    const student = await createStudent({ password: DEFAULT_PASSWORD });
    await enroll(student, classroom);

    await classroomService.resetStudentPassword(teacher, student.id);
    const stored = await prisma.user.findUnique({ where: { id: student.id } });
    assert.equal(await verifyPassword(DEFAULT_PASSWORD, stored.passwordHash), false);
  });
});

describe('createStudent (เส้นทาง POST /students)', () => {
  it('สร้างบัญชีลอยโดยไม่ผูกห้อง และคืนรหัสผ่านชั่วคราว', async () => {
    const teacher = await createTeacher();
    const email = uniqueEmail('floating');

    const { student, temporaryPassword } = await classroomService.createStudent(teacher, {
      email,
      fullName: 'เด็กไม่มีห้อง',
      studentCode: 'FREE01',
    });

    assert.equal(student.role, 'STUDENT');
    assert.equal(student.email, email);
    assert.equal(temporaryPassword.length, 12);
    assert.equal(await prisma.enrollment.count(), 0);

    const stored = await prisma.user.findUnique({ where: { id: student.id } });
    assert.equal(await verifyPassword(temporaryPassword, stored.passwordHash), true);
  });

  it('ระบุ classroomId → สร้างและผูกเข้าห้องทันที', async () => {
    const teacher = await createTeacher();
    const classroom = await createClassroom(teacher);
    const email = uniqueEmail('withroom');

    const { student } = await classroomService.createStudent(teacher, {
      email,
      fullName: 'เด็กมีห้อง',
      classroomId: classroom.id,
    });

    assert.equal(await prisma.enrollment.count({ where: { classroomId: classroom.id, studentId: student.id } }), 1);
  });

  it('อีเมลซ้ำบัญชีเดิม → 409', async () => {
    const teacher = await createTeacher();
    const existing = await createStudent();

    await expectApiError(
      classroomService.createStudent(teacher, { email: existing.email, fullName: 'ซ้ำ' }),
      409,
      /ถูกใช้งานแล้ว/,
    );
  });

  it('ไม่ระบุ email/fullName → 400', async () => {
    const teacher = await createTeacher();
    await expectApiError(classroomService.createStudent(teacher, { email: uniqueEmail('no-name') }), 400, /ต้องระบุ email และ fullName/);
  });
});
