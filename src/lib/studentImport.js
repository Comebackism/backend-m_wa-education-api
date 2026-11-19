import { parseTabularFileRows } from './tabularFile.js';

/**
 * นำเข้ารายชื่อนักเรียนจากไฟล์ CSV / Excel (.xlsx)
 *
 * รูปแบบไฟล์: 1 แถว = 1 นักเรียน
 *   รหัสนักเรียน | ชื่อ-นามสกุล | อีเมล | รหัสผ่าน
 *
 * - ไฟล์นี้ทำหน้าที่แค่ "แปลง + ตรวจ" ให้เป็น object ที่ service เอาไปสร้างได้
 *   ไม่แตะ DB เลย จึงทดสอบแยกได้ง่าย
 * - ตรวจทุกแถวก่อน ถ้ามีที่ผิดจะคืน error พร้อมเลขแถวทั้งหมด (ไม่นำเข้าบางส่วน)
 */

export const MAX_IMPORT_STUDENTS = 500;

/** คอลัมน์ของแม่แบบ (ลำดับเดียวกับที่ buildStudentRosterTemplateCsv สร้าง) */
export const STUDENT_IMPORT_HEADERS = ['รหัสนักเรียน', 'ชื่อ-นามสกุล', 'อีเมล', 'รหัสผ่าน'];

/** ชื่อคอลัมน์ที่ยอมรับ (ไทย/อังกฤษ) — เทียบแบบ normalize แล้ว */
const HEADER_ALIASES = {
  studentCode: ['รหัสนักเรียน', 'studentcode', 'student code', 'รหัส', 'code'],
  fullName: ['ชื่อ-นามสกุล', 'ชื่อ - นามสกุล', 'ชื่อ-สกุล', 'ชื่อ สกุล', 'fullname', 'full name', 'name', 'ชื่อ'],
  email: ['อีเมล', 'อีเมล์', 'email', 'e-mail'],
  password: ['รหัสผ่าน', 'password', 'pass'],
};

/** ป้ายชื่อคอลัมน์สำหรับข้อความ error */
const COLUMN_LABEL = {
  fullName: 'ชื่อ-นามสกุล',
  email: 'อีเมล',
};

const MAX_NAME_LENGTH = 200;
const MAX_CODE_LENGTH = 50;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 72;

// ตรวจแบบหลวม ๆ พอ: มี @ หนึ่งตัว และมีจุดในโดเมน (ตรงกับที่ backend รับได้จริง)
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** normalize หัวคอลัมน์: trim + lowercase + ยุบช่องว่าง + แปลง NBSP */
function norm(value) {
  return String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

const HEADER_LOOKUP = new Map();
for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
  for (const alias of aliases) HEADER_LOOKUP.set(norm(alias), key);
}

function isEmptyRow(row) {
  return !row || row.every((cell) => norm(cell) === '');
}

function cellText(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/\u00a0/g, ' ')
    .trim();
}

/**
 * แปลงตาราง → รายชื่อนักเรียน พร้อม error ระดับแถว
 * @returns {{ students: Array, errors: Array<{row:number, message:string}> }}
 */
export function rowsToStudents(rows) {
  const errors = [];
  if (!Array.isArray(rows) || rows.length === 0) {
    return { students: [], errors: [{ row: 0, message: 'ไฟล์ว่างเปล่า' }] };
  }

  const headerIndex = rows.findIndex((row) => !isEmptyRow(row));
  if (headerIndex === -1) {
    return { students: [], errors: [{ row: 0, message: 'ไม่พบหัวตารางในไฟล์' }] };
  }

  // จับคู่ "ชื่อคอลัมน์ → ลำดับคอลัมน์"
  const columnIndex = new Map();
  rows[headerIndex].forEach((cell, index) => {
    const key = HEADER_LOOKUP.get(norm(cell));
    if (key && !columnIndex.has(key)) columnIndex.set(key, index);
  });

  for (const key of ['fullName', 'email']) {
    if (!columnIndex.has(key)) {
      errors.push({ row: headerIndex + 1, message: `ไม่พบคอลัมน์ "${COLUMN_LABEL[key]}" ในหัวตาราง` });
    }
  }
  if (errors.length > 0) return { students: [], errors };

  const dataRows = [];
  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    if (isEmptyRow(rows[index])) continue;
    dataRows.push({ rowNumber: index + 1, cells: rows[index] });
  }

  if (dataRows.length === 0) {
    return { students: [], errors: [{ row: headerIndex + 1, message: 'ไม่พบแถวข้อมูลใต้หัวตาราง' }] };
  }
  if (dataRows.length > MAX_IMPORT_STUDENTS) {
    return {
      students: [],
      errors: [
        {
          row: headerIndex + 1,
          message: `นำเข้าได้สูงสุด ${MAX_IMPORT_STUDENTS} คนต่อครั้ง (พบ ${dataRows.length} แถว)`,
        },
      ],
    };
  }

  const students = [];
  const seenEmails = new Map();
  const seenCodes = new Map();

  for (const { rowNumber, cells } of dataRows) {
    const read = (key) => (columnIndex.has(key) ? cells[columnIndex.get(key)] : '');
    const problems = [];

    // --- ชื่อ-นามสกุล -------------------------------------------------------
    const fullName = cellText(read('fullName'));
    if (!fullName) problems.push('ต้องระบุชื่อ-นามสกุล');
    else if (fullName.length > MAX_NAME_LENGTH) problems.push(`ชื่อ-นามสกุลยาวเกิน ${MAX_NAME_LENGTH} ตัวอักษร`);

    // --- อีเมล --------------------------------------------------------------
    const email = cellText(read('email')).toLowerCase();
    if (!email) problems.push('ต้องระบุอีเมล');
    else if (email.length > 200) problems.push('อีเมลยาวเกิน 200 ตัวอักษร');
    else if (!EMAIL_PATTERN.test(email)) problems.push(`อีเมล "${email}" ไม่ถูกต้อง`);

    // --- รหัสนักเรียน (เว้นว่างได้) -------------------------------------------
    const studentCode = cellText(read('studentCode'));
    if (studentCode.length > MAX_CODE_LENGTH) problems.push(`รหัสนักเรียนยาวเกิน ${MAX_CODE_LENGTH} ตัวอักษร`);

    // --- รหัสผ่าน (เว้นว่างได้ → ระบบสุ่มให้) --------------------------------
    const password = cellText(read('password'));
    if (password) {
      if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
        problems.push(`รหัสผ่านต้องยาว ${MIN_PASSWORD_LENGTH}–${MAX_PASSWORD_LENGTH} ตัวอักษร`);
      } else if (studentCode && password === studentCode) {
        problems.push('รหัสผ่านต้องไม่ซ้ำกับรหัสนักเรียน');
      }
    }

    // --- ซ้ำกันภายในไฟล์เดียวกัน ---------------------------------------------
    if (email && seenEmails.has(email)) {
      problems.push(`อีเมล "${email}" ซ้ำกับแถวที่ ${seenEmails.get(email)}`);
    }
    if (studentCode && seenCodes.has(studentCode)) {
      problems.push(`รหัสนักเรียน "${studentCode}" ซ้ำกับแถวที่ ${seenCodes.get(studentCode)}`);
    }

    if (problems.length > 0) {
      errors.push({ row: rowNumber, message: problems.join(' • ') });
      continue;
    }

    seenEmails.set(email, rowNumber);
    if (studentCode) seenCodes.set(studentCode, rowNumber);

    students.push({
      rowNumber,
      studentCode: studentCode || null,
      fullName,
      email,
      password: password || null,
    });
  }

  return { students, errors };
}

/** อ่านไฟล์ → ตรวจ → ได้รายชื่อนักเรียนที่พร้อมสร้าง */
export async function readStudentRosterFile(buffer, filename) {
  const rows = await parseTabularFileRows(buffer, filename);
  return rowsToStudents(rows);
}
