import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { authenticate, teacherOnly } from '../middleware/auth.js';
import { idParams, optionalQueryString, uuid } from '../validators/common.js';
import * as classroomService from '../services/classroom.service.js';

const router = Router();

router.use(authenticate, teacherOnly);

const createStudentBody = z
  .object({
    email: z.email().max(255),
    fullName: z.string().trim().min(1, 'ต้องระบุชื่อ-นามสกุล').max(200),
    studentCode: z.string().trim().min(1).max(50).optional(),
    password: z.string().min(8, 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร').max(72).optional(),
    classroomId: uuid.optional(),
  })
  .strict();

const updateStudentBody = z
  .object({
    fullName: z.string().trim().min(1).max(200).optional(),
    email: z.email().max(255).optional(),
    studentCode: z.string().trim().min(1).max(50).nullish(),
    isActive: z.boolean().optional(),
  })
  .strict();

// แม่แบบ CSV สำหรับนำเข้ารายชื่อนักเรียน (ปุ่ม "ดาวน์โหลดแม่แบบ")
router.get('/template', (req, res) => {
  const { filename, content } = classroomService.buildStudentRosterTemplateCsv();

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(content);
});

// รายชื่อนักเรียนทั้งหมดของครู (รวมทุกห้องเรียน)
router.get('/', validate({ query: z.object({ q: optionalQueryString }) }), async (req, res) => {
  const students = await classroomService.listTeacherStudents(req.user, req.validatedQuery);
  res.json({ students });
});

// ปุ่ม "+" เพิ่มนักเรียน (แนบ classroomId เพื่อเข้าห้องทันที)
router.post('/', validate({ body: createStudentBody }), async (req, res) => {
  const result = await classroomService.createStudent(req.user, req.body);
  res.status(201).json(result);
});

router.patch(
  '/:studentId',
  validate({ params: idParams('studentId'), body: updateStudentBody }),
  async (req, res) => {
    const student = await classroomService.updateStudent(req.user, req.params.studentId, req.body);
    res.json({ student });
  },
);

router.delete('/:studentId', validate({ params: idParams('studentId') }), async (req, res) => {
  const result = await classroomService.removeStudentFromTeacherClassrooms(req.user, req.params.studentId);
  res.json(result);
});

router.post(
  '/:studentId/reset-password',
  validate({
    params: idParams('studentId'),
    body: z.object({ password: z.string().min(8).max(72).optional() }),
  }),
  async (req, res) => {
    const result = await classroomService.resetStudentPassword(
      req.user,
      req.params.studentId,
      req.body.password,
    );
    res.json(result);
  },
);

export default router;
