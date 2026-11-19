import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { csvCell, toCsv } from '../../src/lib/csv.js';

/** เทสต์การสร้าง CSV: RFC 4180 + กัน CSV injection + BOM ภาษาไทย */

describe('csvCell', () => {
  it('ค่า null/undefined → สตริงว่าง', () => {
    assert.equal(csvCell(null), '');
    assert.equal(csvCell(undefined), '');
  });

  it('ค่าปกติส่งต่อตามเดิม', () => {
    assert.equal(csvCell('สวัสดี'), 'สวัสดี');
    assert.equal(csvCell(42), '42');
  });

  it('ครอบด้วย " เมื่อมี , " หรือขึ้นบรรทัดใหม่', () => {
    assert.equal(csvCell('a,b'), '"a,b"');
    assert.equal(csvCell('พูดว่า "hi"'), '"พูดว่า ""hi"""');
    assert.equal(csvCell('บรรทัด1\nบรรทัด2'), '"บรรทัด1\nบรรทัด2"');
  });

  it("กัน CSV injection: เติม ' นำหน้าค่าที่เริ่มด้วย = + - @ TAB CR", () => {
    assert.equal(csvCell('=1+1'), "'=1+1");
    assert.equal(csvCell('+SUM(A1)'), "'+SUM(A1)");
    assert.equal(csvCell('-2'), "'-2"); // ขึ้นต้นด้วย - จึงเติม ' (ไม่มี , " หรือขึ้นบรรทัดใหม่จึงไม่ครอบ)
    assert.equal(csvCell('@cmd'), "'@cmd");
    assert.equal(csvCell('\ttab'), "'\ttab");
  });
});

describe('toCsv', () => {
  it('ใส่ BOM ให้ Excel อ่าน UTF-8 (ค่าเริ่มต้น)', () => {
    const content = toCsv(['ชื่อ'], [['สมชาย']]);
    assert.equal(content.charCodeAt(0), 0xfeff);
    assert.ok(content.includes('ชื่อ'));
    assert.ok(content.includes('สมชาย'));
  });

  it('ปิด BOM ได้', () => {
    const content = toCsv(['a'], [['b']], { bom: false });
    assert.notEqual(content.charCodeAt(0), 0xfeff);
    assert.equal(content, 'a\r\nb\r\n');
  });

  it('ใช้ CRLF และจบไฟล์ด้วย CRLF', () => {
    const content = toCsv(['h1', 'h2'], [['r1c1', 'r1c2']], { bom: false });
    assert.equal(content, 'h1,h2\r\nr1c1,r1c2\r\n');
  });
});
