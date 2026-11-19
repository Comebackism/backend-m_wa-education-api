import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  decimalFields,
  serializeQuestion,
  serializeStudentSubmission,
  serializeTeacherSubmission,
  toNumber,
} from '../../src/lib/serialize.js';

/** เทสต์ตัวแปลงค่า Prisma → JSON และกฎ "ไม่รั่วคะแนน" ฝั่งนักเรียน */

describe('toNumber', () => {
  it('แปลงสตริงตัวเลขเป็น number', () => {
    assert.equal(toNumber('12.5'), 12.5);
    assert.equal(toNumber('0'), 0);
  });

  it('คืนค่าเดิมเมื่อเป็น number', () => {
    assert.equal(toNumber(3), 3);
  });

  it('คง null/undefined', () => {
    assert.equal(toNumber(null), null);
    assert.equal(toNumber(undefined), undefined);
  });

  it('คืนค่าเดิมเมื่อแปลงไม่ได้', () => {
    assert.equal(toNumber('abc'), 'abc');
  });

  it('สตริงว่างกลายเป็น 0 (พฤติกรรม Number())', () => {
    assert.equal(toNumber(''), 0);
  });
});

describe('decimalFields', () => {
  it('แปลงเฉพาะฟิลด์ที่กำหนดและมีอยู่จริง', () => {
    const result = decimalFields({ a: '1.5', b: 'x', c: 2 }, ['a', 'b', 'missing']);
    assert.deepEqual(result, { a: 1.5, b: 'x', c: 2 });
  });

  it('ไม่แก้ object ต้นฉบับ', () => {
    const source = { a: '1.5' };
    decimalFields(source, ['a']);
    assert.equal(source.a, '1.5');
  });
});

describe('serializeQuestion', () => {
  it('แปลง points และสำเนา choices', () => {
    const question = { id: 'q1', points: '2.5', choices: [{ id: 'c1', isCorrect: true }] };
    const result = serializeQuestion(question);
    assert.equal(result.points, 2.5);
    assert.deepEqual(result.choices, [{ id: 'c1', isCorrect: true }]);
    assert.notEqual(result.choices, question.choices);
  });

  it('ไม่มี choices → undefined', () => {
    assert.equal(serializeQuestion({ id: 'q1', points: 1 }).choices, undefined);
  });
});

describe('serializeTeacherSubmission', () => {
  it('แปลงฟิลด์คะแนนทั้งหมดเป็น number', () => {
    const result = serializeTeacherSubmission({
      id: 's1',
      autoScore: '2',
      manualScore: '3.5',
      totalScore: '5.5',
      percent: '55',
    });
    assert.deepEqual(result, { id: 's1', autoScore: 2, manualScore: 3.5, totalScore: 5.5, percent: 55 });
  });
});

describe('serializeStudentSubmission', () => {
  const base = {
    id: 's1',
    examId: 'e1',
    studentId: 'u1',
    status: 'SUBMITTED',
    displayMode: 'SINGLE_PAGE',
    startedAt: new Date('2026-01-01T00:00:00Z'),
    expiresAt: null,
    submittedAt: new Date('2026-01-01T01:00:00Z'),
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T01:00:00Z'),
    autoScore: '2',
    manualScore: '0',
    totalScore: '2',
    percent: '20',
    grade: 'F',
    gradedAt: new Date('2026-01-02T00:00:00Z'),
    releasedAt: null,
    answers: [{ questionId: 'q1', choiceId: 'c1', textAnswer: null, isCorrect: true, awardedPoints: 2 }],
  };

  it('null → null', () => {
    assert.equal(serializeStudentSubmission(null), null);
  });

  it('สถานะยังไม่ปล่อยผล → ซ่อนคะแนน/เกรด', () => {
    const result = serializeStudentSubmission(base);
    assert.equal(result.status, 'SUBMITTED');
    assert.equal('totalScore' in result, false);
    assert.equal('percent' in result, false);
    assert.equal('grade' in result, false);
    assert.equal('autoScore' in result, false);
  });

  it('คำตอบที่แนบมาไม่มีคะแนน/ผลตรวจรายข้อ', () => {
    const result = serializeStudentSubmission(base);
    assert.deepEqual(result.answers, [{ questionId: 'q1', choiceId: 'c1', textAnswer: null }]);
  });

  it('ใช้ whitelist: ฟิลด์ลับอื่นไม่หลุด', () => {
    const result = serializeStudentSubmission({ ...base, secret: 'x', gradedById: 'u9' });
    assert.equal('secret' in result, false);
    assert.equal('gradedById' in result, false);
  });

  it('สถานะ RELEASED → เห็นคะแนนและเกรด', () => {
    const result = serializeStudentSubmission({ ...base, status: 'RELEASED', releasedAt: new Date('2026-01-03T00:00:00Z') });
    assert.equal(result.totalScore, 2);
    assert.equal(result.percent, 20);
    assert.equal(result.grade, 'F');
    assert.equal(result.autoScore, 2);
    assert.ok(result.releasedAt instanceof Date);
  });

  it('ฟิลด์ที่ไม่มีในออบเจ็กต์จะไม่ถูกใส่', () => {
    const result = serializeStudentSubmission({ id: 's1', status: 'IN_PROGRESS' });
    assert.deepEqual(result, { id: 's1', status: 'IN_PROGRESS' });
  });
});
