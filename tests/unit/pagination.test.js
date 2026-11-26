import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  buildPaginationMeta,
  parsePagination,
  runPaginated,
} from '../../src/lib/pagination.js';

describe('parsePagination', () => {
  it('ไม่ส่ง page/limit → null (ไม่แบ่งหน้า)', () => {
    assert.equal(parsePagination(), null);
    assert.equal(parsePagination({}), null);
    assert.equal(parsePagination({ page: undefined, limit: undefined }), null);
  });

  it('ส่ง limit อย่างเดียว → เริ่มที่หน้า 1', () => {
    assert.deepEqual(parsePagination({ limit: 5 }), { page: 1, limit: 5, skip: 0, take: 5 });
  });

  it('ส่ง page อย่างเดียว → ใช้ขนาดหน้าสำรอง', () => {
    assert.deepEqual(parsePagination({ page: 3 }), {
      page: 3,
      limit: DEFAULT_PAGE_SIZE,
      skip: DEFAULT_PAGE_SIZE * 2,
      take: DEFAULT_PAGE_SIZE,
    });
  });

  it('คำนวณ skip/take ตามหน้า', () => {
    assert.deepEqual(parsePagination({ page: 4, limit: 10 }), {
      page: 4,
      limit: 10,
      skip: 30,
      take: 10,
    });
  });

  it('จำกัด limit ไม่เกิน MAX_PAGE_SIZE', () => {
    assert.equal(parsePagination({ limit: MAX_PAGE_SIZE + 50 }).limit, MAX_PAGE_SIZE);
  });
});

describe('buildPaginationMeta', () => {
  it('คำนวณ totalPages/hasNext/hasPrev ถูกต้อง', () => {
    assert.deepEqual(buildPaginationMeta({ page: 1, limit: 2 }, 5), {
      page: 1,
      limit: 2,
      total: 5,
      totalPages: 3,
      hasNext: true,
      hasPrev: false,
    });

    assert.deepEqual(buildPaginationMeta({ page: 3, limit: 2 }, 5), {
      page: 3,
      limit: 2,
      total: 5,
      totalPages: 3,
      hasNext: false,
      hasPrev: true,
    });
  });

  it('ไม่มีข้อมูล → totalPages = 0 และไม่มีหน้าถัดไป', () => {
    assert.deepEqual(buildPaginationMeta({ page: 1, limit: 10 }, 0), {
      page: 1,
      limit: 10,
      total: 0,
      totalPages: 0,
      hasNext: false,
      hasPrev: false,
    });
  });
});

describe('runPaginated', () => {
  it('ไม่มี pagination → เรียก findMany เปล่า ๆ และไม่ต้อง count', async () => {
    let countCalled = false;
    const result = await runPaginated(
      null,
      async (args) => {
        assert.equal(args, undefined);
        return [1, 2, 3];
      },
      async () => {
        countCalled = true;
        return 3;
      },
    );

    assert.deepEqual(result, { items: [1, 2, 3], pagination: null });
    assert.equal(countCalled, false);
  });

  it('มี pagination → ส่ง skip/take และคืน meta จาก count', async () => {
    const received = [];
    const result = await runPaginated(
      parsePagination({ page: 2, limit: 5 }),
      async (args) => {
        received.push(args);
        return ['a'];
      },
      async () => 11,
    );

    assert.deepEqual(received, [{ skip: 5, take: 5 }]);
    assert.deepEqual(result.items, ['a']);
    assert.deepEqual(result.pagination, {
      page: 2,
      limit: 5,
      total: 11,
      totalPages: 3,
      hasNext: true,
      hasPrev: true,
    });
  });
});
