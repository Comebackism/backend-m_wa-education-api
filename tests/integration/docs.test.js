import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import docsRoutes from '../../src/routes/docs.routes.js';

/**
 * เทสต์เส้นทางเอกสาร API (Swagger UI + OpenAPI JSON)
 * เทสต์นี้ไม่แตะฐานข้อมูล — เมานต์ router ตรง ๆ เพราะในโหมดเทสต์ app.js ปิด docs ไว้
 */

let server;
let baseUrl;

before(async () => {
  const app = express();
  app.use('/api', docsRoutes);
  server = app.listen(0);
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

describe('docs routes', () => {
  it('GET /api/docs/openapi.json → คืน OpenAPI spec', async () => {
    const res = await fetch(`${baseUrl}/api/docs/openapi.json`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(typeof body.openapi, 'string');
    assert.match(body.openapi, /^3\./);
    assert.ok(body.info?.title);
    assert.ok(body.paths && Object.keys(body.paths).length > 0);
  });

  it('GET /api/docs → เสิร์ฟหน้า Swagger UI (HTML)', async () => {
    const res = await fetch(`${baseUrl}/api/docs/`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /swagger/i);
  });
});
