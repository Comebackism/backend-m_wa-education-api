import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_IP_RULES,
  MAX_IP_RULE_LENGTH,
  formatIp,
  getClientIp,
  isIpAllowed,
  normalizeIp,
  normalizeIpRules,
  parseIpRule,
  validateIpRules,
} from '../../src/lib/ipAllowlist.js';

/**
 * เทสต์ IP/CIDR allowlist (ฟังก์ชันล้วน ไม่แตะ DB)
 * จุดที่ต้องคุมแน่น: fail-closed, IPv4-mapped, ขอบเขต CIDR และการตัดรายการซ้ำ
 */

describe('normalizeIp', () => {
  it('แปลง IPv4 ปกติ', () => {
    const ip = normalizeIp('192.168.1.1');
    assert.equal(ip.version, 4);
    assert.equal(ip.bits, 32);
    assert.equal(formatIp(ip), '192.168.1.1');
  });

  it('มอง IPv4-mapped (::ffff:) เป็น IPv4', () => {
    const ip = normalizeIp('::ffff:192.168.1.5');
    assert.equal(ip.version, 4);
    assert.equal(formatIp(ip), '192.168.1.5');
  });

  it('แปลง IPv6 และตัด zone id', () => {
    assert.equal(normalizeIp('2001:db8::1').version, 6);
    assert.equal(normalizeIp('fe80::1%eth0').version, 6);
  });

  it('รับ IPv6 ที่ครอบวงเล็บเหลี่ยม', () => {
    assert.equal(normalizeIp('[::1]').version, 6);
  });

  it('แปลง IPv6 ที่มีส่วนท้ายเป็น IPv4 (dotted tail)', () => {
    // ::ffff:x.x.x.x ถูกจับด้วย regex ก่อน — ใช้รูปอื่นเพื่อเข้าเส้นทางแปลง dotted tail
    const ip = normalizeIp('2001:db8::192.168.1.1');
    assert.equal(ip.version, 6);
    assert.equal(formatIp(ip), '2001:db8::c0a8:101');
    assert.equal(isIpAllowed('2001:db8::192.168.1.1', ['2001:db8::/32']), true);
  });

  it('ปฏิเสธค่าที่ไม่ใช่ IP', () => {
    for (const value of ['', '   ', 'not-an-ip', '999.1.1.1', '010.0.0.1', '1.2.3', '1.2.3.4.5']) {
      assert.equal(normalizeIp(value), null, `ควรเป็น null: "${value}"`);
    }
  });

  it('ปฏิเสธค่าที่ไม่ใช่สตริง', () => {
    assert.equal(normalizeIp(null), null);
    assert.equal(normalizeIp(undefined), null);
    assert.equal(normalizeIp(42), null);
  });

  it('ปฏิเสธ IPv4-mapped ที่อ็อกเท็ตเกิน 255', () => {
    assert.equal(normalizeIp('::ffff:999.1.1.1'), null);
  });
});

describe('formatIp', () => {
  it('คืน null เมื่อไม่มีค่า', () => {
    assert.equal(formatIp(null), null);
    assert.equal(formatIp(undefined), null);
  });

  it('ย่อช่วงศูนย์ที่ยาวที่สุดด้วย ::', () => {
    assert.equal(formatIp(normalizeIp('2001:0db8:0000:0000:0000:0000:0000:0001')), '2001:db8::1');
    assert.equal(formatIp(normalizeIp('::1')), '::1');
    assert.equal(formatIp(normalizeIp('::')), '::');
  });

  it('ไม่ย่อเมื่อช่วงศูนย์สั้นกว่า 2 กลุ่ม', () => {
    assert.equal(formatIp(normalizeIp('2001:db8:1:2:3:4:5:6')), '2001:db8:1:2:3:4:5:6');
  });
});

describe('parseIpRule', () => {
  it('แปลง IP เดี่ยวเป็น prefix เต็มบิต', () => {
    const rule = parseIpRule('192.168.1.5');
    assert.equal(rule.version, 4);
    assert.equal(rule.prefix, 32);
  });

  it('แปลง CIDR', () => {
    const rule = parseIpRule('203.0.113.0/24');
    assert.equal(rule.version, 4);
    assert.equal(rule.prefix, 24);
  });

  it('แปลง CIDR ของ IPv6', () => {
    const rule = parseIpRule('2001:db8::/32');
    assert.equal(rule.version, 6);
    assert.equal(rule.prefix, 32);
  });

  it('ปฏิเสธรูปแบบ/ขอบเขตที่ไม่ถูกต้อง', () => {
    for (const value of ['', '  ', 'abc', '10.0.0.0/33', '10.0.0.0/999', '10.0.0.0/abc', '10.0.0.0/-1']) {
      assert.equal(parseIpRule(value), null, `ควรเป็น null: "${value}"`);
    }
  });

  it('ปฏิเสธค่าที่ไม่ใช่สตริง', () => {
    assert.equal(parseIpRule(null), null);
    assert.equal(parseIpRule(7), null);
  });
});

describe('isIpAllowed', () => {
  it('ไม่มีกฎ = ผ่านทุก IP', () => {
    assert.equal(isIpAllowed('8.8.8.8', []), true);
    assert.equal(isIpAllowed('8.8.8.8', undefined), true);
    assert.equal(isIpAllowed('', []), true);
  });

  it('IP ในช่วง CIDR = ผ่าน', () => {
    assert.equal(isIpAllowed('203.0.113.55', ['203.0.113.0/24']), true);
    assert.equal(isIpAllowed('10.1.2.3', ['10.0.0.0/8', '192.168.0.0/16']), true);
  });

  it('IP นอกช่วง = ไม่ผ่าน', () => {
    assert.equal(isIpAllowed('203.0.114.1', ['203.0.113.0/24']), false);
  });

  it('fail-closed: อ่าน client IP ไม่ได้ + มีกฎ → ไม่อนุญาต', () => {
    assert.equal(isIpAllowed('', ['203.0.113.0/24']), false);
    assert.equal(isIpAllowed(undefined, ['203.0.113.0/24']), false);
    assert.equal(isIpAllowed('garbage', ['203.0.113.0/24']), false);
  });

  it('ไม่เทียบข้ามเวอร์ชัน (IPv4 กับกฎ IPv6)', () => {
    assert.equal(isIpAllowed('192.168.1.1', ['2001:db8::/32']), false);
  });

  it('IPv4-mapped ถูกกฎ IPv4 จับได้', () => {
    assert.equal(isIpAllowed('::ffff:192.168.1.5', ['192.168.1.0/24']), true);
  });

  it('กฎ /0 ครอบทุก IP เวอร์ชันเดียวกัน', () => {
    assert.equal(isIpAllowed('8.8.8.8', ['0.0.0.0/0']), true);
  });

  it('ข้ามรายการที่ไม่ใช่สตริงหรือว่าง', () => {
    assert.equal(isIpAllowed('8.8.8.8', [null, '', '  ', 5]), true);
    assert.equal(isIpAllowed('203.0.113.1', ['  ', '203.0.113.0/24']), true);
  });

  it('ตัดช่องว่างหัวท้ายของกฎ', () => {
    assert.equal(isIpAllowed('203.0.113.1', ['  203.0.113.0/24  ']), true);
  });
});

describe('validateIpRules', () => {
  it('ผ่านเมื่อกฎถูกต้อง', () => {
    assert.equal(validateIpRules(['192.168.1.1', '10.0.0.0/8', '2001:db8::/32']), null);
    assert.equal(validateIpRules([]), null);
  });

  it('ไม่ใช่ array → ข้อความ error', () => {
    assert.match(validateIpRules('192.168.1.1'), /array/);
  });

  it('เกินจำนวนสูงสุด', () => {
    const many = Array.from({ length: MAX_IP_RULES + 1 }, () => '10.0.0.1');
    assert.match(validateIpRules(many), new RegExp(String(MAX_IP_RULES)));
  });

  it('สมาชิกที่ไม่ใช่สตริง', () => {
    assert.match(validateIpRules([42]), /ข้อความ/);
  });

  it('สมาชิกว่างเปล่า', () => {
    assert.match(validateIpRules(['   ']), /ว่าง/);
  });

  it('ยาวเกินกำหนด', () => {
    const long = `${'a'.repeat(MAX_IP_RULE_LENGTH + 1)}`;
    assert.match(validateIpRules([long]), new RegExp(String(MAX_IP_RULE_LENGTH)));
  });

  it('รูปแบบไม่ถูกต้อง', () => {
    assert.match(validateIpRules(['999.1.1.1']), /ไม่ถูกต้อง/);
  });
});

describe('normalizeIpRules', () => {
  it('ตัดช่องว่าง ตัดค่าว่าง และตัดรายการซ้ำ', () => {
    assert.deepEqual(normalizeIpRules(['  10.0.0.1 ', '10.0.0.1', '', '   ', '192.168.1.0/24']), [
      '10.0.0.1',
      '192.168.1.0/24',
    ]);
  });

  it('ไม่ใช่ array → []', () => {
    assert.deepEqual(normalizeIpRules(null), []);
    assert.deepEqual(normalizeIpRules('10.0.0.1'), []);
  });

  it('แปลงค่าที่ไม่ใช่สตริงด้วย String()', () => {
    assert.deepEqual(normalizeIpRules([1, 1, 'a']), ['1', 'a']);
  });
});

describe('getClientIp', () => {
  it('ใช้ req.ip ก่อน', () => {
    assert.equal(getClientIp({ ip: '1.2.3.4', socket: { remoteAddress: '5.6.7.8' } }), '1.2.3.4');
  });

  it('ถอยไปใช้ socket.remoteAddress', () => {
    assert.equal(getClientIp({ socket: { remoteAddress: '5.6.7.8' } }), '5.6.7.8');
  });

  it('คืนสตริงว่างเมื่ออ่านไม่ได้', () => {
    assert.equal(getClientIp(null), '');
    assert.equal(getClientIp({}), '');
    assert.equal(getClientIp({ ip: 123 }), '');
  });
});
