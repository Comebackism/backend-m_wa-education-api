import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { authenticate, teacherOnly } from '../middleware/auth.js';
import { idParams } from '../validators/common.js';
import * as gradingService from '../services/grading.service.js';

const router = Router();

router.use(authenticate, teacherOnly);

const submissionStatus = z.enum(['IN_PROGRESS', 'SUBMITTED', 'GRADED', 'RELEASED']);

// รายการส่งข้อสอบของทั้งชุด
router.get(
  '/exams/:examId/submissions',
  validate({ params: idParams('examId'), query: z.object({ status: submissionStatus.optional() }) }),
  async (req, res) => {
    const submissions = await gradingService.listExamSubmissions(req.user.id, req.params.examId, req.validatedQuery);
    res.json({ submissions });
  },
);

// ปล่อยผลทั้งชุด (เฉพาะคนที่ตรวจครบ)
router.post('/exams/:examId/release', validate({ params: idParams('examId') }), async (req, res) => {
  const result = await gradingService.releaseExamResults(req.user.id, req.params.examId);
  res.json(result);
});

// สถิติภาพรวมของข้อสอบชุดนี้ (ไว้ทำ dashboard: รอตรวจ/รอปล่อยผล, คะแนนเฉลี่ย, อัตราตอบถูกต่อข้อ)
router.get('/exams/:examId/stats', validate({ params: idParams('examId') }), async (req, res) => {
  const stats = await gradingService.getExamStats(req.user.id, req.params.examId);
  res.json({ stats });
});

// ส่งออกผลคะแนนทั้งชุดเป็น CSV (รองรับ ?status=)
router.get(
  '/exams/:examId/export',
  validate({ params: idParams('examId'), query: z.object({ status: submissionStatus.optional() }) }),
  async (req, res) => {
    const { filename, title, content } = await gradingService.exportExamResultsCsv(
      req.user.id,
      req.params.examId,
      req.validatedQuery,
    );

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    // filename แบบ ASCII สำหรับ client เก่า + filename* แบบ UTF-8 ให้ชื่อไฟล์ภาษาไทยอ่านออก
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(`${title}-results.csv`)}`,
    );
    res.send(content);
  },
);

// รายละเอียดคำตอบทุกข้อของนักเรียน 1 คน
router.get('/submissions/:submissionId', validate({ params: idParams('submissionId') }), async (req, res) => {
  const submission = await gradingService.getSubmissionDetail(req.user.id, req.params.submissionId);
  res.json({ submission });
});

// ตรวจอัตนัย 1 ข้อ: ตัดสินถูก/ไม่ถูก + หมายเหตุ + (ปรับคะแนนได้)
router.patch(
  '/answers/:answerId',
  validate({
    params: idParams('answerId'),
    body: z.object({
      isCorrect: z.boolean({ error: 'ต้องระบุ isCorrect (true = ถูก, false = ไม่ถูก)' }),
      awardedPoints: z.coerce.number().min(0).optional(),
      graderComment: z.string().max(2000).nullish(),
    }),
  }),
  async (req, res) => {
    const submission = await gradingService.gradeAnswer(req.user.id, req.params.answerId, req.body);
    res.json({ submission });
  },
);

// ปุ่ม "ส่งผลไปให้นักเรียน"
router.post('/submissions/:submissionId/release', validate({ params: idParams('submissionId') }), async (req, res) => {
  const submission = await gradingService.releaseSubmission(req.user.id, req.params.submissionId);
  res.json({ submission });
});

export default router;
