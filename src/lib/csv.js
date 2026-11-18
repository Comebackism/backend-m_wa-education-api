/**
 * ตัวช่วยสร้าง CSV ที่ปลอดภัยสำหรับเปิดใน Excel / Google Sheets
 * - RFC 4180: ครอบด้วย " เมื่อมี , " หรือขึ้นบรรทัดใหม่ และ escape " เป็น ""
 * - CSV injection: ค่าที่ขึ้นต้นด้วย = + - @ TAB CR จะถูกเติม ' นำหน้า
 *   เพื่อไม่ให้ Excel ตีความเป็นสูตร (formula) แล้วรันโค้ดจากข้อมูลที่ผู้ใช้กรอก
 * - toCsv เติม BOM (U+FEFF) ให้ Excel อ่าน UTF-8 (ภาษาไทย) ได้ถูกต้อง
 */

const FORMULA_PREFIX = /^[=+\-@\t\r]/;

export function csvCell(value) {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (FORMULA_PREFIX.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(headers, rows, { bom = true } = {}) {
  const lines = [headers, ...rows].map((row) => row.map(csvCell).join(','));
  return `${bom ? '\uFEFF' : ''}${lines.join('\r\n')}\r\n`;
}
