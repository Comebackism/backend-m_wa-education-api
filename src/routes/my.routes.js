import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { authenticate, studentOnly } from '../middleware/auth.js';
import { idParams, uuid, withPagination } from '../validators/common.js';
import * as examService from '../services/exam.service.js';
import * as submissionService from '../services/submission.service.js';
import * as resultService from '../services/result.service.js';
import * as classroomService from '../services/classroom.service.js';

const router = Router();

router.use(authenticate, studentOnly);

const displayMode = z.enum(['SINGLE_PAGE', 'PAGINATED']);

// ห้องเรียนที่นักเรียนอยู่
router.get('/classrooms', validate({ query: withPagination() }), async (req, res) => {
  const { items: classrooms, pagination } = await classroomService.listStudentClassrooms(
    req.user.id,
    req.validatedQuery,
  );
  res.json({ classrooms, ...(pagination ? { pagination } : {}) });
});

// ข้อสอบที่ได้รับมอบหมาย
router.get('/exams', validate({ query: withPagination() }), async (req, res) => {
  const { items: exams, pagination } = await examService.listStudentExams(req.user.id, req.validatedQuery);
  res.json({ exams, ...(pagination ? { pagination } : {}) });
});

// รายละเอียดข้อสอบ (ไม่มีเฉลย) — ตรวจ IP restriction ด้วยถ้าข้อสอบตั้งไว้
router.get('/exams/:examId', validate({ params: idParams('examId') }), async (req, res) => {
  const exam = await examService.getStudentExamDetail(req.params.examId, req.user.id, { clientIp: req.ip });
  res.json({ exam });
});

// เริ่มทำข้อสอบ (หรือทำต่อจากใบเดิมที่ยังไม่ส่ง) — ตรวจ IP restriction ตอนเข้าทำ
router.post(
  '/exams/:examId/submissions',
  validate({ params: idParams('examId'), body: z.object({ displayMode: displayMode.optional() }) }),
  async (req, res) => {
    const submission = await submissionService.startSubmission(req.params.examId, req.user.id, {
      displayMode: req.body.displayMode,
      clientIp: req.ip,
    });
    res.status(201).json({ submission });
  },
);

router.get('/submissions/:submissionId', validate({ params: idParams('submissionId') }), async (req, res) => {
  const submission = await submissionService.getStudentSubmission(req.user.id, req.params.submissionId);
  res.json({ submission });
});

// บันทึกคำตอบระหว่างทำ (bulk)
router.put(
  '/submissions/:submissionId/answers',
  validate({
    params: idParams('submissionId'),
    body: z.object({
      answers: z
        .array(
          z.object({
            questionId: uuid,
            choiceId: uuid.nullish(),
            textAnswer: z.string().max(20000).nullish(),
          }),
        )
        .min(1)
        .max(200),
    }),
  }),
  async (req, res) => {
    const result = await submissionService.saveAnswers(
      req.params.submissionId,
      req.user.id,
      req.body.answers,
    );
    res.json(result);
  },
);

// ส่งข้อสอบ
router.post(
  '/submissions/:submissionId/submit',
  validate({ params: idParams('submissionId'), body: z.object({ displayMode: displayMode.optional() }) }),
  async (req, res) => {
    const submission = await submissionService.submitSubmission(
      req.params.submissionId,
      req.user.id,
      req.body,
    );
    res.json({ submission });
  },
);

// ผลสอบ (เห็นเฉพาะที่ครูกดปล่อยผลแล้ว)
router.get('/results', validate({ query: withPagination({ examId: uuid.optional() }) }), async (req, res) => {
  const { items: results, pagination } = await resultService.listStudentResults(
    req.user.id,
    req.validatedQuery,
  );
  res.json({ results, ...(pagination ? { pagination } : {}) });
});

router.get('/results/:submissionId', validate({ params: idParams('submissionId') }), async (req, res) => {
  const result = await resultService.getStudentResult(req.user.id, req.params.submissionId);
  res.json({ result });
});

export default router;
