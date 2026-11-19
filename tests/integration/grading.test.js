import { after, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { disconnectDatabase, prisma, resetDatabase } from '../helpers/db.js';
import {
  createClassroom,
  createPublishedExam,
  createStudent,
  createTeacher,
  enroll,
} from '../helpers/fixtures.js';
import { expectApiError } from '../helpers/api-error.js';
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
  await submissionService.saveAnswers(started.id, student.id, [{ questionId: mc.id, choiceId: mc.choices[0].id }]);
  await submissionService.submitSubmission(started.id, student.id);

  const submission = await prisma.submission.findUnique({ where: { id: started.id } });
  const textAnswer = await prisma.answer.findFirst({ where: { submissionId: submission.id, questionId: text.id } });
  const mcAnswer = await prisma.answer.findFirst({ where: { submissionId: submission.id, questionId: mc.id } });
  return { teacher, classroom, student, exam, mc, text, submission, textAnswer, mcAnswer };
}

describe('listExamSubmissions', () => {
  it('บอกจำนวนข้อที่ยังไม่ตรวจและ needsGrading', async () => {
    const { teacher, exam, student } = await setupSubmitted();
    const list = await gradingService.listExamSubmissions(teacher, exam.id);
    assert.equal(list.length, 1);
    assert.equal(list[0].ungradedCount, 1);
    assert.equal(list[0].needsGrading, true);
    assert.equal(list[0].student.id, student.id);
  });

  it('หลังตรวจครบ needsGrading = false', async () => {
    const { teacher, exam, textAnswer } = await setupSubmitted();
    await gradingService.gradeAnswer(teacher, textAnswer.id, { isCorrect: true, awardedPoints: 2 });

    const list = await gradingService.listExamSubmissions(teacher, exam.id);
    assert.equal(list[0].ungradedCount, 0);
    assert.equal(list[0].needsGrading, false);
  });

  it('กรองตามสถานะได้', async () => {
    const { teacher, exam } = await setupSubmitted();
    assert.equal((await gradingService.listExamSubmissions(teacher, exam.id, { status: 'SUBMITTED' })).length, 1);
    assert.equal((await gradingService.listExamSubmissions(teacher, exam.id, { status: 'RELEASED' })).length, 0);
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
    const detail = await gradingService.gradeAnswer(teacher, textAnswer.id, { isCorrect: true, awardedPoints: 2, graderComment: 'อธิบายครบ' });

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
    await expectApiError(gradingService.gradeAnswer(teacher, mcAnswer.id, { isCorrect: false }), 400, /ตรวจอัตโนมัติ/);
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

    await expectApiError(gradingService.gradeAnswer(teacher, textAnswer.id, { isCorrect: true }), 409, /ยังไม่ส่ง/);
  });

  it('ครูคนอื่นตรวจไม่ได้ → 403', async () => {
    const { textAnswer } = await setupSubmitted();
    await expectApiError(gradingService.gradeAnswer(await createTeacher(), textAnswer.id, { isCorrect: true }), 403);
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
    await submissionService.saveAnswers(startedA.id, a.id, [{ questionId: mc.id, choiceId: mc.choices[0].id }]);
    await submissionService.submitSubmission(startedA.id, a.id);
    const textAnswerA = await prisma.answer.findFirst({ where: { submissionId: startedA.id, questionId: text.id } });
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
});

describe('exportExamResultsCsv', () => {
  it('สร้าง CSV พร้อมหัวตารางและข้อมูลนักเรียน', async () => {
    const { teacher, exam, submission } = await setupSubmitted();
    await prisma.submission.update({ where: { id: submission.id }, data: { status: 'RELEASED', releasedAt: new Date() } });

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
});
