import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_IMPORT_QUESTIONS,
  QUESTION_IMPORT_HEADERS,
  readQuestionImportFile,
  rowsToQuestions,
} from '../../src/lib/questionImport.js';
import { buildXlsxBuffer, toCsvRows } from '../helpers/csv.js';

/** เทสต์ตัวอ่าน/ตรวจไฟล์ข้อคำถาม (ตัวเลือกกว้างคงที่, ไม่แตะ DB) */

const HEADER = [...QUESTION_IMPORT_HEADERS];
// ประเภท | โจทย์ | คะแนน | A | B | C | D | เฉลย | คำตอบอ้างอิง | คำอธิบาย
const mcRow = ['ปรนัย', 'ข้อใดถูก?', '2', 'ก', 'ข', 'ค', 'ง', 'A', '', 'อธิบาย'];

describe('rowsToQuestions — โครงสร้างไฟล์', () => {
  it('ไฟล์ว่าง → error', () => {
    const { questions, errors } = rowsToQuestions([]);
    assert.deepEqual(questions, []);
    assert.equal(errors[0].message, 'ไฟล์ว่างเปล่า');
  });

  it('มีแต่บรรทัดว่าง → ไม่พบหัวตาราง', () => {
    const { errors } = rowsToQuestions([['', '']]);
    assert.equal(errors[0].message, 'ไม่พบหัวตารางในไฟล์');
  });

  it('หัวตารางขาด "โจทย์"/"คะแนน" → แจ้งทั้งสองคอลัมน์', () => {
    const { errors } = rowsToQuestions([['ตัวเลือก A'], ['ก']]);
    assert.equal(errors.length, 2);
    assert.ok(errors.some((error) => /โจทย์/.test(error.message)));
    assert.ok(errors.some((error) => /คะแนน/.test(error.message)));
  });

  it('มีหัวตารางแต่ไม่มีแถวข้อมูล', () => {
    const { errors } = rowsToQuestions([HEADER, ['', '', '', '', '', '', '', '', '', '']]);
    assert.equal(errors[0].message, 'ไม่พบแถวข้อมูลใต้หัวตาราง');
  });

  it('เกินจำนวนสูงสุดต่อครั้ง', () => {
    const rows = [HEADER];
    for (let i = 0; i <= MAX_IMPORT_QUESTIONS; i += 1) rows.push([...mcRow]);
    const { errors } = rowsToQuestions(rows);
    assert.match(errors[0].message, new RegExp(String(MAX_IMPORT_QUESTIONS)));
  });
});

describe('rowsToQuestions — ปรนัย', () => {
  it('อ่านข้อปรนัยพร้อมตัวเลือกและเฉลย', () => {
    const { questions, errors } = rowsToQuestions([HEADER, mcRow]);
    assert.deepEqual(errors, []);
    assert.equal(questions.length, 1);
    const question = questions[0];
    assert.equal(question.type, 'MULTIPLE_CHOICE');
    assert.equal(question.points, 2);
    assert.equal(question.prompt, 'ข้อใดถูก?');
    assert.equal(question.explanation, 'อธิบาย');
    assert.equal(question.choices.length, 4);
    assert.deepEqual(
      question.choices.map((choice) => choice.label),
      ['A', 'B', 'C', 'D'],
    );
    assert.deepEqual(
      question.choices.map((choice) => choice.order),
      [0, 1, 2, 3],
    );
    assert.deepEqual(
      question.choices.filter((choice) => choice.isCorrect).map((choice) => choice.label),
      ['A'],
    );
  });

  it('เฉลยเล็ก/ใหญ่ไม่สำคัญ', () => {
    const { questions } = rowsToQuestions([HEADER, ['', 'x', '1', 'ก', 'ข', '', '', 'b', '', '']]);
    assert.equal(questions[0].choices.find((choice) => choice.isCorrect).label, 'B');
  });

  it('ตัวเลือกว่างถูกตัดออก (คงป้ายเดิมไว้)', () => {
    const { questions } = rowsToQuestions([HEADER, ['', 'x', '1', 'ก', '', 'ค', '', 'C', '', '']]);
    assert.deepEqual(
      questions[0].choices.map((choice) => choice.label),
      ['A', 'C'],
    );
    assert.equal(questions[0].choices.find((choice) => choice.isCorrect).label, 'C');
    assert.deepEqual(
      questions[0].choices.map((choice) => choice.order),
      [0, 1],
    );
  });

  it('ต้องมีตัวเลือกอย่างน้อย 2', () => {
    const { questions, errors } = rowsToQuestions([HEADER, ['ปรนัย', 'x', '1', 'ก', '', '', '', 'A', '', '']]);
    assert.deepEqual(questions, []);
    assert.match(errors[0].message, /อย่างน้อย 2/);
  });

  it('ต้องระบุเฉลย', () => {
    const { errors } = rowsToQuestions([HEADER, ['ปรนัย', 'x', '1', 'ก', 'ข', '', '', '', '', '']]);
    assert.match(errors[0].message, /ต้องระบุเฉลย/);
  });

  it('เฉลยต้องตรงกับตัวเลือกที่มี', () => {
    const { errors } = rowsToQuestions([HEADER, ['ปรนัย', 'x', '1', 'ก', 'ข', '', '', 'D', '', '']]);
    assert.match(errors[0].message, /ไม่ตรงกับตัวเลือก/);
  });
});

describe('rowsToQuestions — อัตนัยและการเดาประเภท', () => {
  it('ระบุประเภทอัตนัยได้ (ไทย)', () => {
    const { questions } = rowsToQuestions([
      HEADER,
      ['อัตนัย', 'จงอธิบาย', '3', '', '', '', '', '', 'แนวคำตอบ', ''],
    ]);
    assert.equal(questions[0].type, 'SHORT_ANSWER');
    assert.equal(questions[0].referenceText, 'แนวคำตอบ');
    assert.equal(questions[0].choices, undefined);
  });

  it('ไม่มีคอลัมน์ประเภท → เดาว่าปรนัยเมื่อมีตัวเลือก', () => {
    const header = ['โจทย์', 'คะแนน', 'ตัวเลือก A', 'ตัวเลือก B', 'เฉลย'];
    const { questions } = rowsToQuestions([header, ['x', '2', 'ก', 'ข', 'A']]);
    assert.equal(questions[0].type, 'MULTIPLE_CHOICE');
  });

  it('ไม่มีคอลัมน์ประเภทและไม่มีตัวเลือก → เดาว่าอัตนัยสั้น', () => {
    const header = ['โจทย์', 'คะแนน'];
    const { questions } = rowsToQuestions([header, ['x', '2']]);
    assert.equal(questions[0].type, 'SHORT_ANSWER');
  });

  it('ประเภทที่ไม่รู้จัก → error', () => {
    const { errors } = rowsToQuestions([HEADER, ['มั่ว', 'x', '1', '', '', '', '', '', '', '']]);
    assert.match(errors[0].message, /ไม่รู้จักประเภท/);
  });

  it('ยอมรับชื่อประเภทภาษาอังกฤษ (LONG_ANSWER)', () => {
    const { questions } = rowsToQuestions([HEADER, ['long_answer', 'x', '5', '', '', '', '', '', '', '']]);
    assert.equal(questions[0].type, 'LONG_ANSWER');
  });
});

describe('rowsToQuestions — โจทย์และคะแนน', () => {
  it('โจทย์ว่าง → error', () => {
    const { errors } = rowsToQuestions([HEADER, ['', '', '1', '', '', '', '', '', '', '']]);
    assert.match(errors[0].message, /ต้องระบุโจทย์/);
  });

  it('คะแนนว่าง → error', () => {
    const { errors } = rowsToQuestions([HEADER, ['', 'x', '', '', '', '', '', '', '', '']]);
    assert.match(errors[0].message, /ต้องระบุคะแนน/);
  });

  it('คะแนนที่ไม่ใช่ตัวเลขหรือ ≤ 0 → error', () => {
    assert.match(
      rowsToQuestions([HEADER, ['', 'x', 'abc', '', '', '', '', '', '', '']]).errors[0].message,
      /ตัวเลข/,
    );
    assert.match(
      rowsToQuestions([HEADER, ['', 'x', '0', '', '', '', '', '', '', '']]).errors[0].message,
      /มากกว่า 0/,
    );
  });

  it('รับคะแนนทศนิยมด้วยจุลภาค', () => {
    const { questions } = rowsToQuestions([HEADER, ['', 'x', '2,5', '', '', '', '', '', '', '']]);
    assert.equal(questions[0].points, 2.5);
  });
});

describe('readQuestionImportFile', () => {
  it('อ่านไฟล์ CSV (UTF-8)', async () => {
    const content = toCsvRows([HEADER, mcRow], { bom: true });
    const { questions, errors } = await readQuestionImportFile(Buffer.from(content, 'utf8'), 'q.csv');
    assert.deepEqual(errors, []);
    assert.equal(questions.length, 1);
    assert.equal(questions[0].type, 'MULTIPLE_CHOICE');
  });

  it('อ่านไฟล์ .xlsx', async () => {
    const buffer = await buildXlsxBuffer([HEADER, mcRow]);
    const { questions } = await readQuestionImportFile(buffer, 'q.xlsx');
    assert.equal(questions.length, 1);
    assert.equal(questions[0].choices.length, 4);
  });

  it('นามสกุลไฟล์ที่ไม่รองรับ → โยน ApiError', async () => {
    await assert.rejects(() => readQuestionImportFile(Buffer.from('x'), 'q.txt'), /รองรับเฉพาะไฟล์/);
  });
});

describe('rowsToQuestions — ขอบเขตข้อมูล', () => {
  it('หัวตารางมีเซลล์ว่าง/null → มองเป็นบรรทัดว่าง', () => {
    const { questions, errors } = rowsToQuestions([[null, undefined]]);
    assert.deepEqual(questions, []);
    assert.equal(errors[0].message, 'ไม่พบหัวตารางในไฟล์');
  });

  it('เซลล์โจทย์เป็น null → ถือว่าไม่ได้ระบุโจทย์', () => {
    const { errors } = rowsToQuestions([HEADER, ['', null, '1', '', '', '', '', '', '', '']]);
    assert.match(errors[0].message, /ต้องระบุโจทย์/);
  });

  it('คะแนนเกินเพดาน → error', () => {
    const { errors } = rowsToQuestions([HEADER, ['', 'x', '1001', '', '', '', '', '', '', '']]);
    assert.match(errors[0].message, /ไม่เกิน 1000/);
  });

  it('โจทย์ยาวเกินกำหนด → error', () => {
    const { errors } = rowsToQuestions([HEADER, ['', 'x'.repeat(20001), '1', '', '', '', '', '', '', '']]);
    assert.match(errors[0].message, /โจทย์ยาวเกิน/);
  });

  it('คำตอบอ้างอิง/คำอธิบายยาวเกินกำหนด → error', () => {
    const longRef = rowsToQuestions([HEADER, ['', 'x', '1', '', '', '', '', '', 'r'.repeat(20001), '']]);
    assert.match(longRef.errors[0].message, /คำตอบอ้างอิงยาวเกิน/);

    const longExp = rowsToQuestions([HEADER, ['', 'x', '1', '', '', '', '', '', '', 'e'.repeat(20001)]]);
    assert.match(longExp.errors[0].message, /คำอธิบายยาวเกิน/);
  });
});
