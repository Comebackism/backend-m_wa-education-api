import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { autoGradeAnswer, resolveGrade, round2 } from '../../src/lib/grading.js';
import { disconnectDatabase } from '../helpers/db.js';

/**
 * เทสต์ฟังก์ชันคิดเกรด/คะแนน (ไม่แตะ DB — แต่โมดูลนี้ import prisma จึงต้องปิด pool ท้ายไฟล์)
 */

after(disconnectDatabase);

describe('resolveGrade', () => {
  const cutoffs = [
    { grade: 'A', minPercent: 80 },
    { grade: 'B', minPercent: 70 },
    { grade: 'C', minPercent: 60 },
    { grade: 'F', minPercent: 0 },
  ];

  it('ได้เกรดตามขอบล่างแบบรวม (inclusive)', () => {
    assert.equal(resolveGrade(cutoffs, 80), 'A');
    assert.equal(resolveGrade(cutoffs, 79.99), 'B');
    assert.equal(resolveGrade(cutoffs, 70), 'B');
    assert.equal(resolveGrade(cutoffs, 65), 'C');
    assert.equal(resolveGrade(cutoffs, 0), 'F');
  });

  it('ไม่สนลำดับในอาร์เรย์ (เรียงเองภายใน)', () => {
    const shuffled = [cutoffs[3], cutoffs[0], cutoffs[2], cutoffs[1]];
    assert.equal(resolveGrade(shuffled, 85), 'A');
  });

  it('ไม่มีเกณฑ์ → null', () => {
    assert.equal(resolveGrade([], 90), null);
  });

  it('ต่ำกว่าขอบล่างสุด → null', () => {
    assert.equal(resolveGrade([{ grade: 'A', minPercent: 50 }], 10), null);
  });

  it('รับ minPercent เป็นสตริง (Decimal)', () => {
    assert.equal(resolveGrade([{ grade: 'A', minPercent: '80' }], 80), 'A');
  });
});

describe('round2', () => {
  it('ปัดทศนิยม 2 ตำแหน่ง', () => {
    assert.equal(round2(1.234), 1.23);
    assert.equal(round2(1.235), 1.24);
    assert.equal(round2(1.005), 1.01);
    assert.equal(round2(2.675), 2.68);
  });

  it('รับสตริงและค่าจำนวนเต็ม', () => {
    assert.equal(round2('1.239'), 1.24);
    assert.equal(round2(7), 7);
    assert.equal(round2(0), 0);
  });
});

describe('autoGradeAnswer', () => {
  const correct = { id: 'c1', isCorrect: true };
  const wrong = { id: 'c2', isCorrect: false };
  const mcQuestion = { type: 'MULTIPLE_CHOICE', points: 2, choices: [correct, wrong] };
  const textQuestion = { type: 'SHORT_ANSWER', points: 3, choices: [] };

  it('ปรนัยตอบถูก → ได้คะแนนเต็ม', () => {
    assert.deepEqual(autoGradeAnswer(mcQuestion, { choiceId: 'c1' }), {
      isCorrect: true,
      autoGraded: true,
      awardedPoints: 2,
    });
  });

  it('ปรนัยตอบผิด → 0 คะแนน', () => {
    assert.deepEqual(autoGradeAnswer(mcQuestion, { choiceId: 'c2' }), {
      isCorrect: false,
      autoGraded: true,
      awardedPoints: 0,
    });
  });

  it('ปรนัยไม่ตอบ → ถือว่าผิด', () => {
    assert.equal(autoGradeAnswer(mcQuestion, { choiceId: null }).isCorrect, false);
    assert.equal(autoGradeAnswer(mcQuestion, {}).awardedPoints, 0);
  });

  it('อัตนัย → รอครูตรวจ (null)', () => {
    assert.deepEqual(autoGradeAnswer(textQuestion, { textAnswer: 'ตอบ' }), {
      isCorrect: null,
      autoGraded: false,
      awardedPoints: null,
    });
  });

  it('ข้อที่มีหลายตัวเลือกแต่ไม่มีเฉลย → ถือว่าผิด', () => {
    const broken = { type: 'MULTIPLE_CHOICE', points: 1, choices: [wrong] };
    assert.equal(autoGradeAnswer(broken, { choiceId: 'c2' }).isCorrect, false);
  });
});
