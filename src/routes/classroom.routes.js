import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { authenticate, studentOnly, teacherOnly } from '../middleware/auth.js';
import { idParams, uuid } from '../validators/common.js';
import * as classroomService from '../services/classroom.service.js';

const router = Router();

router.use(authenticate);

const createClassroomBody = z.object({
  name: z.string().trim().min(1).max(200),
  courseId: uuid,
});

// นักเรียน: เข้าห้องเรียนด้วยรหัส
router.post(
  '/join',
  studentOnly,
  validate({ body: z.object({ joinCode: z.string().trim().min(4).max(20) }) }),
  async (req, res) => {
    const classroom = await classroomService.joinClassroom(req.user.id, req.body.joinCode);
    res.status(201).json({ classroom });
  },
);

// ครู: จัดการห้องเรียน
router.use(teacherOnly);

const addStudentBody = z.object({
  studentId: uuid.optional(),
  email: z.email().optional(),
  studentCode: z.string().trim().min(1).max(50).optional(),
  fullName: z.string().trim().min(1).max(200).optional(),
  password: z.string().min(8).max(72).optional(),
});

const classroomIdParams = idParams('classroomId');

router.get('/', validate({ query: z.object({ courseId: uuid.optional() }) }), async (req, res) => {
  const classrooms = await classroomService.listClassrooms(req.user.id, req.validatedQuery);
  res.json({ classrooms });
});

router.post('/', validate({ body: createClassroomBody }), async (req, res) => {
  const classroom = await classroomService.createClassroom(req.user.id, req.body);
  res.status(201).json({ classroom });
});

router.get('/:classroomId', validate({ params: classroomIdParams }), async (req, res) => {
  const classroom = await classroomService.getClassroomDetail(req.user.id, req.params.classroomId);
  res.json({ classroom });
});

router.patch(
  '/:classroomId',
  validate({ params: classroomIdParams, body: z.object({ name: z.string().trim().min(1).max(200) }) }),
  async (req, res) => {
    const classroom = await classroomService.updateClassroom(req.user.id, req.params.classroomId, req.body);
    res.json({ classroom });
  },
);

router.delete('/:classroomId', validate({ params: classroomIdParams }), async (req, res) => {
  const result = await classroomService.deleteClassroom(req.user.id, req.params.classroomId);
  res.json(result);
});

// รายชื่อนักเรียนในห้อง
router.get('/:classroomId/students', validate({ params: classroomIdParams }), async (req, res) => {
  await classroomService.ensureOwned(req.user.id, req.params.classroomId);
  const students = await classroomService.listStudents(req.params.classroomId);
  res.json({ students });
});

// เพิ่มนักเรียนเข้าห้อง (ปุ่ม "+")
router.post(
  '/:classroomId/students',
  validate({ params: classroomIdParams, body: addStudentBody.refine(
    (data) => Boolean(data.studentId || data.email || data.studentCode),
    { message: 'ต้องระบุ studentId, email หรือ studentCode อย่างใดอย่างหนึ่ง' },
  ) }),
  async (req, res) => {
    const result = await classroomService.addStudentToClassroom(req.user.id, req.params.classroomId, req.body);
    res.status(201).json(result);
  },
);

// เอานักเรียนออกจากห้อง
router.delete(
  '/:classroomId/students/:studentId',
  validate({ params: z.object({ classroomId: uuid, studentId: uuid }) }),
  async (req, res) => {
    const result = await classroomService.removeStudentFromClassroom(
      req.user.id,
      req.params.classroomId,
      req.params.studentId,
    );
    res.json(result);
  },
);

export default router;
