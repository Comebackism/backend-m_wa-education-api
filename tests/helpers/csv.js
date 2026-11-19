/**
 * ตัวช่วยสร้างไฟล์ CSV / .xlsx สำหรับเทสต์นำเข้า
 */

/** แปลงตาราง (array ของแถว) เป็น CSV ตาม RFC 4180 */
export function toCsvRows(rows, { bom = false } = {}) {
  const body = rows
    .map((row) =>
      row
        .map((cell) => {
          const text = String(cell ?? '');
          return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
        })
        .join(','),
    )
    .join('\r\n');
  return `${bom ? '\uFEFF' : ''}${body}`;
}

/**
 * แปลงข้อความเป็น windows-874 (CP874) — ใช้ทดสอบ CSV ที่ Excel ภาษาไทยบันทึกออกมา
 * ตัวอักษรที่ map ไม่ได้จะถูกแทนด้วย '?'
 */
export function encodeCp874(text) {
  const decoder = new TextDecoder('windows-874');
  const table = new Map();
  for (let byte = 0; byte < 256; byte += 1) {
    const char = decoder.decode(Uint8Array.of(byte));
    if (char && !table.has(char)) table.set(char, byte);
  }

  const bytes = [];
  for (const char of String(text)) {
    if (char === '\n') bytes.push(0x0a);
    else if (char === '\r') bytes.push(0x0d);
    else if (char === ',') bytes.push(0x2c);
    else bytes.push(table.get(char) ?? 0x3f);
  }
  return Buffer.from(bytes);
}

/** สร้างไฟล์ .xlsx จากตาราง (array ของแถว) */
export async function buildXlsxBuffer(rows) {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('sheet1');
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}