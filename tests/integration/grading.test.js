import { after, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { disconnectDatabase, prisma, resetDatabase } from '../helpers/db.js';
import {
  addChoiceQuestion,
  createClassroom,
  createExam,
  createPublishedExam,
  createStudent,
  createSubmission,
  createTeacher,
  enroll,
} from '../helpers/fixtures.js';
import { expectApiError } from '../helpers/api-error.js';
import { recalculateExamSubmissions, recalculateSubmission } from '../../src/lib/grading.js';
import * as gradingService from '../../src/services/grading.service.js';
import * as submissionService from '../../src/services/submission.service.js';

/** เทสต์การตรวจข้อสอบจริง: รายการรอตรวจ / ตรวจอัตนัย / ปล่อยผล / สถิติ / ส่งออก CSV */

beforeEach(resetDatabase);
after(disconnectDatabase);

async function setupSubmitted() {
  const teacher = await createTeacher();
  const classroom = await createClassroom(teacher);
  const student = await createStudent();
  await enroll(student, classroom);
  const { exam, mc, text } = await createPublishedExam(teacher, classroom);

  const started = await submissionService.startSubmission(exam.id, student.id);
  await submissionService.saveAnswers(started.id, student.id, [
    { questionId: mc.id, choiceId: mc.choices[0].id },
  ]);
  await submissionService.submitSubmission(started.id, student.id);

  const submission = await prisma.submission.findUnique({ where: { id: started.id } });
  const textAnswer = await prisma.answer.findFirst({
    where: { submissionId: submission.id, questionId: text.id },
  });
  const mcAnswer = await prisma.answer.findFirst({
    where: { submissionId: submission.id, questionId: mc.id },
  });
  return { teacher, classroom, student, exam, mc, text, submission, textAnswer, mcAnswer };
}

describe('listExamSubmissions', () => {
  it('บอกจำนวนข้อที่ยังไม่ตรวจและ needsGrading', async () => {
    const { teacher, exam, student } = await setupSubmitted();
    const { items: list } = await gradingService.listExamSubmissions(teacher, exam.id);
    assert.equal(list.length, 1);
    assert.equal(list[0].ungradedCount, 1);
    assert.equal(list[0].needsGrading, true);
    assert.equal(list[0].student.id, student.id);
  });

  it('หลังตรวจครบ needsGrading = false', async () => {
    const { teacher, exam, textAnswer } = await setupSubmitted();
    await gradingService.gradeAnswer(teacher, textAnswer.id, { isCorrect: true, awardedPoints: 2 });

    const { items: list } = await gradingService.listExamSubmissions(teacher, exam.id);
    assert.equal(list[0].ungradedCount, 0);
    assert.equal(list[0].needsGrading, false);
  });

  it('กรองตามสถานะได้', async () => {
    const { teacher, exam } = await setupSubmitted();
    assert.equal(
      (await gradingService.listExamSubmissions(teacher, exam.id, { status: 'SUBMITTED' })).items.length,
      1,
    );
    assert.equal(
      (await gradingService.listExamSubmissions(teacher, exam.id, { status: 'RELEASED' })).items.length,
      0,
    );
  });

  it('ครูคนอื่นดูไม่ได้ → 403', async () => {
    const { exam } = await setupSubmitted();
    await expectApiError(gradingService.listExamSubmissions(await createTeacher(), exam.id), 403);
  });
});

describe('getSubmissionDetail', () => {
  it('แนบเฉลย/คำตอบ/คะแนน ให้ครูปรับ', async () => {
    const { teacher, submission, mc, text } = await setupSubmitted();
    const detail = await gradingService.getSubmissionDetail(teacher, submission.id);

    assert.equal(detail.answers.length, 2);
    const mcAnswer = detail.answers.find((answer) => answer.questionId === mc.id);
    assert.equal(mcAnswer.type, 'MULTIPLE_CHOICE');
    assert.equal(mcAnswer.isCorrect, true);
    assert.equal(mcAnswer.autoGraded, true);
    assert.ok(mcAnswer.correctChoiceId);

    const textAnswer = detail.answers.find((answer) => answer.questionId === text.id);
    assert.equal(textAnswer.isCorrect, null);
    assert.equal(textAnswer.referenceText, 'แนวคำตอบ');
    assert.equal(detail.ungradedCount, 1);
  });

  it('ไม่ใช่ใบของครูคนนี้ → 403', async () => {
    const { submission } = await setupSubmitted();
    await expectApiError(gradingService.getSubmissionDetail(await createTeacher(), submission.id), 403);
  });
});

describe('gradeAnswer', () => {
  it('ตรวจอัตนัยถูก → ได้คะแนนเต็ม และสถานะเป็น GRADED', async () => {
    const { teacher, submission, textAnswer } = await setupSubmitted();
    const detail = await gradingService.gradeAnswer(teacher, textAnswer.id, {
      isCorrect: true,
      awardedPoints: 2,
      graderComment: 'อธิบายครบ',
    });

    assert.equal(detail.status, 'GRADED');
    assert.equal(Number(detail.autoScore), 2);
    assert.equal(Number(detail.manualScore), 2);
    assert.equal(Number(detail.totalScore), 4);
    assert.equal(Number(detail.percent), 100);
    assert.equal(detail.grade, 'A');

    const stored = await prisma.submission.findUnique({ where: { id: submission.id } });
    assert.equal(stored.gradedAt instanceof Date, true);
  });

  it('ไม่ใส่ awardedPoints → ใช้คะแนนเต็มถ้าถูก / 0 ถ้าผิด', async () => {
    const { teacher, textAnswer } = await setupSubmitted();
    const detail = await gradingService.gradeAnswer(teacher, textAnswer.id, { isCorrect: false });
    const graded = detail.answers.find((answer) => answer.questionId === textAnswer.questionId);
    assert.equal(graded.awardedPoints, 0);
    assert.equal(graded.graderComment, null);
  });

  it('คะแนนเกินเต็ม → 400', async () => {
    const { teacher, textAnswer } = await setupSubmitted();
    await expectApiError(
      gradingService.gradeAnswer(teacher, textAnswer.id, { isCorrect: true, awardedPoints: 99 }),
      400,
      /ต้องอยู่ระหว่าง/,
    );
  });

  it('ตรวจข้อปรนัย → 400', async () => {
    const { teacher, mcAnswer } = await setupSubmitted();
    await expectApiError(
      gradingService.gradeAnswer(teacher, mcAnswer.id, { isCorrect: false }),
      400,
      /ตรวจอัตโนมัติ/,
    );
  });

  it('นักเรียนยังไม่ส่ง → 409', async () => {
    const teacher = await createTeacher();
    const classroom = await createClassroom(teacher);
    const student = await createStudent();
    await enroll(student, classroom);
    const { exam, text } = await createPublishedExam(teacher, classroom);
    const started = await submissionService.startSubmission(exam.id, student.id);
    const textAnswer = await prisma.answer.create({
      data: { submissionId: started.id, questionId: text.id, textAnswer: 'ร่าง' },
    });

    await expectApiError(
      gradingService.gradeAnswer(teacher, textAnswer.id, { isCorrect: true }),
      409,
      /ยังไม่ส่ง/,
    );
  });

  it('ครูคนอื่นตรวจไม่ได้ → 403', async () => {
    const { textAnswer } = await setupSubmitted();
    await expectApiError(
      gradingService.gradeAnswer(await createTeacher(), textAnswer.id, { isCorrect: true }),
      403,
    );
  });

  it('ไม่พบคำตอบ → 404', async () => {
    const teacher = await createTeacher();
    await expectApiError(
      gradingService.gradeAnswer(teacher, '11111111-1111-1111-1111-111111111111', { isCorrect: true }),
      404,
    );
  });
});

describe('releaseSubmission', () => {
  it('ยังตรวจไม่ครบ → 422', async () => {
    const { teacher, submission } = await setupSubmitted();
    await expectApiError(gradingService.releaseSubmission(teacher, submission.id), 422, /ยังตรวจไม่ครบ/);
  });

  it('ตรวจครบแล้วปล่อยผลได้ → RELEASED', async () => {
    const { teacher, submission, textAnswer } = await setupSubmitted();
    await gradingService.gradeAnswer(teacher, textAnswer.id, { isCorrect: true, awardedPoints: 2 });

    const released = await gradingService.releaseSubmission(teacher, submission.id);
    assert.equal(released.status, 'RELEASED');
    assert.ok(released.releasedAt instanceof Date);
  });

  it('นักเรียนยังไม่ส่ง → 409', async () => {
    const teacher = await createTeacher();
    const classroom = await createClassroom(teacher);
    const student = await createStudent();
    await enroll(student, classroom);
    const { exam } = await createPublishedExam(teacher, classroom);
    const started = await submissionService.startSubmission(exam.id, student.id);
    await expectApiError(gradingService.releaseSubmission(teacher, started.id), 409, /ยังไม่ส่ง/);
  });
});

describe('releaseExamResults', () => {
  it('ปล่อยเฉพาะคนที่ตรวจครบ และรายงานจำนวนที่ข้าม', async () => {
    const teacher = await createTeacher();
    const classroom = await createClassroom(teacher);
    const { exam, mc, text } = await createPublishedExam(teacher, classroom);

    // นักเรียน A ตรวจครบแล้ว
    const a = await createStudent();
    await enroll(a, classroom);
    const startedA = await submissionService.startSubmission(exam.id, a.id);
    await submissionService.saveAnswers(startedA.id, a.id, [
      { questionId: mc.id, choiceId: mc.choices[0].id },
    ]);
    await submissionService.submitSubmission(startedA.id, a.id);
    const textAnswerA = await prisma.answer.findFirst({
      where: { submissionId: startedA.id, questionId: text.id },
    });
    await gradingService.gradeAnswer(teacher, textAnswerA.id, { isCorrect: true, awardedPoints: 2 });

    // นักเรียน B ยังไม่ได้ตรวจอัตนัย
    const b = await createStudent();
    await enroll(b, classroom);
    const startedB = await submissionService.startSubmission(exam.id, b.id);
    await submissionService.submitSubmission(startedB.id, b.id);

    const result = await gradingService.releaseExamResults(teacher, exam.id);
    assert.equal(result.released, 1);
    assert.equal(result.skipped, 1);

    const released = await prisma.submission.findUnique({ where: { id: startedA.id } });
    assert.equal(released.status, 'RELEASED');
    const pending = await prisma.submission.findUnique({ where: { id: startedB.id } });
    assert.equal(pending.status, 'SUBMITTED');
  });
});

describe('getExamStats', () => {
  it('สรุปจำนวน/คะแนน/เกรด และอัตราตอบถูกต่อข้อ', async () => {
    const { teacher, exam, textAnswer } = await setupSubmitted();
    await gradingService.gradeAnswer(teacher, textAnswer.id, { isCorrect: true, awardedPoints: 2 });

    const stats = await gradingService.getExamStats(teacher, exam.id);
    assert.equal(stats.summary.submissions, 1);
    assert.equal(stats.summary.graded, 1);
    assert.equal(stats.summary.needsGrading, 0);
    assert.equal(stats.scores.scoredCount, 1);
    assert.equal(stats.scores.averagePercent, 100);
    assert.equal(stats.scores.highest, 4);
    assert.equal(stats.gradeDistribution.find((row) => row.grade === 'A').count, 1);
    assert.equal(stats.questions.length, 2);
    const mc = stats.questions.find((question) => question.type === 'MULTIPLE_CHOICE');
    assert.equal(mc.correctCount, 1);
    assert.equal(mc.correctRate, 100);
  });

  it('มีใบกำลังทำ + คำตอบที่ชี้ข้อของชุดอื่น → นับถูกและไม่พัง', async () => {
    const { teacher, exam, student } = await setupSubmitted();

    const other = await createStudent({ fullName: 'กำลังทำ' });
    await createSubmission(exam, other, { status: 'IN_PROGRESS' });

    // จำลอง "ข้อถูกลบหลังส่ง" — คำตอบชี้ไปยังข้อที่ไม่อยู่ในชุดนี้
    const otherExam = await createExam(teacher);
    const orphan = await prisma.question.create({
      data: { examId: otherExam.id, type: 'SHORT_ANSWER', prompt: 'orphan', points: 1, order: 1 },
    });
    const target = await prisma.submission.findUnique({
      where: { examId_studentId: { examId: exam.id, studentId: student.id } },
    });
    await prisma.answer.create({
      data: { submissionId: target.id, questionId: orphan.id, choiceId: null, textAnswer: 'x' },
    });

    const stats = await gradingService.getExamStats(teacher, exam.id);
    assert.equal(stats.summary.inProgress, 1);
    assert.equal(stats.questions.length, 2);
    assert.equal(stats.scores.highest, 0);
  });
});

describe('exportExamResultsCsv', () => {
  it('สร้าง CSV พร้อมหัวตารางและข้อมูลนักเรียน', async () => {
    const { teacher, exam, submission } = await setupSubmitted();
    await prisma.submission.update({
      where: { id: submission.id },
      data: { status: 'RELEASED', releasedAt: new Date() },
    });

    const result = await gradingService.exportExamResultsCsv(teacher, exam.id);
    assert.equal(result.filename, `exam-results-${exam.id}.csv`);
    assert.equal(result.count, 1);
    assert.equal(result.content.charCodeAt(0), 0xfeff); // BOM
    assert.ok(result.content.includes('ปล่อยผลแล้ว'));
    assert.ok(result.content.includes('เกรด'));
  });

  it('กรองตามสถานะได้', async () => {
    const { teacher, exam } = await setupSubmitted();
    const releasedOnly = await gradingService.exportExamResultsCsv(teacher, exam.id, { status: 'RELEASED' });
    assert.equal(releasedOnly.count, 0);
  });

  it('ใบที่ยังทำอยู่ (IN_PROGRESS) → ช่องคะแนน/วันที่เว้นว่าง', async () => {
    const { teacher, exam } = await setupSubmitted();
    const inProgress = await createStudent({ fullName: 'ยังไม่ส่ง' });
    await createSubmission(exam, inProgress, { status: 'IN_PROGRESS' });

    const result = await gradingService.exportExamResultsCsv(teacher, exam.id);
    assert.equal(result.count, 2);
    assert.ok(result.content.includes('กำลังทำ'));
  });
});

describe('recalculateSubmission', () => {
  it('ไม่พบใบส่ง → 404', async () => {
    await expectApiError(recalculateSubmission('11111111-1111-1111-1111-111111111111'), 404);
  });

  it('ข้อสอบที่ยังไม่มีข้อคำถาม → คะแนนเต็ม 0 และเปอร์เซ็นต์ 0', async () => {
    const teacher = await createTeacher();
    const exam = await createExam(teacher);
    const student = await createStudent();
    const submission = await createSubmission(exam, student, {
      status: 'SUBMITTED',
      submittedAt: new Date(),
    });

    const updated = await recalculateSubmission(submission.id);
    assert.equal(Number(updated.percent), 0);
    assert.equal(Number(updated.totalScore), 0);
    assert.equal(updated.grade, null);
  });

  it('ใบที่ปล่อยผลแล้ว → คงสถานะ RELEASED ไว้', async () => {
    const { exam, student } = await setupSubmitted();
    const released = await prisma.submission.update({
      where: { examId_studentId: { examId: exam.id, studentId: student.id } },
      data: { status: 'RELEASED', releasedAt: new Date() },
    });

    const updated = await recalculateSubmission(released.id);
    assert.equal(updated.status, 'RELEASED');
  });

  it('รับ tx → คิดคะแนนในทรานแซกชันเดียวกับผู้เรียก', async () => {
    const { submission, textAnswer } = await setupSubmitted();
    await prisma.answer.update({
      where: { id: textAnswer.id },
      data: { isCorrect: true, awardedPoints: 2 },
    });

    const updated = await prisma.$transaction((tx) => recalculateSubmission(submission.id, { tx }));
    assert.equal(updated.status, 'GRADED');
    assert.equal(Number(updated.totalScore), 4);
  });
});

describe('recalculateExamSubmissions', () => {
  it('คิดคะแนนทุกใบที่ส่งแล้ว + ตั้ง gradedAt เมื่อตรวจครบ', async () => {
    const { exam, textAnswer } = await setupSubmitted();
    await prisma.answer.update({
      where: { id: textAnswer.id },
      data: { isCorrect: true, awardedPoints: 2 },
    });

    const results = await recalculateExamSubmissions(exam.id);
    assert.equal(results.length, 1);
    assert.equal(results[0].status, 'GRADED');
    assert.equal(results[0].totalScore, 4);

    const stored = await prisma.submission.findUnique({ where: { id: results[0].id } });
    assert.equal(stored.status, 'GRADED');
    assert.equal(Number(stored.totalScore), 4);
    assert.equal(Number(stored.percent), 100);
    assert.equal(stored.grade, 'A');
    assert.equal(stored.gradedAt instanceof Date, true);
  });

  it('ไม่ส่ง submissionIds → ข้ามใบที่ยังทำอยู่ (IN_PROGRESS)', async () => {
    const { exam, submission } = await setupSubmitted();
    const other = await createStudent({ fullName: 'ยังทำอยู่' });
    await createSubmission(exam, other, { status: 'IN_PROGRESS' });

    const results = await recalculateExamSubmissions(exam.id);
    assert.equal(results.length, 1);
    assert.equal(results[0].id, submission.id);
    assert.equal(results[0].status, 'SUBMITTED');
    assert.equal(results[0].autoScore, 2);
    assert.equal(results[0].manualScore, 0);
  });

  it('คละสถานะในชุดเดียว → คง RELEASED / ตั้ง GRADED / คง SUBMITTED ตามการตรวจของแต่ละใบ', async () => {
    const { classroom, exam, mc, text, submission } = await setupSubmitted();
    // ใบของ setupSubmitted ยังไม่ตรวจอัตนัย → ต้องคง SUBMITTED

    const gradedStudent = await createStudent({ fullName: 'ตรวจครบแล้ว' });
    await enroll(gradedStudent, classroom);
    const graded = await createSubmission(exam, gradedStudent, {
      status: 'SUBMITTED',
      submittedAt: new Date(),
    });
    await prisma.answer.createMany({
      data: [
        {
          submissionId: graded.id,
          questionId: mc.id,
          choiceId: mc.choices[0].id,
          isCorrect: true,
          autoGraded: true,
          awardedPoints: 2,
        },
        {
          submissionId: graded.id,
          questionId: text.id,
          textAnswer: 'ตอบถูก',
          isCorrect: true,
          autoGraded: false,
          awardedPoints: 2,
        },
      ],
    });

    const releasedStudent = await createStudent({ fullName: 'ปล่อยผลแล้ว' });
    await enroll(releasedStudent, classroom);
    const released = await createSubmission(exam, releasedStudent, {
      status: 'RELEASED',
      submittedAt: new Date(),
      releasedAt: new Date(),
    });
    await prisma.answer.createMany({
      data: [
        {
          submissionId: released.id,
          questionId: mc.id,
          choiceId: mc.choices[0].id,
          isCorrect: true,
          autoGraded: true,
          awardedPoints: 2,
        },
        {
          submissionId: released.id,
          questionId: text.id,
          textAnswer: 'ตอบถูก',
          isCorrect: true,
          autoGraded: false,
          awardedPoints: 2,
        },
      ],
    });

    const results = await recalculateExamSubmissions(exam.id);
    const byId = new Map(results.map((row) => [row.id, row]));

    assert.equal(results.length, 3);
    assert.equal(byId.get(submission.id).status, 'SUBMITTED');
    assert.equal(byId.get(graded.id).status, 'GRADED');
    assert.equal(byId.get(graded.id).manualScore, 2);
    assert.equal(byId.get(released.id).status, 'RELEASED');
    assert.equal(byId.get(released.id).totalScore, 4);
  });

  it('ส่ง submissionIds → จำกัดเฉพาะใบที่ระบุ', async () => {
    const teacher = await createTeacher();
    const classroom = await createClassroom(teacher);
    const { exam, mc } = await createPublishedExam(teacher, classroom, { withText: false });

    const a = await createStudent();
    await enroll(a, classroom);
    const startedA = await submissionService.startSubmission(exam.id, a.id);
    await submissionService.saveAnswers(startedA.id, a.id, [
      { questionId: mc.id, choiceId: mc.choices[0].id },
    ]);
    await submissionService.submitSubmission(startedA.id, a.id);

    const b = await createStudent();
    await enroll(b, classroom);
    const startedB = await submissionService.startSubmission(exam.id, b.id);
    await submissionService.submitSubmission(startedB.id, b.id);

    const results = await recalculateExamSubmissions(exam.id, { submissionIds: [startedA.id] });
    assert.equal(results.length, 1);
    assert.equal(results[0].id, startedA.id);
  });

  it('submissionIds เป็นอาร์เรย์ว่าง → ไม่แตะใครเลย', async () => {
    const { exam } = await setupSubmitted();
    const results = await recalculateExamSubmissions(exam.id, { submissionIds: [] });
    assert.deepEqual(results, []);
  });

  it('ไม่มีใบที่ส่งแล้ว → คืนอาร์เรย์ว่าง', async () => {
    const teacher = await createTeacher();
    const exam = await createExam(teacher);
    const results = await recalculateExamSubmissions(exam.id);
    assert.deepEqual(results, []);
  });

  it('ส่ง totalPoints มาเอง → ใช้ค่านั้นคิดเปอร์เซ็นต์', async () => {
    const { exam, textAnswer } = await setupSubmitted();
    await prisma.answer.update({
      where: { id: textAnswer.id },
      data: { isCorrect: true, awardedPoints: 2 },
    });

    const results = await recalculateExamSubmissions(exam.id, { totalPoints: 8 });
    assert.equal(results[0].percent, 50);
  });

  it('ใบที่ไม่มีคำตอบเลย → คะแนน 0 และถือว่าตรวจครบ', async () => {
    const teacher = await createTeacher();
    const classroom = await createClassroom(teacher);
    const { exam } = await createPublishedExam(teacher, classroom);
    const student = await createStudent();
    await createSubmission(exam, student, { status: 'SUBMITTED', submittedAt: new Date() });

    const results = await recalculateExamSubmissions(exam.id);
    assert.equal(results.length, 1);
    assert.equal(results[0].totalScore, 0);
    assert.equal(results[0].status, 'GRADED');
  });

  it('ไม่มีเกณฑ์ตัดเกรด → เกรดเป็น null', async () => {
    const teacher = await createTeacher();
    const exam = await createExam(teacher);
    const question = await addChoiceQuestion(exam, { points: 2 });
    const student = await createStudent();
    const submission = await createSubmission(exam, student, {
      status: 'SUBMITTED',
      submittedAt: new Date(),
    });
    await prisma.answer.create({
      data: {
        submissionId: submission.id,
        questionId: question.id,
        choiceId: question.choices[0].id,
        isCorrect: true,
        autoGraded: true,
        awardedPoints: 2,
      },
    });

    const results = await recalculateExamSubmissions(exam.id);
    assert.equal(results[0].grade, null);
    assert.equal(results[0].status, 'GRADED');
  });

  it('ใบที่ปล่อยผลแล้ว → คงสถานะ RELEASED', async () => {
    const { exam, student } = await setupSubmitted();
    await prisma.submission.update({
      where: { examId_studentId: { examId: exam.id, studentId: student.id } },
      data: { status: 'RELEASED', releasedAt: new Date() },
    });

    const results = await recalculateExamSubmissions(exam.id);
    assert.equal(results[0].status, 'RELEASED');
  });

  it('gradedAt เดิมคงอยู่ ไม่ถูกเขียนทับ', async () => {
    const { exam, submission, textAnswer } = await setupSubmitted();
    const past = new Date('2020-01-01T00:00:00.000Z');
    await prisma.answer.update({
      where: { id: textAnswer.id },
      data: { isCorrect: true, awardedPoints: 2 },
    });
    await prisma.submission.update({ where: { id: submission.id }, data: { gradedAt: past } });

    await recalculateExamSubmissions(exam.id);
    const stored = await prisma.submission.findUnique({ where: { id: submission.id } });
    assert.equal(stored.gradedAt.getTime(), past.getTime());
  });

  it('รับ tx → อัปเดตภายในทรานแซกชันเดียวกับผู้เรียก', async () => {
    const { exam, textAnswer } = await setupSubmitted();
    await prisma.answer.update({
      where: { id: textAnswer.id },
      data: { isCorrect: true, awardedPoints: 2 },
    });

    const results = await prisma.$transaction((tx) => recalculateExamSubmissions(exam.id, { tx }));
    assert.equal(results.length, 1);
    const stored = await prisma.submission.findUnique({ where: { id: results[0].id } });
    assert.equal(stored.status, 'GRADED');
  });
});
