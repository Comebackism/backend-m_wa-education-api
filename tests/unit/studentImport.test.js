import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_IMPORT_STUDENTS,
  STUDENT_IMPORT_HEADERS,
  readStudentRosterFile,
  rowsToStudents,
} from '../../src/lib/studentImport.js';
import { buildXlsxBuffer, encodeCp874, toCsvRows } from '../helpers/csv.js';

/** เทสต์ตัวอ่าน/ตรวจไฟล์รายชื่อนักเรียน (all-or-nothing ระดับแถว, ไม่แตะ DB) */

const HEADER = [...STUDENT_IMPORT_HEADERS];

describe('rowsToStudents — โครงสร้างไฟล์', () => {
  it('ไฟล์ว่าง → error', () => {
    const { students, errors } = rowsToStudents([]);
    assert.deepEqual(students, []);
    assert.equal(errors[0].message, 'ไฟล์ว่างเปล่า');
  });

  it('มีแต่บรรทัดว่าง → ไม่พบหัวตาราง', () => {
    const { errors } = rowsToStudents([
      ['', ''],
      ['  ', ''],
    ]);
    assert.equal(errors[0].message, 'ไม่พบหัวตารางในไฟล์');
  });

  it('หัวตารางขาดคอลัมน์บังคับ → แจ้งครบทุกคอลัมน์ที่ขาด', () => {
    const { students, errors } = rowsToStudents([['อีเมล'], ['a@b.com']]);
    assert.deepEqual(students, []);
    assert.equal(errors.length, 1);
    assert.match(errors[0].message, /ชื่อ-นามสกุล/);
  });

  it('หัวตารางอยู่บรรทัดที่ 2 ได้ (ข้ามบรรทัดว่างนำ)', () => {
    const { students } = rowsToStudents([['', ''], HEADER, ['S1', 'สมชาย', 'a@b.com', '']]);
    assert.equal(students.length, 1);
    assert.equal(students[0].rowNumber, 3);
  });

  it('มีหัวตารางแต่ไม่มีแถวข้อมูล → error', () => {
    const { errors } = rowsToStudents([HEADER, ['', '', '', '']]);
    assert.equal(errors[0].message, 'ไม่พบแถวข้อมูลใต้หัวตาราง');
  });

  it('เกินจำนวนสูงสุดต่อครั้ง', () => {
    const rows = [HEADER];
    for (let i = 0; i <= MAX_IMPORT_STUDENTS; i += 1) rows.push([`S${i}`, 'ชื่อ', `u${i}@b.com`, '']);
    const { students, errors } = rowsToStudents(rows);
    assert.deepEqual(students, []);
    assert.match(errors[0].message, new RegExp(String(MAX_IMPORT_STUDENTS)));
  });
});

describe('rowsToStudents — แปลงข้อมูล', () => {
  it('อ่านแถวถูกต้อง + lowercase อีเมล', () => {
    const { students, errors } = rowsToStudents([
      HEADER,
      ['S001', 'สมชาย ใจดี', 'Somchai@Test.Local', 'Password123!'],
    ]);
    assert.deepEqual(errors, []);
    assert.deepEqual(students, [
      {
        rowNumber: 2,
        studentCode: 'S001',
        fullName: 'สมชาย ใจดี',
        email: 'somchai@test.local',
        password: 'Password123!',
      },
    ]);
  });

  it('รหัสนักเรียน/รหัสผ่านเว้นว่างได้ → null', () => {
    const { students } = rowsToStudents([HEADER, ['', 'สมหญิง', 'a@b.com', '']]);
    assert.equal(students[0].studentCode, null);
    assert.equal(students[0].password, null);
  });

  it('รับหัวตารางภาษาอังกฤษ', () => {
    const { students } = rowsToStudents([
      ['student code', 'full name', 'email', 'password'],
      ['S1', 'A', 'a@b.com', 'pw123456'],
    ]);
    assert.equal(students.length, 1);
    assert.equal(students[0].email, 'a@b.com');
  });

  it('ตัดช่องว่างและ NBSP', () => {
    const { students } = rowsToStudents([HEADER, [' S1 ', '  สมชาย\u00a0ใจดี ', ' a@b.com ', ' ']]);
    assert.equal(students[0].studentCode, 'S1');
    assert.equal(students[0].fullName, 'สมชาย ใจดี');
    assert.equal(students[0].password, null);
  });

  it('ข้ามบรรทัดว่างระหว่างข้อมูล', () => {
    const { students } = rowsToStudents([
      HEADER,
      ['S1', 'A', 'a@b.com', ''],
      ['', '', '', ''],
      ['S2', 'B', 'b@b.com', ''],
    ]);
    assert.equal(students.length, 2);
    assert.equal(students[1].rowNumber, 4);
  });
});

describe('rowsToStudents — ตรวจความถูกต้อง', () => {
  const cases = [
    { name: 'ไม่มีชื่อ', row: ['S1', '', 'a@b.com', ''], match: /ชื่อ-นามสกุล/ },
    { name: 'ไม่มีอีเมล', row: ['S1', 'A', '', ''], match: /อีเมล/ },
    { name: 'อีเมลผิดรูปแบบ', row: ['S1', 'A', 'not-an-email', ''], match: /ไม่ถูกต้อง/ },
    { name: 'ชื่อยาวเกิน', row: ['S1', 'ก'.repeat(201), 'a@b.com', ''], match: /ยาวเกิน/ },
    { name: 'รหัสยาวเกิน', row: ['ร'.repeat(51), 'A', 'a@b.com', ''], match: /ยาวเกิน/ },
    { name: 'รหัสผ่านสั้นไป', row: ['S1', 'A', 'a@b.com', 'short'], match: /8.72/ },
    { name: 'รหัสผ่านซ้ำรหัสนักเรียน', row: ['STUDENT01', 'A', 'a@b.com', 'STUDENT01'], match: /ซ้ำกับรหัสนักเรียน/ },
  ];

  for (const testCase of cases) {
    it(testCase.name, () => {
      const { students, errors } = rowsToStudents([HEADER, testCase.row]);
      assert.deepEqual(students, []);
      assert.equal(errors.length, 1);
      assert.match(errors[0].message, testCase.match);
    });
  }

  it('อีเมลซ้ำในไฟล์เดียวกัน', () => {
    const { students, errors } = rowsToStudents([
      HEADER,
      ['S1', 'A', 'dup@b.com', ''],
      ['S2', 'B', 'dup@b.com', ''],
    ]);
    assert.equal(students.length, 1);
    assert.equal(errors.length, 1);
    assert.match(errors[0].message, /ซ้ำกับแถวที่ 2/);
  });

  it('รหัสนักเรียนซ้ำในไฟล์เดียวกัน', () => {
    const { students, errors } = rowsToStudents([
      HEADER,
      ['S1', 'A', 'a@b.com', ''],
      ['S1', 'B', 'b@b.com', ''],
    ]);
    assert.equal(students.length, 1);
    assert.equal(errors.length, 1);
    assert.match(errors[0].message, /ซ้ำกับแถวที่ 2/);
  });

  it('รวบรวมหลายปัญหาของแถวเดียวกันในข้อความเดียว', () => {
    const { errors } = rowsToStudents([HEADER, ['S1', '', 'bad', '']]);
    assert.match(errors[0].message, /ชื่อ-นามสกุล/);
    assert.match(errors[0].message, /ไม่ถูกต้อง/);
  });
});

describe('readStudentRosterFile', () => {
  it('อ่านไฟล์ CSV (UTF-8 + BOM)', async () => {
    const content = toCsvRows([HEADER, ['S1', 'สมชาย', 'a@b.com', 'pw123456']], { bom: true });
    const { students, errors } = await readStudentRosterFile(Buffer.from(content, 'utf8'), 'roster.csv');
    assert.deepEqual(errors, []);
    assert.equal(students.length, 1);
    assert.equal(students[0].fullName, 'สมชาย');
  });

  it('อ่านไฟล์ CSV ที่เป็น windows-874 (Excel ภาษาไทย)', async () => {
    const content = encodeCp874(toCsvRows([HEADER, ['S1', 'สมชาย', 'a@b.com', '']]));
    const { students } = await readStudentRosterFile(content, 'roster.csv');
    assert.equal(students[0].fullName, 'สมชาย');
  });

  it('อ่านไฟล์ .xlsx', async () => {
    const buffer = await buildXlsxBuffer([HEADER, ['S1', 'สมชาย', 'a@b.com', '']]);
    const { students } = await readStudentRosterFile(buffer, 'roster.xlsx');
    assert.equal(students.length, 1);
    assert.equal(students[0].email, 'a@b.com');
  });

  it('นามสกุลไฟล์ที่ไม่รองรับ → โยน ApiError', async () => {
    await assert.rejects(() => readStudentRosterFile(Buffer.from('x'), 'roster.txt'), /รองรับเฉพาะไฟล์/);
  });
});
