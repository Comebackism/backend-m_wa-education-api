import { isIP } from 'node:net';

/**
 * ตรวจ IP/CIDR allowlist สำหรับ "จำกัดเครื่องที่เข้าทำข้อสอบ" (IP restriction)
 *
 * - รองรับ IPv4, IPv6 และ CIDR (เช่น `203.0.113.10`, `203.0.113.0/24`, `2001:db8::/32`)
 * - เขียนเองโดยไม่พึ่ง dependency ภายนอก เพื่อคุมพฤติกรรมให้ทดสอบได้แน่นอน
 * - IP แบบ IPv4-mapped (`::ffff:192.168.1.5`) จะถูกมองเป็น IPv4 เพื่อให้กฎ IPv4 จับได้
 * - เขียนแบบ "fail-closed": ถ้า client IP อ่านไม่ได้ และข้อสอบมีกฎ → ถือว่าไม่อนุญาต
 */

export const MAX_IP_RULES = 50;
export const MAX_IP_RULE_LENGTH = 64;

const IPV4_BITS = 32;
const IPV6_BITS = 128;

function parseIpv4(value) {
  const parts = value.split('.');
  if (parts.length !== 4) return null;

  let result = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    // กันรูปแบบกำกวมอย่าง 010.0.0.1
    if (part.length > 1 && part.startsWith('0')) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    result = (result << 8n) | BigInt(octet);
  }
  return result;
}

function parseIpv6(value) {
  let text = value;

  // ตัด zone id (เช่น fe80::1%eth0)
  const zone = text.indexOf('%');
  if (zone !== -1) text = text.slice(0, zone);

  // ท้ายเป็น IPv4 (เช่น ::ffff:192.168.1.1) → แปลงเป็น 2 กลุ่ม hex ก่อน
  if (text.includes('.')) {
    const lastColon = text.lastIndexOf(':');
    if (lastColon === -1) return null;
    const ipv4 = parseIpv4(text.slice(lastColon + 1));
    if (ipv4 === null) return null;
    const hex = ipv4.toString(16).padStart(8, '0');
    text = `${text.slice(0, lastColon + 1)}${hex.slice(0, 4)}:${hex.slice(4)}`;
  }

  if ((text.match(/::/g) ?? []).length > 1) return null;

  let groups;
  if (text.includes('::')) {
    const [left, right] = text.split('::');
    const leftGroups = left === '' ? [] : left.split(':');
    const rightGroups = right === '' ? [] : right.split(':');
    const missing = 8 - leftGroups.length - rightGroups.length;
    if (missing < 1) return null;
    groups = [...leftGroups, ...Array(missing).fill('0'), ...rightGroups];
  } else {
    groups = text.split(':');
    if (groups.length !== 8) return null;
  }

  let result = 0n;
  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
    result = (result << 16n) | BigInt(Number.parseInt(group, 16));
  }
  return result;
}

function prefixMask(bits, prefix) {
  if (prefix <= 0) return 0n;
  return ((1n << BigInt(prefix)) - 1n) << BigInt(bits - prefix);
}

/** แปลง IP เดี่ยว → { version, value, bits } หรือ null ถ้ารูปแบบไม่ถูกต้อง */
export function normalizeIp(raw) {
  if (typeof raw !== 'string') return null;

  let text = raw.trim();
  if (text === '') return null;
  if (text.startsWith('[') && text.endsWith(']')) text = text.slice(1, -1);

  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(text);
  if (mapped) {
    const value = parseIpv4(mapped[1]);
    return value === null ? null : { version: 4, value, bits: IPV4_BITS };
  }

  const kind = isIP(text);
  if (kind === 4) {
    const value = parseIpv4(text);
    return value === null ? null : { version: 4, value, bits: IPV4_BITS };
  }

  if (kind === 6) {
    const value = parseIpv6(text);
    if (value === null) return null;
    // IPv4-mapped (::ffff:0:0/96) → มองเป็น IPv4 เพื่อให้กฎ IPv4 จับได้
    if (value >> 32n === 0xffffn) return { version: 4, value: value & 0xffffffffn, bits: IPV4_BITS };
    return { version: 6, value, bits: IPV6_BITS };
  }

  return null;
}

/** แปลง IP เดี่ยว → สตริงรูปมาตรฐาน (IPv4 dotted / IPv6 ย่อ) ใช้แสดงผลให้ครู */
export function formatIp(ip) {
  if (!ip) return null;

  if (ip.version === 4) {
    return [24n, 16n, 8n, 0n].map((shift) => Number((ip.value >> shift) & 0xffn)).join('.');
  }

  const groups = [];
  for (let index = 7; index >= 0; index -= 1) groups.push(Number((ip.value >> BigInt(index * 16)) & 0xffffn));

  // ย่อช่วงศูนย์ที่ยาวที่สุด (ต้องยาว ≥ 2) ด้วย ::
  let bestStart = -1;
  let bestLength = 0;
  let currentStart = -1;
  let currentLength = 0;
  for (let index = 0; index < 8; index += 1) {
    if (groups[index] === 0) {
      if (currentStart === -1) currentStart = index;
      currentLength += 1;
      if (currentLength > bestLength) {
        bestLength = currentLength;
        bestStart = currentStart;
      }
    } else {
      currentStart = -1;
      currentLength = 0;
    }
  }

  if (bestLength < 2) return groups.map((group) => group.toString(16)).join(':');

  const head = groups
    .slice(0, bestStart)
    .map((group) => group.toString(16))
    .join(':');
  const tail = groups
    .slice(bestStart + bestLength)
    .map((group) => group.toString(16))
    .join(':');
  return `${head}::${tail}`;
}

/** แปลงกฎ 1 ข้อ ("ip" หรือ "ip/prefix") → { version, bits, prefix, network } หรือ null */
export function parseIpRule(raw) {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (text === '') return null;

  const slash = text.lastIndexOf('/');
  let address = text;
  let prefix = null;
  if (slash !== -1) {
    address = text.slice(0, slash);
    const prefixText = text.slice(slash + 1);
    if (!/^\d{1,3}$/.test(prefixText)) return null;
    prefix = Number(prefixText);
  }

  const ip = normalizeIp(address);
  if (!ip) return null;

  const effective = prefix === null ? ip.bits : prefix;
  if (effective < 0 || effective > ip.bits) return null;

  return {
    version: ip.version,
    bits: ip.bits,
    prefix: effective,
    network: ip.value & prefixMask(ip.bits, effective),
  };
}

/** client IP นี้ผ่านกฎหรือไม่ (ไม่มีกฎ = ผ่านทุก IP) */
export function isIpAllowed(clientIp, rules) {
  const list = Array.isArray(rules)
    ? rules.filter((rule) => typeof rule === 'string' && rule.trim() !== '')
    : [];
  if (list.length === 0) return true;

  const ip = normalizeIp(clientIp);
  if (!ip) return false;

  return list.some((rule) => {
    const parsed = parseIpRule(rule);
    if (!parsed || parsed.version !== ip.version) return false;
    return (ip.value & prefixMask(parsed.bits, parsed.prefix)) === parsed.network;
  });
}

/** ตรวจรายการกฎที่ครูส่งมา → คืนข้อความ error หรือ null ถ้าผ่าน (รายการซ้ำตัดทิ้งเงียบ ๆ ตอน normalize) */
export function validateIpRules(rules) {
  if (!Array.isArray(rules)) return 'allowedIpRanges ต้องเป็นรายการ (array)';
  if (rules.length > MAX_IP_RULES) return `กำหนดได้สูงสุด ${MAX_IP_RULES} รายการ`;

  for (const rule of rules) {
    if (typeof rule !== 'string') return 'แต่ละรายการต้องเป็นข้อความ';
    const text = rule.trim();
    if (text === '') return 'ห้ามมีรายการว่าง';
    if (text.length > MAX_IP_RULE_LENGTH) return `แต่ละรายการยาวได้ไม่เกิน ${MAX_IP_RULE_LENGTH} ตัวอักษร`;
    if (!parseIpRule(text)) return `รูปแบบ IP/CIDR ไม่ถูกต้อง: "${text}"`;
  }
  return null;
}

/** ตัดช่องว่าง + ตัดรายการซ้ำ ก่อนบันทึก */
export function normalizeIpRules(rules) {
  if (!Array.isArray(rules)) return [];

  const result = [];
  const seen = new Set();
  for (const rule of rules) {
    const text = String(rule).trim();
    if (text === '' || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

/** ดึง client IP จาก request (ใช้ req.ip ของ Express — ถูกต้องตาม trust proxy ที่ตั้งไว้) */
export function getClientIp(req) {
  const ip = req?.ip ?? req?.socket?.remoteAddress ?? '';
  return typeof ip === 'string' ? ip : '';
}
