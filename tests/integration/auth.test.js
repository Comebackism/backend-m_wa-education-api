import { after, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { disconnectDatabase, prisma, resetDatabase } from '../helpers/db.js';
import {
  DEFAULT_PASSWORD,
  createAdmin,
  createClassroom,
  createStudent,
  createTeacher,
  uniqueEmail,
} from '../helpers/fixtures.js';
import { expectApiError } from '../helpers/api-error.js';
import * as authService from '../../src/services/auth.service.js';
import { hashToken, signRefreshToken, verifyAccessToken, verifyRefreshToken } from '../../src/lib/jwt.js';
import { verifyPassword } from '../../src/lib/password.js';

/** เทสต์ auth service กับฐานข้อมูลจริง: สมัคร / ล็อกอิน / refresh / เปลี่ยนรหัสผ่าน / ออกจากระบบ */

beforeEach(resetDatabase);
after(disconnectDatabase);

const agent = 'jest/test-agent';

describe('registerTeacher', () => {
  it('สร้างบัญชี + ออก token และเก็บ refresh token แบบ hash ลง DB', async () => {
    const email = uniqueEmail('teacher');
    const { user, tokens } = await authService.registerTeacher(
      { email, password: DEFAULT_PASSWORD, fullName: 'ครูทดสอบ' },
      agent,
    );

    assert.equal(user.role, 'TEACHER');
    assert.equal(user.email, email);
    assert.ok(tokens.accessToken && tokens.refreshToken);
    assert.equal(verifyAccessToken(tokens.accessToken).role, 'TEACHER');

    const stored = await prisma.refreshToken.findMany({ where: { userId: user.id } });
    assert.equal(stored.length, 1);
    assert.equal(stored[0].tokenHash, hashToken(tokens.refreshToken));
    assert.notEqual(stored[0].tokenHash, tokens.refreshToken);
    assert.equal(stored[0].userAgent, agent);
  });

  it('อีเมลซ้ำ → 409', async () => {
    const email = uniqueEmail('teacher');
    await authService.registerTeacher({ email, password: DEFAULT_PASSWORD, fullName: 'คนแรก' }, agent);
    await expectApiError(
      authService.registerTeacher({ email, password: DEFAULT_PASSWORD, fullName: 'คนที่สอง' }, agent),
      409,
      /ถูกใช้งานแล้ว/,
    );
  });
});

describe('registerStudent', () => {
  it('สมัครด้วย joinCode → เข้าห้องทันที', async () => {
    const teacher = await createTeacher();
    const classroom = await createClassroom(teacher, { joinCode: 'JOIN01' });

    const { user } = await authService.registerStudent(
      { email: uniqueEmail('student'), password: DEFAULT_PASSWORD, fullName: 'นักเรียน', joinCode: 'JOIN01' },
      agent,
    );

    const enrollment = await prisma.enrollment.findFirst({ where: { studentId: user.id } });
    assert.equal(enrollment.classroomId, classroom.id);
  });

  it('joinCode ไม่ถูกต้อง → 404 และไม่สร้างบัญชีค้าง', async () => {
    const before = await prisma.user.count();
    await expectApiError(
      authService.registerStudent(
        { email: uniqueEmail('student'), password: DEFAULT_PASSWORD, fullName: 'นักเรียน', joinCode: 'NOPE99' },
        agent,
      ),
      404,
      /ไม่พบห้องเรียน/,
    );
    assert.equal(await prisma.user.count(), before);
  });

  it('รหัสนักเรียนซ้ำ → 409', async () => {
    await createStudent({ studentCode: 'S0001' });
    await expectApiError(
      authService.registerStudent(
        {
          email: uniqueEmail('student'),
          password: DEFAULT_PASSWORD,
          fullName: 'นักเรียน',
          studentCode: 'S0001',
        },
        agent,
      ),
      409,
      /รหัสนักเรียนนี้ถูกใช้งานแล้ว/,
    );
  });

  it('อีเมลซ้ำ → 409', async () => {
    const email = uniqueEmail('student');
    await authService.registerStudent({ email, password: DEFAULT_PASSWORD, fullName: 'คนแรก' }, agent);
    await expectApiError(
      authService.registerStudent({ email, password: DEFAULT_PASSWORD, fullName: 'คนที่สอง' }, agent),
      409,
      /ถูกใช้งานแล้ว/,
    );
  });
});

describe('login', () => {
  it('สำเร็จเมื่อรหัสผ่านถูกและบทบาทตรง', async () => {
    const teacher = await createTeacher({ email: uniqueEmail('teacher') });
    const { user, tokens } = await authService.login(
      { email: teacher.email, password: DEFAULT_PASSWORD, role: 'TEACHER' },
      agent,
    );
    assert.equal(user.id, teacher.id);
    assert.ok(tokens.refreshToken);
  });

  it('รหัสผ่านผิด → 401', async () => {
    const teacher = await createTeacher();
    await expectApiError(
      authService.login({ email: teacher.email, password: 'wrong-password', role: 'TEACHER' }, agent),
      401,
      /ไม่ถูกต้อง/,
    );
  });

  it('ไม่พบอีเมล → 401 (ไม่บอกว่าไม่มีบัญชี)', async () => {
    await expectApiError(
      authService.login({ email: uniqueEmail('ghost'), password: DEFAULT_PASSWORD, role: 'TEACHER' }, agent),
      401,
    );
  });

  it('บทบาทไม่ตรงกับบัญชี → 403', async () => {
    const student = await createStudent();
    await expectApiError(
      authService.login({ email: student.email, password: DEFAULT_PASSWORD, role: 'TEACHER' }, agent),
      403,
      /บทบาท/,
    );
  });

  it('บัญชีถูกระงับ → 403', async () => {
    const teacher = await createTeacher({ isActive: false });
    await expectApiError(
      authService.login({ email: teacher.email, password: DEFAULT_PASSWORD, role: 'TEACHER' }, agent),
      403,
      /ระงับการใช้งาน/,
    );
  });

  it('บัญชี ADMIN เข้าได้ทั้งช่องทางครูและนักเรียน', async () => {
    const admin = await createAdmin();
    for (const role of ['TEACHER', 'STUDENT']) {
      const { user } = await authService.login(
        { email: admin.email, password: DEFAULT_PASSWORD, role },
        agent,
      );
      assert.equal(user.id, admin.id, role);
    }
  });

  it('ไม่ส่ง userAgent → เก็บ refresh token เป็น null', async () => {
    const teacher = await createTeacher();
    const { user } = await authService.login({
      email: teacher.email,
      password: DEFAULT_PASSWORD,
      role: 'TEACHER',
    });

    const stored = await prisma.refreshToken.findFirst({ where: { userId: user.id } });
    assert.equal(stored.userAgent, null);
  });
});

describe('refresh', () => {
  it('rotate: ใช้ token เก่าได้ครั้งเดียว แล้วถูกเพิกถอน', async () => {
    const teacher = await createTeacher();
    const first = await authService.login(
      { email: teacher.email, password: DEFAULT_PASSWORD, role: 'TEACHER' },
      agent,
    );

    const rotated = await authService.refresh(first.tokens.refreshToken, agent);
    assert.equal(verifyRefreshToken(rotated.tokens.refreshToken).sub, teacher.id);

    await expectApiError(authService.refresh(first.tokens.refreshToken, agent), 401, /เพิกถอน|หมดอายุ/);
  });

  it('token ที่ปลอมขึ้นมา → 401', async () => {
    await expectApiError(authService.refresh('a'.repeat(40), agent), 401, /ไม่ถูกต้อง/);
  });

  it('refresh token ที่ชี้ผู้ใช้ที่ถูกลบ → 401', async () => {
    const teacher = await createTeacher();
    const ghost = signRefreshToken({ id: '11111111-1111-1111-1111-111111111111', role: 'TEACHER' });
    await prisma.refreshToken.create({
      data: {
        userId: teacher.id,
        tokenHash: hashToken(ghost),
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });

    await expectApiError(authService.refresh(ghost, agent), 401, /ไม่พบผู้ใช้/);
  });
});

describe('changePassword', () => {
  it('รหัสผ่านปัจจุบันผิด → 400', async () => {
    const teacher = await createTeacher();
    await expectApiError(
      authService.changePassword(teacher, { currentPassword: 'wrong', newPassword: 'NewPassword1!' }, agent),
      400,
      /ปัจจุบันไม่ถูกต้อง/,
    );
  });

  it('สำเร็จ → เปลี่ยน hash, เพิกถอน refresh token เดิมทั้งหมด และออกชุดใหม่', async () => {
    const teacher = await createTeacher();
    await authService.login({ email: teacher.email, password: DEFAULT_PASSWORD, role: 'TEACHER' }, agent);

    const { user, tokens } = await authService.changePassword(
      teacher,
      { currentPassword: DEFAULT_PASSWORD, newPassword: 'NewPassword1!' },
      agent,
    );

    assert.equal(await verifyPassword('NewPassword1!', user.passwordHash), true);

    const active = await prisma.refreshToken.findMany({ where: { userId: teacher.id, revokedAt: null } });
    assert.equal(active.length, 1, 'เหลือเฉพาะ refresh token ของเครื่องที่เปลี่ยนรหัสผ่าน');
    assert.equal(active[0].tokenHash, hashToken(tokens.refreshToken));

    const all = await prisma.refreshToken.count({ where: { userId: teacher.id } });
    assert.ok(all >= 2);
  });
});

describe('logout', () => {
  it('เพิกถอน refresh token และไม่ throw เมื่อไม่มี token', async () => {
    const teacher = await createTeacher();
    const { tokens } = await authService.login(
      { email: teacher.email, password: DEFAULT_PASSWORD, role: 'TEACHER' },
      agent,
    );

    await authService.logout(tokens.refreshToken);
    const stored = await prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(tokens.refreshToken) },
    });
    assert.ok(stored.revokedAt instanceof Date);

    await authService.logout(null);
    await authService.logout('not-a-real-token');
  });
});
