import { extname } from 'node:path';
import { parse as parseCsv } from 'csv-parse/sync';
import { ApiError } from './errors.js';

/**
 * ตัวช่วยอ่านไฟล์ตาราง (CSV / .xlsx) ที่ใช้ร่วมกัน
 * ระหว่างการนำเข้าข้อคำถามและการนำเข้ารายชื่อนักเรียน
 * - ไฟล์นี้ทำหน้าที่แค่ "แปลงไฟล์ → array ของแถว" ไม่รู้จักความหมายของคอลัมน์
 *   ชั้นที่เรียกจึงเป็นคนตรวจหัวตารางและข้อมูลเอง
 */

/**
 * ถอดรหัสไฟล์ CSV
 * Excel ภาษาไทยมักบันทึกเป็น ANSI (cp874/windows-874) ทำให้ภาษาไทยเพี้ยนถ้าอ่านเป็น UTF-8
 * จึงลอง UTF-8 แบบเข้มก่อน ถ้าไม่ผ่านค่อยตกไปที่ windows-874
 */
export function decodeCsvBuffer(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.subarray(3).toString('utf8');
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    try {
      return new TextDecoder('windows-874').decode(buffer);
    } catch {
      return buffer.toString('utf8');
    }
  }
}

async function parseXlsxRows(buffer) {
  // import แบบ dynamic เพื่อไม่ให้ exceljs ถูกโหลดตอนไม่ได้ใช้ endpoint นี้
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();

  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw ApiError.badRequest('อ่านไฟล์ Excel ไม่สำเร็จ — ไฟล์อาจเสียหายหรือไม่ใช่ .xlsx');
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const rows = [];
  sheet.eachRow({ includeEmpty: true }, (row) => {
    const cells = [];
    const width = Math.max(row.cellCount, 1);
    for (let column = 1; column <= width; column += 1) {
      cells.push(row.getCell(column).text ?? '');
    }
    rows.push(cells);
  });

  return rows;
}

/** แปลงไฟล์ → ตาราง (array ของแถว) ตามนามสกุลไฟล์ */
export async function parseTabularFileRows(buffer, filename) {
  const ext = extname(filename ?? '').toLowerCase();

  if (ext === '.csv') {
    try {
      return parseCsv(decodeCsvBuffer(buffer), {
        bom: true,
        trim: true,
        relax_column_count: true,
        relax_quotes: true,
        skip_empty_lines: false,
      });
    } catch (error) {
      throw ApiError.badRequest(`อ่านไฟล์ CSV ไม่สำเร็จ: ${error.message}`);
    }
  }

  if (ext === '.xlsx') return parseXlsxRows(buffer);

  throw ApiError.badRequest('รองรับเฉพาะไฟล์ .csv และ .xlsx (.xls แบบเก่ายังไม่รองรับ)');
}
