import { after, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { disconnectDatabase, prisma, resetDatabase } from '../helpers/db.js';
import {
  addTextQuestion,
  createClassroom,
  createPublishedExam,
  createStudent,
  createTeacher,
  enroll,
} from '../helpers/fixtures.js';
import { expectApiError } from '../helpers/api-error.js';
import * as gradingService from '../../src/services/grading.service.js';
import * as resultService from '../../src/services/result.service.js';
import * as submissionService from '../../src/services/submission.service.js';

/** เทสต์การดูผลสอบฝั่งนักเรียน — กฎ "ห้ามรั่วคะแนน/เฉลยก่อนปล่อยผล" */

beforeEach(resetDatabase);
after(disconnectDatabase);

describe('listStudentResults', () => {
  it('ไม่รวมใบที่ยังทำอยู่ และซ่อนคะแนนจนกว่าจะปล่อยผล', async () => {
    const teacher = await createTeacher();
    const classroom = await createClassroom(teacher);
    const student = await createStudent();
    await enroll(student, classroom);
    const { exam, mc, text } = await createPublishedExam(teacher, classroom);

    // ใบที่ยังทำอยู่ → ต้องไม่โผล่
    await prisma.submission.create({
      data: { examId: exam.id, studentId: student.id, status: 'IN_PROGRESS' },
    });
    assert.deepEqual((await resultService.listStudentResults(student.id)).items, []);
    void mc;
    void text;
  });

  it('ใบที่ส่งแล้วแต่ยังไม่ปล่อย → pendingTeacherAction = true และไม่มีคะแนน', async () => {
    const teacher = await createTeacher();
    const classroom = await createClassroom(teacher);
    const student = await createStudent();
    await enroll(student, classroom);
    const { exam } = await createPublishedExam(teacher, classroom);
    await prisma.submission.create({
      data: {
        examId: exam.id,
        studentId: student.id,
        status: 'SUBMITTED',
        submittedAt: new Date(),
        totalScore: 2,
        percent: 50,
        grade: 'D',
      },
    });

    const [row] = (await resultService.listStudentResults(student.id)).items;
    assert.equal(row.pendingTeacherAction, true);
    assert.equal('totalScore' in row, false);
    assert.equal('grade' in row, false);
  });

  it('ใบที่ปล่อยผลแล้ว → เห็นคะแนนครบ', async () => {
    const teacher = await createTeacher();
    const classroom = await createClassroom(teacher);
    const student = await createStudent();
    await enroll(student, classroom);
    const { exam } = await createPublishedExam(teacher, classroom);
    await prisma.submission.create({
      data: {
        examId: exam.id,
        studentId: student.id,
        status: 'RELEASED',
        submittedAt: new Date(),
        releasedAt: new Date(),
        autoScore: 2,
        manualScore: 2,
        totalScore: 4,
        percent: 100,
        grade: 'A',
      },
    });

    const [row] = (await resultService.listStudentResults(student.id)).items;
    assert.equal(row.pendingTeacherAction, false);
    assert.equal(row.totalScore, 4);
    assert.equal(row.percent, 100);
    assert.equal(row.grade, 'A');
    assert.equal(row.totalPoints, 4);
  });

  it('กรองตาม examId ได้', async () => {
    const teacher = await createTeacher();
    const classroom = await createClassroom(teacher);
    const student = await createStudent();
    await enroll(student, classroom);
    const first = await createPublishedExam(teacher, classroom);
    const second = await createPublishedExam(teacher, classroom);
    await prisma.submission.create({
      data: {
        examId: first.exam.id,
        studentId: student.id,
        status: 'RELEASED',
        submittedAt: new Date(),
        releasedAt: new Date(),
        totalScore: 1,
        percent: 25,
        grade: 'F',
      },
    });

    const filtered = await resultService.listStudentResults(student.id, { examId: second.exam.id });
    assert.deepEqual(filtered.items, []);
  });
});

describe('getStudentResult', () => {
  async function releasedSetup() {
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
    const textAnswer = await prisma.answer.findFirst({
      where: { submissionId: started.id, questionId: text.id },
    });
    await gradingService.gradeAnswer(teacher, textAnswer.id, {
      isCorrect: true,
      awardedPoints: 2,
      graderComment: 'ดีมาก',
    });
    await gradingService.releaseSubmission(teacher, started.id);

    return { teacher, student, exam, mc, text, submissionId: started.id };
  }

  it('เห็นคะแนน เฉลย อธิบาย และหมายเหตุครู หลังปล่อยผล', async () => {
    const { student, submissionId, mc } = await releasedSetup();
    const result = await resultService.getStudentResult(student.id, submissionId);

    assert.equal(result.status, 'RELEASED');
    assert.equal(result.summary.totalScore, 4);
    assert.equal(result.summary.grade, 'A');
    assert.equal(result.exam.cutoffs.length, 8);

    const mcResult = result.questions.find((question) => question.questionId === mc.id);
    assert.ok(mcResult);
    assert.equal(mcResult.result.isCorrect, true);
    assert.ok(mcResult.choices.some((choice) => choice.isCorrect));
    assert.equal(mcResult.result.autoGraded, true);

    const textResult = result.questions.find((question) => question.type === 'SHORT_ANSWER');
    assert.equal(textResult.result.teacherComment, 'ดีมาก');
    assert.equal(textResult.referenceText, 'แนวคำตอบ');
  });

  it('ยังไม่ปล่อยผล → 403 (กันคะแนนรั่ว)', async () => {
    const teacher = await createTeacher();
    const classroom = await createClassroom(teacher);
    const student = await createStudent();
    await enroll(student, classroom);
    const { exam } = await createPublishedExam(teacher, classroom);
    const submission = await prisma.submission.create({
      data: { examId: exam.id, studentId: student.id, status: 'GRADED', submittedAt: new Date() },
    });

    await expectApiError(resultService.getStudentResult(student.id, submission.id), 403, /ยังไม่ถูกปล่อย/);
  });

  it('ผลสอบของคนอื่น → 403', async () => {
    const { submissionId } = await releasedSetup();
    await expectApiError(
      resultService.getStudentResult((await createStudent()).id, submissionId),
      403,
      /ไม่ใช่ของคุณ/,
    );
  });

  it('ไม่พบผลสอบ → 404', async () => {
    await expectApiError(
      resultService.getStudentResult(
        '11111111-1111-1111-1111-111111111111',
        '11111111-1111-1111-1111-111111111111',
      ),
      404,
    );
  });

  it('ข้อที่เพิ่มหลังส่ง (ไม่มีคำตอบ) → myAnswer/ผล เป็นค่าว่าง ไม่พัง', async () => {
    const { exam, student, submissionId } = await releasedSetup();
    await addTextQuestion(exam, { prompt: 'เพิ่มทีหลัง', order: 99 });

    const result = await resultService.getStudentResult(student.id, submissionId);
    const extra = result.questions.find((question) => question.prompt === 'เพิ่มทีหลัง');
    assert.ok(extra);
    assert.equal(extra.myAnswer.choiceId, null);
    assert.equal(extra.myAnswer.textAnswer, null);
    assert.equal(extra.result.isCorrect, null);
    assert.equal(extra.result.awardedPoints, undefined);
    assert.equal(extra.result.autoGraded, false);
    assert.equal(extra.result.teacherComment, null);
  });
});
