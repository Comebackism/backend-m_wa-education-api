import { after, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { disconnectDatabase, prisma, resetDatabase } from '../helpers/db.js';
import {
  assignClassroom,
  createClassroom,
  createExam,
  createPublishedExam,
  createStudent,
  createTeacher,
  enroll,
} from '../helpers/fixtures.js';
import { expectApiError } from '../helpers/api-error.js';
import * as submissionService from '../../src/services/submission.service.js';

/** เทสต์การทำข้อสอบจริง: เริ่ม / บันทึกคำตอบ / ส่ง / ล็อกหลังส่ง / หมดเวลา */

beforeEach(resetDatabase);
after(disconnectDatabase);

const randomUuid = '11111111-1111-1111-1111-111111111111';

async function setup({ timeLimitMinutes = null, withText = true } = {}) {
  const teacher = await createTeacher();
  const classroom = await createClassroom(teacher);
  const student = await createStudent();
  await enroll(student, classroom);
  const { exam, mc, text } = await createPublishedExam(teacher, classroom, { withText });
  if (timeLimitMinutes !== null) {
    await prisma.exam.update({ where: { id: exam.id }, data: { timeLimitMinutes } });
  }
  return { teacher, classroom, student, exam, mc, text };
}

describe('startSubmission', () => {
  it('สร้างใบใหม่สถานะ IN_PROGRESS พร้อมเวลาหมดอายุ', async () => {
    const { student, exam } = await setup({ timeLimitMinutes: 30 });
    const submission = await submissionService.startSubmission(exam.id, student.id);
    assert.equal(submission.status, 'IN_PROGRESS');
    assert.ok(submission.expiresAt instanceof Date);
    assert.ok(submission.expiresAt.getTime() > Date.now());
    assert.equal('totalScore' in submission, false);
  });

  it('ไม่มี time limit → expiresAt เป็น null', async () => {
    const { student, exam } = await setup();
    const submission = await submissionService.startSubmission(exam.id, student.id);
    assert.equal(submission.expiresAt, null);
  });

  it('เริ่มซ้ำขณะยังทำอยู่ → คืนใบเดิม', async () => {
    const { student, exam } = await setup();
    const first = await submissionService.startSubmission(exam.id, student.id);
    const second = await submissionService.startSubmission(exam.id, student.id);
    assert.equal(second.id, first.id);
    assert.equal(await prisma.submission.count(), 1);
  });

  it('ส่งไปแล้ว → 409', async () => {
    const { student, exam } = await setup();
    const submission = await submissionService.startSubmission(exam.id, student.id);
    await submissionService.submitSubmission(submission.id, student.id);
    await expectApiError(submissionService.startSubmission(exam.id, student.id), 409, /ส่งข้อสอบชุดนี้แล้ว/);
  });

  it('ข้อสอบไม่มีข้อคำถาม → 400', async () => {
    const teacher = await createTeacher();
    const classroom = await createClassroom(teacher);
    const student = await createStudent();
    await enroll(student, classroom);
    const exam = await createExam(teacher, { status: 'PUBLISHED' });
    await assignClassroom(exam, classroom);

    await expectApiError(submissionService.startSubmission(exam.id, student.id), 400, /ยังไม่มีข้อคำถาม/);
  });

  it('นักเรียนนอกห้อง → 403', async () => {
    const { exam } = await setup();
    const outsider = await createStudent();
    await expectApiError(submissionService.startSubmission(exam.id, outsider.id), 403);
  });
});

describe('saveAnswers', () => {
  it('บันทึกคำตอบปรนัยและอัตนัยได้', async () => {
    const { student, exam, mc, text } = await setup();
    const submission = await submissionService.startSubmission(exam.id, student.id);

    const result = await submissionService.saveAnswers(submission.id, student.id, [
      { questionId: mc.id, choiceId: mc.choices[1].id },
      { questionId: text.id, textAnswer: 'คำตอบของฉัน' },
    ]);
    assert.equal(result.savedCount, 2);

    const stored = await prisma.answer.findMany({ where: { submissionId: submission.id } });
    assert.equal(stored.length, 2);
  });

  it('บันทึกทับคำตอบเดิมได้ (upsert)', async () => {
    const { student, exam, mc } = await setup();
    const submission = await submissionService.startSubmission(exam.id, student.id);
    await submissionService.saveAnswers(submission.id, student.id, [
      { questionId: mc.id, choiceId: mc.choices[1].id },
    ]);
    await submissionService.saveAnswers(submission.id, student.id, [
      { questionId: mc.id, choiceId: mc.choices[2].id },
    ]);

    const answers = await prisma.answer.findMany({ where: { submissionId: submission.id } });
    assert.equal(answers.length, 1);
    assert.equal(answers[0].choiceId, mc.choices[2].id);
  });

  it('ข้อที่ไม่มีในชุด → 400', async () => {
    const { student, exam } = await setup();
    const submission = await submissionService.startSubmission(exam.id, student.id);
    await expectApiError(
      submissionService.saveAnswers(submission.id, student.id, [{ questionId: randomUuid, choiceId: null }]),
      400,
      /ไม่พบข้อ/,
    );
  });

  it('ตัวเลือกไม่ตรงกับข้อ → 400', async () => {
    const { student, exam, mc } = await setup();
    const submission = await submissionService.startSubmission(exam.id, student.id);
    await expectApiError(
      submissionService.saveAnswers(submission.id, student.id, [{ questionId: mc.id, choiceId: randomUuid }]),
      400,
      /ไม่ตรงกับข้อนี้/,
    );
  });

  it('ส่ง choiceId ให้ข้ออัตนัย → 400', async () => {
    const { student, exam, text } = await setup();
    const submission = await submissionService.startSubmission(exam.id, student.id);
    await expectApiError(
      submissionService.saveAnswers(submission.id, student.id, [
        { questionId: text.id, choiceId: randomUuid },
      ]),
      400,
      /ไม่ต้องส่ง choiceId/,
    );
  });

  it('คำตอบยาวเกินกำหนด → 400', async () => {
    const { student, exam, text } = await setup();
    const submission = await submissionService.startSubmission(exam.id, student.id);
    await expectApiError(
      submissionService.saveAnswers(submission.id, student.id, [
        { questionId: text.id, textAnswer: 'ก'.repeat(20001) },
      ]),
      400,
      /ยาวเกินไป/,
    );
  });

  it('บันทึกหลังส่งแล้ว → 409', async () => {
    const { student, exam, mc } = await setup();
    const submission = await submissionService.startSubmission(exam.id, student.id);
    await submissionService.submitSubmission(submission.id, student.id);
    await expectApiError(
      submissionService.saveAnswers(submission.id, student.id, [
        { questionId: mc.id, choiceId: mc.choices[1].id },
      ]),
      409,
      /ถูกส่งไปแล้ว/,
    );
  });

  it('หมดเวลาแล้วบันทึกไม่ได้ → 409', async () => {
    const { student, exam, mc } = await setup();
    const submission = await submissionService.startSubmission(exam.id, student.id);
    await prisma.submission.update({
      where: { id: submission.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await expectApiError(
      submissionService.saveAnswers(submission.id, student.id, [
        { questionId: mc.id, choiceId: mc.choices[1].id },
      ]),
      409,
      /หมดเวลา/,
    );
  });

  it('คำตอบของนักเรียนคนอื่น → 403', async () => {
    const { student, exam, mc } = await setup();
    const submission = await submissionService.startSubmission(exam.id, student.id);
    const intruder = await createStudent();
    await expectApiError(
      submissionService.saveAnswers(submission.id, intruder.id, [
        { questionId: mc.id, choiceId: mc.choices[1].id },
      ]),
      403,
      /ไม่ใช่ของคุณ/,
    );
  });
});

describe('submitSubmission', () => {
  it('ตรวจปรนัยอัตโนมัติ และรอตรวจอัตนัย (SUBMITTED)', async () => {
    const { student, exam, mc } = await setup();
    const submission = await submissionService.startSubmission(exam.id, student.id);
    await submissionService.saveAnswers(submission.id, student.id, [
      { questionId: mc.id, choiceId: mc.choices[0].id },
    ]); // ถูก

    const result = await submissionService.submitSubmission(submission.id, student.id);
    assert.equal(result.status, 'SUBMITTED');

    const stored = await prisma.submission.findUnique({ where: { id: submission.id } });
    assert.equal(Number(stored.autoScore), 2);
    assert.equal(Number(stored.totalScore), 2);
    assert.equal(stored.status, 'SUBMITTED');

    // ข้อที่ไม่ได้ตอบก็มี record และปรนัยถูกตัดสินว่าผิด
    const answers = await prisma.answer.findMany({ where: { submissionId: submission.id } });
    assert.equal(answers.length, 2);
    assert.equal(answers.find((answer) => answer.isCorrect === null) !== undefined, true);
  });

  it('ตอบผิดปรนัย → 0 คะแนน', async () => {
    const { student, exam, mc } = await setup();
    const submission = await submissionService.startSubmission(exam.id, student.id);
    await submissionService.saveAnswers(submission.id, student.id, [
      { questionId: mc.id, choiceId: mc.choices[3].id },
    ]);
    await submissionService.submitSubmission(submission.id, student.id);
    const stored = await prisma.submission.findUnique({ where: { id: submission.id } });
    assert.equal(Number(stored.autoScore), 0);
  });

  it('ข้อสอบปรนัยล้วน → ตรวจครบเป็น GRADED ทันที', async () => {
    const { student, exam, mc } = await setup({ withText: false });
    const submission = await submissionService.startSubmission(exam.id, student.id);
    await submissionService.saveAnswers(submission.id, student.id, [
      { questionId: mc.id, choiceId: mc.choices[0].id },
    ]);

    const result = await submissionService.submitSubmission(submission.id, student.id);
    assert.equal(result.status, 'GRADED');
    const stored = await prisma.submission.findUnique({ where: { id: submission.id } });
    assert.equal(Number(stored.percent), 100);
    assert.equal(stored.grade, 'A');
  });

  it('หมดเวลาแล้วยังส่งได้ (ไม่เสียคำตอบที่ทำไว้)', async () => {
    const { student, exam } = await setup();
    const submission = await submissionService.startSubmission(exam.id, student.id);
    await prisma.submission.update({
      where: { id: submission.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const result = await submissionService.submitSubmission(submission.id, student.id);
    assert.equal(result.status, 'SUBMITTED');
  });

  it('ส่งซ้ำ → 409', async () => {
    const { student, exam } = await setup();
    const submission = await submissionService.startSubmission(exam.id, student.id);
    await submissionService.submitSubmission(submission.id, student.id);
    await expectApiError(submissionService.submitSubmission(submission.id, student.id), 409, /ถูกส่งไปแล้ว/);
  });

  it('ส่งใบของคนอื่น → 403', async () => {
    const { student, exam } = await setup();
    const submission = await submissionService.startSubmission(exam.id, student.id);
    await expectApiError(submissionService.submitSubmission(submission.id, (await createStudent()).id), 403);
  });
});

describe('getStudentSubmission', () => {
  it('คืนข้อมูลใบของตัวเองโดยไม่โชว์คะแนน', async () => {
    const { student, exam, mc } = await setup();
    const submission = await submissionService.startSubmission(exam.id, student.id);
    await submissionService.saveAnswers(submission.id, student.id, [
      { questionId: mc.id, choiceId: mc.choices[0].id },
    ]);
    await submissionService.submitSubmission(submission.id, student.id);

    const result = await submissionService.getStudentSubmission(student.id, submission.id);
    assert.equal(result.status, 'SUBMITTED');
    assert.equal('totalScore' in result, false);
    // submit สร้างคำตอบครบทุกข้อ (ข้อที่ไม่ได้ตอบมี record ว่าง)
    assert.equal(result.answers.length, 2);
    assert.ok(
      result.answers.some((answer) => answer.questionId === mc.id && answer.choiceId === mc.choices[0].id),
    );
    assert.ok(result.answers.every((answer) => !('isCorrect' in answer)));
  });

  it('ใบของคนอื่น → 403', async () => {
    const { student, exam } = await setup();
    const submission = await submissionService.startSubmission(exam.id, student.id);
    await expectApiError(
      submissionService.getStudentSubmission((await createStudent()).id, submission.id),
      403,
    );
  });
});
