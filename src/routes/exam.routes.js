import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { authenticate, teacherOnly } from '../middleware/auth.js';
import { uploadSingleFile } from '../middleware/upload.js';
import { ApiError } from '../lib/errors.js';
import { formatIp, getClientIp, normalizeIp, validateIpRules } from '../lib/ipAllowlist.js';
import { booleanQuery, idParams, uuid, withPagination } from '../validators/common.js';
import { DEFAULT_CUTOFFS } from '../services/exam.service.js';
import * as examService from '../services/exam.service.js';

const router = Router();

router.use(authenticate, teacherOnly);

// --- schemas ---------------------------------------------------------------

const ipRulesSchema = z
  .array(z.string().trim().min(1).max(64))
  .max(50)
  .superRefine((rules, ctx) => {
    const message = validateIpRules(rules);
    if (message) ctx.addIssue({ code: 'custom', message });
  });

const examBody = z.object({
  title: z.string().trim().min(1, 'ต้องระบุชื่อข้อสอบ').max(200),
  description: z.string().max(5000).nullish(),
  courseId: uuid.nullish(),
  timeLimitMinutes: z.coerce.number().int().positive().max(1440).nullish(),
  defaultDisplayMode: z.enum(['SINGLE_PAGE', 'PAGINATED']).optional(),
  questionsPerPage: z.coerce.number().int().min(1).max(100).optional(),
  allowedIpRanges: ipRulesSchema.optional(),
});

const choiceSchema = z.object({
  label: z.string().trim().min(1).max(10),
  text: z.string().trim().min(1).max(2000),
  isCorrect: z.boolean().default(false),
  order: z.number().int().min(0).optional(),
});

const questionBody = z.object({
  type: z.enum(['MULTIPLE_CHOICE', 'SHORT_ANSWER', 'LONG_ANSWER']),
  prompt: z.string().trim().min(1).max(20000),
  points: z.coerce.number().positive('คะแนนต้องมากกว่า 0').max(1000),
  order: z.number().int().min(0).optional(),
  referenceText: z.string().max(20000).nullish(),
  explanation: z.string().max(20000).nullish(),
  choices: z.array(choiceSchema).max(10).optional(),
});

const cutoffsBody = z.object({
  cutoffs: z
    .array(
      z.object({
        grade: z.string().trim().min(1).max(5),
        minPercent: z.coerce.number().min(0).max(100),
      }),
    )
    .min(1, 'ต้องมีเกณฑ์อย่างน้อย 1 ระดับ')
    .max(20),
});

const assignmentBody = z.object({
  classroomId: uuid,
  availableFrom: z.coerce.date().nullish(),
  availableTo: z.coerce.date().nullish(),
});

// --- exams -----------------------------------------------------------------

router.get(
  '/',
  validate({
    query: withPagination({
      status: z.enum(['DRAFT', 'PUBLISHED', 'CLOSED']).optional(),
      courseId: uuid.optional(),
    }),
  }),
  async (req, res) => {
    const { items: exams, pagination } = await examService.listExams(req.user, req.validatedQuery);
    res.json({ exams, ...(pagination ? { pagination } : {}) });
  },
);

router.post('/', validate({ body: examBody }), async (req, res) => {
  const exam = await examService.createExam(req.user, req.body);
  res.status(201).json({ exam });
});

// เกณฑ์ตัดเกรดมาตรฐาน (ให้ frontend ใช้เป็นค่าเริ่มต้นในฟอร์ม)
router.get('/default-cutoffs', (req, res) => {
  res.json({ cutoffs: DEFAULT_CUTOFFS });
});

// IP ปัจจุบันของผู้เรียก — ให้ครูคัดลอกไปใส่ในช่อง "จำกัด IP" ได้ง่าย (ปุ่ม "ใช้ IP นี้")
router.get('/request-ip', (req, res) => {
  const ip = getClientIp(req);
  const parsed = normalizeIp(ip);
  res.json({ ip, normalizedIp: parsed ? formatIp(parsed) : null, version: parsed?.version ?? null });
});

// แม่แบบ CSV สำหรับนำเข้าข้อคำถาม (ปุ่ม "นำเข้าข้อสอบจากไฟล์" → ดาวน์โหลดแม่แบบ)
router.get('/questions/import-template', (req, res) => {
  const { filename, content } = examService.buildQuestionImportTemplateCsv();

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(content);
});

router.get('/:examId', validate({ params: idParams('examId') }), async (req, res) => {
  const exam = await examService.getExamDetail(req.user, req.params.examId);
  res.json({ exam });
});

router.patch(
  '/:examId',
  validate({ params: idParams('examId'), body: examBody.partial() }),
  async (req, res) => {
    const exam = await examService.updateExam(req.user, req.params.examId, req.body);
    res.json({ exam });
  },
);

router.delete(
  '/:examId',
  validate({ params: idParams('examId'), query: z.object({ force: booleanQuery }) }),
  async (req, res) => {
    const result = await examService.deleteExam(req.user, req.params.examId, req.validatedQuery);
    res.json(result);
  },
);

// --- publish / close -------------------------------------------------------

router.post('/:examId/publish', validate({ params: idParams('examId') }), async (req, res) => {
  const exam = await examService.publishExam(req.user, req.params.examId);
  res.json({ exam });
});

router.post('/:examId/close', validate({ params: idParams('examId') }), async (req, res) => {
  const exam = await examService.closeExam(req.user, req.params.examId);
  res.json({ exam });
});

// --- questions -------------------------------------------------------------

router.post(
  '/:examId/questions',
  validate({ params: idParams('examId'), body: questionBody }),
  async (req, res) => {
    const question = await examService.addQuestion(req.user, req.params.examId, req.body);
    res.status(201).json({ question });
  },
);

router.put(
  '/:examId/questions/order',
  validate({
    params: idParams('examId'),
    body: z.object({ items: z.array(z.object({ id: uuid, order: z.number().int().min(0) })).min(1) }),
  }),
  async (req, res) => {
    const questions = await examService.reorderQuestions(req.user, req.params.examId, req.body.items);
    res.json({ questions });
  },
);

// นำเข้าข้อคำถามจากไฟล์ CSV / .xlsx (multipart, ฟิลด์ชื่อ "file")
// ?dryRun=true → ตรวจไฟล์และพรีวิวโดยไม่บันทึก
router.post(
  '/:examId/questions/import',
  validate({ params: idParams('examId'), query: z.object({ dryRun: booleanQuery }) }),
  uploadSingleFile('file'),
  async (req, res) => {
    if (!req.file) throw ApiError.badRequest('ต้องแนบไฟล์ในฟิลด์ "file" (.csv หรือ .xlsx)');

    const result = await examService.importQuestionsFromFile(
      req.user,
      req.params.examId,
      { buffer: req.file.buffer, filename: req.file.originalname },
      { dryRun: req.validatedQuery?.dryRun === true },
    );

    res.status(result.dryRun ? 200 : 201).json(result);
  },
);

router.patch(
  '/:examId/questions/:questionId',
  validate({ params: idParams('examId').extend({ questionId: uuid }), body: questionBody.partial() }),
  async (req, res) => {
    const question = await examService.updateQuestion(
      req.user,
      req.params.examId,
      req.params.questionId,
      req.body,
    );
    res.json({ question });
  },
);

router.delete(
  '/:examId/questions/:questionId',
  validate({ params: idParams('examId').extend({ questionId: uuid }) }),
  async (req, res) => {
    const result = await examService.deleteQuestion(req.user, req.params.examId, req.params.questionId);
    res.json(result);
  },
);

// --- grade cutoffs ---------------------------------------------------------

router.get('/:examId/cutoffs', validate({ params: idParams('examId') }), async (req, res) => {
  const cutoffs = await examService.getCutoffs(req.user, req.params.examId);
  res.json({ cutoffs });
});

router.put(
  '/:examId/cutoffs',
  validate({ params: idParams('examId'), body: cutoffsBody }),
  async (req, res) => {
    const cutoffs = await examService.replaceCutoffs(req.user, req.params.examId, req.body.cutoffs);
    res.json({ cutoffs });
  },
);

// --- assignments (mอบหมายข้อสอบให้ห้องเรียน) --------------------------------

router.post(
  '/:examId/assignments',
  validate({ params: idParams('examId'), body: assignmentBody }),
  async (req, res) => {
    const assignment = await examService.assignClassroom(req.user, req.params.examId, req.body);
    res.status(201).json({ assignment });
  },
);

router.delete(
  '/:examId/assignments/:assignmentId',
  validate({ params: idParams('examId').extend({ assignmentId: uuid }) }),
  async (req, res) => {
    const result = await examService.unassignClassroom(req.user, req.params.examId, req.params.assignmentId);
    res.json(result);
  },
);

export default router;
