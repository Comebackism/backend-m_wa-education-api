import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { authenticate, teacherOnly } from '../middleware/auth.js';
import { idParams, optionalQueryString } from '../validators/common.js';
import * as courseService from '../services/course.service.js';

const router = Router();

router.use(authenticate, teacherOnly);

const courseBody = z.object({
  code: z.string().trim().min(1, 'ต้องระบุรหัสวิชา').max(50),
  title: z.string().trim().min(1, 'ต้องระบุชื่อวิชา').max(200),
  description: z.string().max(2000).nullish(),
});

const coursePatch = courseBody.partial();

router.get('/', validate({ query: z.object({ q: optionalQueryString }) }), async (req, res) => {
  const courses = await courseService.listCourses(req.user, req.validatedQuery);
  res.json({ courses });
});

router.post('/', validate({ body: courseBody }), async (req, res) => {
  const course = await courseService.createCourse(req.user, req.body);
  res.status(201).json({ course });
});

router.get('/:courseId', validate({ params: idParams('courseId') }), async (req, res) => {
  const course = await courseService.getCourseDetail(req.user, req.params.courseId);
  res.json({ course });
});

router.patch('/:courseId', validate({ params: idParams('courseId'), body: coursePatch }), async (req, res) => {
  const course = await courseService.updateCourse(req.user, req.params.courseId, req.body);
  res.json({ course });
});

router.delete('/:courseId', validate({ params: idParams('courseId') }), async (req, res) => {
  const result = await courseService.deleteCourse(req.user, req.params.courseId);
  res.json(result);
});

export default router;
