import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';

import { query, validate } from '../../src/middleware/validate.js';
import { requireRole, studentOnly, teacherOnly } from '../../src/middleware/auth.js';
import { errorHandler, notFoundHandler } from '../../src/middleware/error.js';
import { ApiError } from '../../src/lib/errors.js';

/** เทสต์ middleware ที่ไม่ต้องใช้ DB: validate / requireRole / error handler */

function makeRes() {
  const res = {
    statusCode: null,
    body: null,
    headersSent: false,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

describe('validate middleware', () => {
  it('body ผ่าน → เขียนค่าที่ coerce แล้วกลับลง req.body', () => {
    const req = { body: { points: '5' } };
    const next = mock.fn();
    validate({ body: z.object({ points: z.coerce.number() }) })(req, makeRes(), next);
    assert.equal(req.body.points, 5);
    assert.equal(next.mock.callCount(), 1);
  });

  it('params ผ่าน → เขียนทับ req.params', () => {
    const req = { params: { id: 'abc' } };
    validate({ params: z.object({ id: z.string().min(2) }) })(req, makeRes(), mock.fn());
    assert.deepEqual(req.params, { id: 'abc' });
  });

  it('body ผิด → โยน ApiError 400 พร้อม field/ message', () => {
    const req = { body: {} };
    assert.throws(
      () => validate({ body: z.object({ email: z.email() }) })(req, makeRes(), mock.fn()),
      (error) => {
        assert.equal(error.statusCode, 400);
        assert.equal(error.details[0].field, 'body.email');
        assert.ok(error.details[0].message);
        return true;
      },
    );
  });

  it('query เก็บที่ req.validatedQuery (ไม่ทับ getter ของ Express)', () => {
    const req = { query: { q: 'abc' } };
    validate({ query: z.object({ q: z.string() }) })(req, makeRes(), mock.fn());
    assert.deepEqual(req.validatedQuery, { q: 'abc' });
    assert.deepEqual(query(req), { q: 'abc' });
  });

  it('ไม่มี req.body เลย → ถือเป็น {} แล้วผ่าน', () => {
    const req = {};
    validate({ body: z.object({ name: z.string().optional() }) })(req, makeRes(), mock.fn());
    assert.deepEqual(req.body, {});
  });

  it('ไม่มี req.query เลย → ถือเป็น {} แล้วผ่าน', () => {
    const req = {};
    validate({ query: z.object({ q: z.string().optional() }) })(req, makeRes(), mock.fn());
    assert.deepEqual(req.validatedQuery, {});
  });

  it('query ผิด → field ขึ้นต้นด้วย "query."', () => {
    assert.throws(
      () =>
        validate({ query: z.object({ n: z.coerce.number() }) })({ query: { n: 'x' } }, makeRes(), mock.fn()),
      (error) => {
        assert.equal(error.details[0].field, 'query.n');
        return true;
      },
    );
  });

  it('รวบรวม error จากหลายแหล่งพร้อมกัน', () => {
    const schemas = {
      params: z.object({ id: z.uuid() }),
      body: z.object({ name: z.string().min(1) }),
    };
    assert.throws(
      () => validate(schemas)({ params: { id: 'bad' }, body: { name: '' } }, makeRes(), mock.fn()),
      (error) => {
        assert.equal(error.details.length, 2);
        return true;
      },
    );
  });

  it('query() บน req ที่ยังไม่ validate → {}', () => {
    assert.deepEqual(query({}), {});
  });
});

describe('requireRole / teacherOnly / studentOnly', () => {
  it('ไม่มี req.user → 401', () => {
    assert.throws(
      () => requireRole('TEACHER')({}, makeRes(), mock.fn()),
      (error) => error.statusCode === 401,
    );
  });

  it('บทบาทไม่ตรง → 403', () => {
    assert.throws(
      () => requireRole('TEACHER')({ user: { role: 'STUDENT' } }, makeRes(), mock.fn()),
      (error) => error.statusCode === 403,
    );
  });

  it('บทบาทตรง → ผ่าน', () => {
    const next = mock.fn();
    requireRole('TEACHER')({ user: { role: 'TEACHER' } }, makeRes(), next);
    assert.equal(next.mock.callCount(), 1);
  });

  it('teacherOnly เปิดให้ทั้ง TEACHER และ ADMIN', () => {
    for (const role of ['TEACHER', 'ADMIN']) {
      const next = mock.fn();
      teacherOnly({ user: { role } }, makeRes(), next);
      assert.equal(next.mock.callCount(), 1, role);
    }
    assert.throws(() => teacherOnly({ user: { role: 'STUDENT' } }, makeRes(), mock.fn()));
  });

  it('studentOnly เปิดให้ทั้ง STUDENT และ ADMIN', () => {
    for (const role of ['STUDENT', 'ADMIN']) {
      const next = mock.fn();
      studentOnly({ user: { role } }, makeRes(), next);
      assert.equal(next.mock.callCount(), 1, role);
    }
    assert.throws(() => studentOnly({ user: { role: 'TEACHER' } }, makeRes(), mock.fn()));
  });
});

describe('notFoundHandler', () => {
  it('ตอบ 404 พร้อม method + url', () => {
    const res = makeRes();
    notFoundHandler({ method: 'GET', originalUrl: '/api/nope' }, res);
    assert.equal(res.statusCode, 404);
    assert.match(res.body.error.message, /GET \/api\/nope/);
  });
});

describe('errorHandler', () => {
  it('ApiError → ใช้ statusCode และรูปแบบ error มาตรฐาน', () => {
    const res = makeRes();
    errorHandler(ApiError.badRequest('ข้อมูลไม่ถูกต้อง', [{ field: 'x' }]), {}, res, mock.fn());
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.body, {
      error: { code: 'BAD_REQUEST', message: 'ข้อมูลไม่ถูกต้อง', details: [{ field: 'x' }] },
    });
  });

  it('ApiError ที่ไม่มี details → details เป็น undefined', () => {
    const res = makeRes();
    errorHandler(ApiError.notFound('ไม่พบ'), {}, res, mock.fn());
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.error.details, undefined);
  });

  it('Prisma P2002 → 409 CONFLICT', () => {
    const res = makeRes();
    errorHandler(
      { name: 'PrismaClientKnownRequestError', code: 'P2002', meta: { target: ['email'] } },
      {},
      res,
      mock.fn(),
    );
    assert.equal(res.statusCode, 409);
    assert.match(res.body.error.message, /email/);
  });

  it('Prisma P2025 → 404 / P2003 → 409', () => {
    const notFound = makeRes();
    errorHandler({ name: 'PrismaClientKnownRequestError', code: 'P2025' }, {}, notFound, mock.fn());
    assert.equal(notFound.statusCode, 404);

    const conflict = makeRes();
    errorHandler({ name: 'PrismaClientKnownRequestError', code: 'P2003' }, {}, conflict, mock.fn());
    assert.equal(conflict.statusCode, 409);
  });

  it('JSON เพี้ยน → 400', () => {
    const res = makeRes();
    errorHandler({ type: 'entity.parse.failed' }, {}, res, mock.fn());
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error.code, 'BAD_REQUEST');
  });

  it('error ที่ไม่รู้จัก → 500 (โหมดเทสต์เห็นข้อความจริง)', () => {
    const res = makeRes();
    const spy = mock.method(console, 'error', () => {});
    try {
      errorHandler(new Error('พัง'), {}, res, mock.fn());
    } finally {
      spy.mock.restore();
    }
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.error.code, 'INTERNAL_ERROR');
    assert.equal(res.body.error.message, 'พัง');
  });
});
