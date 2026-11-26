import { after, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { disconnectDatabase, prisma, resetDatabase } from '../helpers/db.js';
import {
  addChoiceQuestion,
  addTextQuestion,
  assignClassroom,
  createClassroom,
  createCourse,
  createExam,
  createPublishedExam,
  createStudent,
  createTeacher,
  enroll,
} from '../helpers/fixtures.js';
import { expectApiError } from '../helpers/api-error.js';
import { toCsvRows } from '../helpers/csv.js';
import { QUESTION_IMPORT_HEADERS } from '../../src/lib/questionImport.js';
import * as examService from '../../src/services/exam.service.js';

/** เทสต์ exam service กับฐานข้อมูลจริง: CRUD, ข้อคำถาม, นำเข้าไฟล์, เกณฑ์เกรด, เผยแพร่, ฝั่งนักเรียน */

beforeEach(resetDatabase);
after(disconnectDatabase);

const Q_HEADER = [...QUESTION_IMPORT_HEADERS];
const mcRow = ['ปรนัย', 'ข้อใดถูก?', '2', 'ก', 'ข', 'ค', 'ง', 'A', '', 'อธิบาย'];

describe('createExam / listExams / getExamDetail', () => {
  it('สร้างชุดข้อสอบและ normalize allowedIpRanges', async () => {
    const teacher = await createTeacher();
    const exam = await examService.createExam(teacher, {
      title: 'สอบปลายภาค',
      allowedIpRanges: ['  10.0.0.1 ', '10.0.0.1', ''],
    });
    assert.equal(exam.title, 'สอบปลายภาค');
    assert.equal(exam.status, 'DRAFT');
    assert.deepEqual(exam.allowedIpRanges, ['10.0.0.1']);
    assert.equal(exam.teacherId, teacher.id);
  });

  it('ผูก courseId ที่ไม่ใช่ของครู → 403', async () => {
    const owner = await createTeacher();
    const other = await createTeacher();
    const course = await createCourse(owner);

    await expectApiError(
      examService.createExam(other, { title: 'x', courseId: course.id }),
      403,
      /ไม่ใช่ของคุณ/,
    );
  });

  it('listExams กรองตามสถานะและเจ้าของ', async () => {
    const teacher = await createTeacher();
    const stranger = await createTeacher();
    await createExam(teacher, { title: 'ร่าง', status: 'DRAFT' });
    await createExam(teacher, { title: 'เปิดแล้ว', status: 'PUBLISHED' });
    await createExam(stranger, { title: 'ของคนอื่น', status: 'PUBLISHED' });

    const { items: mine } = await examService.listExams(teacher);
    assert.equal(mine.length, 2);

    const { items: published } = await examService.listExams(teacher, { status: 'PUBLISHED' });
    assert.equal(published.length, 1);
    assert.equal(published[0].title, 'เปิดแล้ว');
  });

  it('ADMIN เห็นข้อสอบทุกชุด', async () => {
    const { createAdmin } = await import('../helpers/fixtures.js');
    const admin = await createAdmin();
    await createExam(await createTeacher(), { title: 'A' });
    await createExam(await createTeacher(), { title: 'B' });
    assert.equal((await examService.listExams(admin)).items.length, 2);
  });

  it('getExamDetail แนบสถิติการส่ง', async () => {
    const teacher = await createTeacher();
    const classroom = await createClassroom(teacher);
    const student = await createStudent();
    await enroll(student, classroom);
    const { exam } = await createPublishedExam(teacher, classroom);
    await prisma.submission.create({
      data: { examId: exam.id, studentId: student.id, status: 'IN_PROGRESS' },
    });

    const detail = await examService.getExamDetail(teacher, exam.id);
    assert.equal(detail.questions.length, 2);
    assert.equal(detail.assignments.length, 1);
    assert.deepEqual(detail.submissionStats, [{ status: 'IN_PROGRESS', count: 1 }]);
  });

  it('ครูคนอื่นเปิดรายละเอียดไม่ได้', async () => {
    const teacher = await createTeacher();
    const exam = await createExam(teacher);
    await expectApiError(examService.getExamDetail(await createTeacher(), exam.id), 403);
  });
});

describe('updateExam / deleteExam', () => {
  it('แก้ไขเฉพาะฟิลด์ที่ส่งมา', async () => {
    const teacher = await createTeacher();
    const exam = await createExam(teacher, { title: 'เดิม' });
    const updated = await examService.updateExam(teacher, exam.id, {
      title: 'ใหม่',
      allowedIpRanges: ['10.0.0.0/8'],
    });
    assert.equal(updated.title, 'ใหม่');
    assert.deepEqual(updated.allowedIpRanges, ['10.0.0.0/8']);
  });

  it('ลบข้อสอบที่มีการส่งแล้ว → 409 แต่ force ได้', async () => {
    const teacher = await createTeacher();
    const student = await createStudent();
    const exam = await createExam(teacher);
    await prisma.submission.create({ data: { examId: exam.id, studentId: student.id } });

    await expectApiError(examService.deleteExam(teacher, exam.id), 409, /force/);
    await examService.deleteExam(teacher, exam.id, { force: true });
    assert.equal(await prisma.exam.count({ where: { id: exam.id } }), 0);
  });

  it('ลบข้อสอบที่ไม่มีการส่งได้เลย', async () => {
    const teacher = await createTeacher();
    const exam = await createExam(teacher);
    await examService.deleteExam(teacher, exam.id);
    assert.equal(await prisma.exam.count(), 0);
  });
});

describe('ข้อคำถาม (addQuestion / update / delete / reorder)', () => {
  it('เพิ่มข้อปรนัยพร้อมตัวเลือก และคิดคะแนนเต็มใหม่', async () => {
    const teacher = await createTeacher();
    const exam = await createExam(teacher);
    const question = await examService.addQuestion(teacher, exam.id, {
      type: 'MULTIPLE_CHOICE',
      prompt: '1+1=?',
      points: 2,
      choices: [
        { label: 'A', text: '1', isCorrect: false },
        { label: 'B', text: '2', isCorrect: true },
      ],
    });
    assert.equal(question.choices.length, 2);
    assert.equal(question.order, 1);

    const stored = await prisma.exam.findUnique({ where: { id: exam.id } });
    assert.equal(Number(stored.totalsPoints), 2);
  });

  it('ข้อปรนัยต้องมีเฉลยเดียวและตัวเลือก ≥ 2', async () => {
    const teacher = await createTeacher();
    const exam = await createExam(teacher);
    await expectApiError(
      examService.addQuestion(teacher, exam.id, {
        type: 'MULTIPLE_CHOICE',
        prompt: 'x',
        points: 1,
        choices: [],
      }),
      400,
      /อย่างน้อย 2/,
    );
    await expectApiError(
      examService.addQuestion(teacher, exam.id, {
        type: 'MULTIPLE_CHOICE',
        prompt: 'x',
        points: 1,
        choices: [
          { label: 'A', text: 'a', isCorrect: true },
          { label: 'B', text: 'b', isCorrect: true },
        ],
      }),
      400,
      /1 ตัวเลือกเท่านั้น/,
    );
  });

  it('ลำดับข้อต่อจากข้อสุดท้ายอัตโนมัติ', async () => {
    const teacher = await createTeacher();
    const exam = await createExam(teacher);
    await addTextQuestion(exam, { order: 5 });
    const next = await examService.addQuestion(teacher, exam.id, {
      type: 'SHORT_ANSWER',
      prompt: 'x',
      points: 1,
    });
    assert.equal(next.order, 6);
  });

  it('แก้ข้อ: เปลี่ยนตัวเลือกทั้งหมด', async () => {
    const teacher = await createTeacher();
    const exam = await createExam(teacher);
    const question = await addChoiceQuestion(exam, { points: 2 });
    const updated = await examService.updateQuestion(teacher, exam.id, question.id, {
      choices: [
        { label: 'X', text: 'x', isCorrect: true },
        { label: 'Y', text: 'y', isCorrect: false },
      ],
    });
    assert.deepEqual(
      updated.choices.map((choice) => choice.label),
      ['X', 'Y'],
    );
  });

  it('ลบข้อและคิดคะแนนเต็มใหม่', async () => {
    const teacher = await createTeacher();
    const exam = await createExam(teacher);
    const first = await examService.addQuestion(teacher, exam.id, {
      type: 'SHORT_ANSWER',
      prompt: 'a',
      points: 3,
    });
    await examService.addQuestion(teacher, exam.id, { type: 'SHORT_ANSWER', prompt: 'b', points: 4 });
    await examService.deleteQuestion(teacher, exam.id, first.id);
    const stored = await prisma.exam.findUnique({ where: { id: exam.id } });
    assert.equal(Number(stored.totalsPoints), 4);
  });

  it('เพิ่มข้อแล้วคิดคะแนนใบที่ส่งแล้วใหม่ด้วย (recalculateExamTotals)', async () => {
    const teacher = await createTeacher();
    const classroom = await createClassroom(teacher);
    const student = await createStudent();
    await enroll(student, classroom);
    const { exam, mc } = await createPublishedExam(teacher, classroom);

    // ใบที่ส่งแล้ว ตอบปรนัยถูก 2 คะแนน
    const submission = await prisma.submission.create({
      data: { examId: exam.id, studentId: student.id, status: 'SUBMITTED', submittedAt: new Date() },
    });
    await prisma.answer.create({
      data: {
        submissionId: submission.id,
        questionId: mc.id,
        choiceId: mc.choices[0].id,
        isCorrect: true,
        autoGraded: true,
        awardedPoints: 2,
      },
    });

    // เพิ่มข้อใหม่ 3 คะแนน → คะแนนเต็มกลายเป็น 7 และใบเดิมถูกคำนวณใหม่ (2/7)
    await examService.addQuestion(teacher, exam.id, { type: 'SHORT_ANSWER', prompt: 'ใหม่', points: 3 });

    const stored = await prisma.submission.findUnique({ where: { id: submission.id } });
    assert.equal(Number(stored.totalScore), 2);
    assert.equal(Number(stored.percent), 28.57);
  });

  it('reorderQuestions ปฏิเสธข้อที่ไม่ได้อยู่ในชุด', async () => {
    const teacher = await createTeacher();
    const exam = await createExam(teacher);
    const other = await createExam(teacher);
    const question = await addTextQuestion(other);
    await expectApiError(
      examService.reorderQuestions(teacher, exam.id, [{ id: question.id, order: 1 }]),
      400,
      /ไม่ได้อยู่ในชุด/,
    );
  });

  it('reorderQuestions ตั้งลำดับใหม่ได้', async () => {
    const teacher = await createTeacher();
    const exam = await createExam(teacher);
    const a = await addTextQuestion(exam, { order: 1 });
    const b = await addTextQuestion(exam, { order: 2 });
    await examService.reorderQuestions(teacher, exam.id, [
      { id: a.id, order: 2 },
      { id: b.id, order: 1 },
    ]);
    const ordered = await prisma.question.findMany({ where: { examId: exam.id }, orderBy: { order: 'asc' } });
    assert.deepEqual(
      ordered.map((question) => question.id),
      [b.id, a.id],
    );
  });
});

describe('importQuestionsFromFile', () => {
  it('import สำเร็จ (all-or-nothing) และอัปเดตคะแนนเต็ม', async () => {
    const teacher = await createTeacher();
    const exam = await createExam(teacher);
    const buffer = Buffer.from(toCsvRows([Q_HEADER, mcRow], { bom: true }), 'utf8');

    const result = await examService.importQuestionsFromFile(
      teacher,
      exam.id,
      { buffer, filename: 'q.csv' },
      {},
    );
    assert.equal(result.imported, 1);
    assert.equal(result.incomingPoints, 2);
    assert.equal(result.totalsPoints, 2);
    assert.equal(await prisma.question.count({ where: { examId: exam.id } }), 1);
  });

  it('มีแถวผิด → ไม่นำเข้าสักข้อ + details ระบุแถว', async () => {
    const teacher = await createTeacher();
    const exam = await createExam(teacher);
    const buffer = Buffer.from(
      toCsvRows([Q_HEADER, mcRow, ['ปรนัย', '', '2', 'ก', 'ข', '', '', 'A', '', '']]),
      'utf8',
    );

    await expectApiError(
      examService.importQuestionsFromFile(teacher, exam.id, { buffer, filename: 'q.csv' }, {}),
      400,
      /ยังไม่นำเข้าข้อใดเลย/,
      /3\s+ต้องระบุโจทย์/,
    );
    assert.equal(await prisma.question.count(), 0);
  });

  it('dryRun สรุปผลโดยไม่บันทึก', async () => {
    const teacher = await createTeacher();
    const exam = await createExam(teacher);
    const buffer = Buffer.from(toCsvRows([Q_HEADER, mcRow], { bom: true }), 'utf8');

    const result = await examService.importQuestionsFromFile(
      teacher,
      exam.id,
      { buffer, filename: 'q.csv' },
      { dryRun: true },
    );
    assert.equal(result.dryRun, true);
    assert.equal(result.wouldImport, 1);
    assert.equal(result.preview.length, 1);
    assert.equal(await prisma.question.count(), 0);
  });

  it('นำเข้าได้เฉพาะชุด DRAFT', async () => {
    const teacher = await createTeacher();
    const classroom = await createClassroom(teacher);
    const { exam } = await createPublishedExam(teacher, classroom);
    const buffer = Buffer.from(toCsvRows([Q_HEADER, mcRow], { bom: true }), 'utf8');

    await expectApiError(
      examService.importQuestionsFromFile(teacher, exam.id, { buffer, filename: 'q.csv' }, {}),
      409,
      /DRAFT/,
    );
  });
});

describe('เกณฑ์ตัดเกรด (replaceCutoffs)', () => {
  it('แทนที่เกณฑ์และคิดเกรดของใบที่ส่งแล้วใหม่', async () => {
    const teacher = await createTeacher();
    const classroom = await createClassroom(teacher);
    const student = await createStudent();
    await enroll(student, classroom);
    const { exam, mc, text } = await createPublishedExam(teacher, classroom);

    // จำลองใบที่ตรวจครบแล้ว ได้ 4/4 = 100%
    const submission = await prisma.submission.create({
      data: { examId: exam.id, studentId: student.id, status: 'SUBMITTED', submittedAt: new Date() },
    });
    await prisma.answer.createMany({
      data: [
        {
          submissionId: submission.id,
          questionId: mc.id,
          choiceId: mc.choices[0].id,
          isCorrect: true,
          autoGraded: true,
          awardedPoints: 2,
        },
        {
          submissionId: submission.id,
          questionId: text.id,
          textAnswer: 'ตอบ',
          isCorrect: true,
          autoGraded: false,
          awardedPoints: 2,
        },
      ],
    });

    const cutoffs = await examService.replaceCutoffs(teacher, exam.id, [
      { grade: 'A', minPercent: 50 },
      { grade: 'F', minPercent: 0 },
    ]);
    assert.equal(cutoffs.length, 2);

    const updated = await prisma.submission.findUnique({ where: { id: submission.id } });
    assert.equal(Number(updated.percent), 100);
    assert.equal(updated.grade, 'A');
    assert.equal(updated.status, 'GRADED');
  });

  it('เกรดซ้ำ → 400', async () => {
    const teacher = await createTeacher();
    const exam = await createExam(teacher);
    await expectApiError(
      examService.replaceCutoffs(teacher, exam.id, [
        { grade: 'A', minPercent: 80 },
        { grade: 'A', minPercent: 50 },
      ]),
      400,
      /ซ้ำ/,
    );
  });
});

describe('assignClassroom / unassignClassroom', () => {
  it('มอบหมายซ้ำ → 409', async () => {
    const teacher = await createTeacher();
    const classroom = await createClassroom(teacher);
    const exam = await createExam(teacher);
    await examService.assignClassroom(teacher, exam.id, { classroomId: classroom.id });
    await expectApiError(
      examService.assignClassroom(teacher, exam.id, { classroomId: classroom.id }),
      409,
      /แล้ว/,
    );
  });

  it('unassign ที่ไม่มีอยู่ → 404', async () => {
    const teacher = await createTeacher();
    const exam = await createExam(teacher);
    await expectApiError(
      examService.unassignClassroom(teacher, exam.id, '11111111-1111-1111-1111-111111111111'),
      404,
    );
  });
});

describe('publishExam / closeExam', () => {
  it('ยังไม่มีข้อ หรือยังไม่มอบหมาย → 400', async () => {
    const teacher = await createTeacher();
    const classroom = await createClassroom(teacher);
    const exam = await createExam(teacher);
    await expectApiError(examService.publishExam(teacher, exam.id), 400, /ยังไม่มีข้อสอบ/);

    await addTextQuestion(exam);
    await expectApiError(examService.publishExam(teacher, exam.id), 400, /ยังไม่ได้มอบหมาย/);
    void classroom;
  });

  it('publish ใส่เกณฑ์มาตรฐานให้เมื่อยังไม่มี และตั้งสถานะ PUBLISHED', async () => {
    const teacher = await createTeacher();
    const classroom = await createClassroom(teacher);
    const exam = await createExam(teacher);
    await addTextQuestion(exam);
    await assignClassroom(exam, classroom);

    const published = await examService.publishExam(teacher, exam.id);
    assert.equal(published.status, 'PUBLISHED');
    assert.equal(await prisma.gradeCutoff.count({ where: { examId: exam.id } }), 8);
  });

  it('closeExam ตั้งสถานะ CLOSED', async () => {
    const teacher = await createTeacher();
    const classroom = await createClassroom(teacher);
    const { exam } = await createPublishedExam(teacher, classroom);
    const closed = await examService.closeExam(teacher, exam.id);
    assert.equal(closed.status, 'CLOSED');
  });
});

describe('ฝั่งนักเรียน (listStudentExams / getStudentExamDetail)', () => {
  async function setup() {
    const teacher = await createTeacher();
    const classroom = await createClassroom(teacher);
    const student = await createStudent();
    await enroll(student, classroom);
    const { exam, mc, text } = await createPublishedExam(teacher, classroom);
    return { teacher, classroom, student, exam, mc, text };
  }

  it('แสดงข้อสอบที่เปิดสอบและมอบหมายให้ห้องของนักเรียน', async () => {
    const { exam, student } = await setup();
    const { items: exams } = await examService.listStudentExams(student.id);
    assert.equal(exams.length, 1);
    assert.equal(exams[0].id, exam.id);
    assert.equal(exams[0].canStart, true);
    assert.equal(exams[0].mySubmission, null);
  });

  it('ไม่แสดงข้อสอบของห้องที่ไม่ได้อยู่', async () => {
    const teacher = await createTeacher();
    const classroom = await createClassroom(teacher);
    await createPublishedExam(teacher, classroom);
    const outsider = await createStudent();
    assert.deepEqual((await examService.listStudentExams(outsider.id)).items, []);
  });

  it('หลังส่งแล้ว canStart = false และยังไม่โชว์คะแนนจนกว่าจะปล่อยผล', async () => {
    const { exam, student } = await setup();
    await prisma.submission.create({
      data: {
        examId: exam.id,
        studentId: student.id,
        status: 'SUBMITTED',
        submittedAt: new Date(),
        totalScore: 2,
        percent: 50,
        grade: 'F',
      },
    });
    const [row] = (await examService.listStudentExams(student.id)).items;
    assert.equal(row.canStart, false);
    assert.equal(row.mySubmission.status, 'SUBMITTED');
    assert.equal('totalScore' in row.mySubmission, false);
  });

  it('หลังปล่อยผล โชว์คะแนนและเกรด', async () => {
    const { exam, student } = await setup();
    await prisma.submission.create({
      data: {
        examId: exam.id,
        studentId: student.id,
        status: 'RELEASED',
        submittedAt: new Date(),
        releasedAt: new Date(),
        totalScore: 3,
        percent: 75,
        grade: 'B+',
      },
    });
    const [row] = (await examService.listStudentExams(student.id)).items;
    assert.equal(row.mySubmission.totalScore, 3);
    assert.equal(row.mySubmission.grade, 'B+');
  });

  it('รายละเอียดข้อสอบสำหรับนักเรียน: ไม่มีเฉลย/คำอธิบาย', async () => {
    const { exam, student } = await setup();
    const detail = await examService.getStudentExamDetail(exam.id, student.id, { clientIp: '10.0.0.1' });
    assert.equal(detail.questions.length, 2);
    for (const question of detail.questions) {
      assert.equal('explanation' in question, false);
      assert.equal('referenceText' in question, false);
      assert.equal('points' in question, false);
      for (const choice of question.choices) assert.equal('isCorrect' in choice, false);
    }
  });

  it('ข้อสอบยังไม่เปิด → 403', async () => {
    const teacher = await createTeacher();
    const classroom = await createClassroom(teacher);
    const student = await createStudent();
    await enroll(student, classroom);
    const exam = await createExam(teacher, { status: 'DRAFT' });
    await assignClassroom(exam, classroom);
    await expectApiError(examService.getStudentExamDetail(exam.id, student.id), 403, /ยังไม่เปิด/);
  });

  it('ยังไม่ถึงเวลา/เลยเวลา → 403', async () => {
    const teacher = await createTeacher();
    const classroom = await createClassroom(teacher);
    const student = await createStudent();
    await enroll(student, classroom);
    const exam = await createExam(teacher, { status: 'PUBLISHED' });
    const assignment = await assignClassroom(exam, classroom);

    await prisma.examAssignment.update({
      where: { id: assignment.id },
      data: { availableFrom: new Date(Date.now() + 3_600_000) },
    });
    await expectApiError(examService.getStudentExamDetail(exam.id, student.id), 403, /ยังไม่ถึงเวลา/);

    await prisma.examAssignment.update({
      where: { id: assignment.id },
      data: { availableFrom: null, availableTo: new Date(Date.now() - 3_600_000) },
    });
    await expectApiError(examService.getStudentExamDetail(exam.id, student.id), 403, /เลยเวลา/);
  });

  it('จำกัด IP: เครื่องนอกช่วง → 403, ในช่วง → ผ่าน', async () => {
    const { exam, student, teacher } = await setup();
    await prisma.exam.update({ where: { id: exam.id }, data: { allowedIpRanges: ['203.0.113.0/24'] } });

    await expectApiError(
      examService.getStudentExamDetail(exam.id, student.id, { clientIp: '10.0.0.5' }),
      403,
      /จำกัด IP/,
    );
    const detail = await examService.getStudentExamDetail(exam.id, student.id, { clientIp: '203.0.113.9' });
    assert.equal(detail.id, exam.id);
    void teacher;
  });
});

describe('buildQuestionImportTemplateCsv', () => {
  it('มีหัวคอลัมน์ครบ', () => {
    const { filename, content } = examService.buildQuestionImportTemplateCsv();
    assert.equal(filename, 'exam-questions-template.csv');
    for (const header of Q_HEADER) assert.ok(content.includes(header), header);
  });
});
