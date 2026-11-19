import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import {
  ALLOWED_IMPORT_EXTENSIONS,
  MAX_IMPORT_FILE_BYTES,
  uploadSingleFile,
} from '../../src/middleware/upload.js';
import { errorHandler } from '../../src/middleware/error.js';

/**
 * เทสต์ middleware อัปโหลดไฟล์ (multer) ผ่าน Express จริง
 * - แปลง MulterError เป็น ApiError รูปแบบเดียวกับทั้งระบบ
 */

let server;
let baseUrl;

before(async () => {
  const app = express();
  app.post('/upload', uploadSingleFile('file'), (req, res) => {
    res.json({ name: req.file.originalname, size: req.file.size });
  });
  app.use(errorHandler);

  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

async function postFile(field, filename, content) {
  const form = new FormData();
  form.append(field, new Blob([content]), filename);
  const response = await fetch(`${baseUrl}/upload`, { method: 'POST', body: form });
  return { status: response.status, data: await response.json() };
}

describe('ค่าคงที่ของ upload', () => {
  it('รองรับเฉพาะ .csv และ .xlsx', () => {
    assert.deepEqual(ALLOWED_IMPORT_EXTENSIONS, ['.csv', '.xlsx']);
  });

  it('จำกัดขนาด 5 MB', () => {
    assert.equal(MAX_IMPORT_FILE_BYTES, 5 * 1024 * 1024);
  });
});

describe('uploadSingleFile', () => {
  it('ไฟล์ .csv ผ่าน → เขียน req.file', async () => {
    const { status, data } = await postFile('file', 'students.csv', 'a,b\n1,2\n');
    assert.equal(status, 200);
    assert.equal(data.name, 'students.csv');
    assert.ok(data.size > 0);
  });

  it('นามสกุลไม่รองรับ → 400', async () => {
    const { status, data } = await postFile('file', 'note.txt', 'hello');
    assert.equal(status, 400);
    assert.match(data.error.message, /รองรับเฉพาะไฟล์/);
  });

  it('ชื่อฟิลด์ผิด → 400 พร้อมบอกชื่อฟิลด์ที่ถูก', async () => {
    const { status, data } = await postFile('document', 'a.csv', 'a,b\n');
    assert.equal(status, 400);
    assert.match(data.error.message, /"file"/);
  });

  it('ไฟล์ใหญ่เกินกำหนด → 400', async () => {
    const { status, data } = await postFile('file', 'big.csv', Buffer.alloc(MAX_IMPORT_FILE_BYTES + 1024));
    assert.equal(status, 400);
    assert.match(data.error.message, /ใหญ่เกิน/);
  });
});
