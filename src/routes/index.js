import { Router } from 'express';
import authRoutes from './auth.routes.js';
import courseRoutes from './course.routes.js';
import classroomRoutes from './classroom.routes.js';
import studentRoutes from './student.routes.js';
import examRoutes from './exam.routes.js';
import myRoutes from './my.routes.js';
import gradingRoutes from './grading.routes.js';

const router = Router();

router.get('/', (req, res) => {
  res.json({
    name: 'wa-education-api',
    version: '0.1.0',
    docs: 'see README.md',
    endpoints: {
      auth: '/api/auth',
      courses: '/api/courses',
      classrooms: '/api/classrooms',
      students: '/api/students',
      exams: '/api/exams',
      grading: '/api/grading',
      student: '/api/my',
    },
  });
});

router.use('/auth', authRoutes);
router.use('/courses', courseRoutes);
router.use('/classrooms', classroomRoutes);
router.use('/students', studentRoutes);
router.use('/exams', examRoutes);
router.use('/grading', gradingRoutes);
router.use('/my', myRoutes);

export default router;
