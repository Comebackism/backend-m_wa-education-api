import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/auth.js';
import { loginLimiter, registerLimiter, changePasswordLimiter } from '../middleware/rateLimit.js';
import { publicUser } from '../lib/errors.js';
import * as authService from '../services/auth.service.js';

const router = Router();

const emailSchema = z.email().max(255);
const passwordSchema = z.string().min(8, 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร').max(72);
const fullNameSchema = z.string().trim().min(1, 'ต้องระบุชื่อ-นามสกุล').max(200);

const teacherRegisterSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  fullName: fullNameSchema,
});

const studentRegisterSchema = teacherRegisterSchema.extend({
  studentCode: z.string().trim().min(1).max(50).optional(),
  joinCode: z.string().trim().min(4).max(20).optional(),
});

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'ต้องระบุรหัสผ่าน'),
  role: z.enum(['TEACHER', 'STUDENT'], { error: 'role ต้องเป็น TEACHER หรือ STUDENT' }),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(10, 'ต้องระบุ refreshToken'),
});

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'ต้องระบุรหัสผ่านปัจจุบัน').max(72),
    newPassword: passwordSchema,
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านปัจจุบัน',
    path: ['newPassword'],
  });

const userAgentOf = (req) => req.headers['user-agent'];

function respondWithTokens(res, { user, tokens }, statusCode = 200) {
  return res.status(statusCode).json({ user: publicUser(user), ...tokens });
}

// ครูสมัครสมาชิก
router.post('/teacher/register', registerLimiter, validate({ body: teacherRegisterSchema }), async (req, res) => {
  const result = await authService.registerTeacher(req.body, userAgentOf(req));
  respondWithTokens(res, result, 201);
});

// นักเรียนสมัครสมาชิก (แนบ joinCode มาด้วยเพื่อเข้าห้องเรียนทันที)
router.post('/student/register', registerLimiter, validate({ body: studentRegisterSchema }), async (req, res) => {
  const result = await authService.registerStudent(req.body, userAgentOf(req));
  respondWithTokens(res, result, 201);
});

// เข้าสู่ระบบ — แยกช่องทางตามบทบาท (ส่ง role มาด้วยเสมอ)
router.post('/login', loginLimiter, validate({ body: loginSchema }), async (req, res) => {
  const result = await authService.login(req.body, userAgentOf(req));
  respondWithTokens(res, result);
});

// ต่ออายุ token (refresh token ถูก rotate ทุกครั้ง)
router.post('/refresh', validate({ body: refreshSchema }), async (req, res) => {
  const result = await authService.refresh(req.body.refreshToken, userAgentOf(req));
  respondWithTokens(res, result);
});

// ออกจากระบบ — เพิกถอน refresh token
router.post('/logout', validate({ body: refreshSchema }), async (req, res) => {
  await authService.logout(req.body.refreshToken);
  res.status(204).end();
});

// ข้อมูลผู้ใช้ปัจจุบัน
router.get('/me', authenticate, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

// เปลี่ยนรหัสผ่านของบัญชีตัวเอง (นักเรียน/ครู/ผู้ดูแล ใช้ได้เหมือนกัน)
// ต้องยืนยันรหัสผ่านปัจจุบัน และเมื่อสำเร็จ refresh token ทุกเครื่องเดิมจะถูกเพิกถอน
router.patch(
  '/password',
  changePasswordLimiter,
  authenticate,
  validate({ body: changePasswordSchema }),
  async (req, res) => {
    const result = await authService.changePassword(req.user, req.body, userAgentOf(req));
    respondWithTokens(res, result);
  },
);

export default router;
