import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { decodeCsvBuffer, parseTabularFileRows } from '../../src/lib/tabularFile.js';
import { buildXlsxBuffer, encodeCp874 } from '../helpers/csv.js';

/** เทสต์ตัวอ่านไฟล์ตารางดิบ (CSV หลาย encoding + .xlsx) */

describe('decodeCsvBuffer', () => {
  it('ตัด BOM UTF-8 ออก', () => {
    const buffer = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('ชื่อ', 'utf8')]);
    assert.equal(decodeCsvBuffer(buffer), 'ชื่อ');
  });

  it('อ่าน UTF-8 ตรง ๆ', () => {
    assert.equal(decodeCsvBuffer(Buffer.from('สมชาย', 'utf8')), 'สมชาย');
  });

  it('ถอยไปใช้ windows-874 เมื่อไม่ใช่ UTF-8 ที่ถูกต้อง', () => {
    const buffer = encodeCp874('สมชาย');
    assert.equal(decodeCsvBuffer(buffer), 'สมชาย');
  });
});

describe('parseTabularFileRows', () => {
  it('อ่าน CSV เป็น array ของแถว', async () => {
    const rows = await parseTabularFileRows(Buffer.from('a,b\n1,2\n', 'utf8'), 'x.csv');
    assert.deepEqual(rows, [['a', 'b'], ['1', '2']]);
  });

  it('รองรับคอลัมน์ไม่เท่ากัน (relax_column_count)', async () => {
    const rows = await parseTabularFileRows(Buffer.from('a,b,c\n1,2\n', 'utf8'), 'x.csv');
    assert.deepEqual(rows[1], ['1', '2']);
  });

  it('อ่าน .xlsx เป็น array ของแถว', async () => {
    const buffer = await buildXlsxBuffer([['a', 'b'], [1, 2]]);
    const rows = await parseTabularFileRows(buffer, 'x.xlsx');
    assert.deepEqual(rows, [['a', 'b'], ['1', '2']]);
  });

  it('นามสกุลไม่รองรับ → ApiError พร้อมข้อความ', async () => {
    await assert.rejects(() => parseTabularFileRows(Buffer.from('a'), 'x.txt'), (error) => {
      assert.match(error.message, /รองรับเฉพาะไฟล์/);
      return true;
    });
  });

  it('.xlsx ที่เสียหาย → ApiError', async () => {
    await assert.rejects(() => parseTabularFileRows(Buffer.from('not an xlsx'), 'bad.xlsx'), /อ่านไฟล์ Excel ไม่สำเร็จ/);
  });
});
