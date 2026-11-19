import { ApiError } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { hashToken, signAccessToken, signRefreshToken, verifyRefreshToken } from '../lib/jwt.js';

/**
 * ออก access + refresh token แล้วเก็บ refresh token แบบ hash ลง DB
 */
async function issueTokens(user, userAgent) {
  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);
  const payload = verifyRefreshToken(refreshToken);

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(payload.exp * 1000),
      userAgent: userAgent?.slice(0, 255) ?? null,
    },
  });

  return { accessToken, refreshToken, expiresAt: new Date(payload.exp * 1000) };
}

export async function registerTeacher({ email, password, fullName }, userAgent) {
  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) throw ApiError.conflict('อีเมลนี้ถูกใช้งานแล้ว');

  const user = await prisma.user.create({
    data: { email, passwordHash: await hashPassword(password), fullName, role: 'TEACHER' },
  });

  return { user, tokens: await issueTokens(user, userAgent) };
}

export async function registerStudent({ email, password, fullName, studentCode, joinCode }, userAgent) {
  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) throw ApiError.conflict('อีเมลนี้ถูกใช้งานแล้ว');

  if (studentCode) {
    const codeTaken = await prisma.user.findUnique({ where: { studentCode } });
    if (codeTaken) throw ApiError.conflict('รหัสนักเรียนนี้ถูกใช้งานแล้ว');
  }

  const passwordHash = await hashPassword(password);

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email,
        passwordHash,
        fullName,
        role: 'STUDENT',
        studentCode: studentCode ?? null,
      },
    });

    // สมัครด้วยรหัสห้องเรียน → เข้าห้องให้เลย
    if (joinCode) {
      const classroom = await tx.classroom.findUnique({ where: { joinCode } });
      if (!classroom) throw ApiError.notFound('ไม่พบห้องเรียนที่ตรงกับรหัสที่ให้มา');
      await tx.enrollment.create({ data: { classroomId: classroom.id, studentId: created.id } });
    }

    return created;
  });

  // ออก token หลัง transaction commit แล้วเท่านั้น (refresh token อ้าง FK ไปที่ user)
  return { user, tokens: await issueTokens(user, userAgent) };
}

/**
 * login แยกช่องทาง 2 บทบาท → ต้องระบุ role และต้องตรงกับบัญชีจริง
 * บัญชี ADMIN เข้าได้ทั้งช่องทางนักเรียนและครู
 */
export async function login({ email, password, role }, userAgent) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw ApiError.unauthorized('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
  if (!user.isActive) throw ApiError.forbidden('บัญชีนี้ถูกระงับการใช้งาน');
  if (user.role !== role && user.role !== 'ADMIN') {
    throw ApiError.forbidden(`บัญชีนี้เป็นบทบาท ${user.role} กรุณาเข้าสู่ระบบผ่านช่องทางของ ${user.role}`);
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) throw ApiError.unauthorized('อีเมลหรือรหัสผ่านไม่ถูกต้อง');

  return { user, tokens: await issueTokens(user, userAgent) };
}

/**
 * เปลี่ยนรหัสผ่านของบัญชีตัวเอง (ทุกบทบาทที่ล็อกอินอยู่)
 * - ต้องยืนยันรหัสผ่านปัจจุบันก่อน
 * - เพิกถอน refresh token ทุกตัว (session เก่าทุกเครื่องหลุด) แล้วออกชุดใหม่ให้เครื่องนี้
 */
export async function changePassword(user, { currentPassword, newPassword }, userAgent) {
  const ok = await verifyPassword(currentPassword, user.passwordHash);
  if (!ok) throw ApiError.badRequest('รหัสผ่านปัจจุบันไม่ถูกต้อง');

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(newPassword) },
  });

  await prisma.refreshToken.updateMany({
    where: { userId: user.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  return { user: updated, tokens: await issueTokens(updated, userAgent) };
}

/** ต่ออายุ token (rotate: refresh token เก่าถูกเพิกถอนทันที) */
export async function refresh(refreshToken, userAgent) {
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw ApiError.unauthorized('refresh token ไม่ถูกต้องหรือหมดอายุ');
  }

  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(refreshToken) } });
  if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
    throw ApiError.unauthorized('refresh token ถูกเพิกถอนหรือหมดอายุแล้ว');
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user || !user.isActive) throw ApiError.unauthorized('ไม่พบผู้ใช้ หรือบัญชีถูกระงับ');

  await prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });

  return { user, tokens: await issueTokens(user, userAgent) };
}

export async function logout(refreshToken) {
  if (!refreshToken) return;
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashToken(refreshToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
