import { decodeCsvBuffer, parseTabularFileRows } from './tabularFile.js';

// ตัวช่วยอ่านไฟล์ CSV/.xlsx ถูกย้ายไป ./tabularFile.js แล้ว
// re-export ไว้เพื่อไม่ให้โค้ด/เทสต์เดิมที่ import จากไฟล์นี้พัง
export { decodeCsvBuffer };
export { parseTabularFileRows as parseQuestionFileRows };

/**
 * นำเข้าข้อคำถามจากไฟล์ CSV / Excel (.xlsx)
 *
 * รูปแบบไฟล์: 1 แถว = 1 ข้อ ความกว้างคงที่ (ไม่ใช่ 1 แถวต่อ 1 ตัวเลือก)
 *   ประเภท | โจทย์ | คะแนน | ตัวเลือก A | ตัวเลือก B | ตัวเลือก C | ตัวเลือก D | เฉลย | คำตอบอ้างอิง | คำอธิบาย
 *
 * - ไฟล์นี้ทำหน้าที่แค่ "แปลง + ตรวจ" ให้เป็น object ที่ service เอาไปสร้างได้
 *   ไม่แตะ DB เลย จึงทดสอบแยกได้ง่าย
 * - ตรวจทุกแถวก่อน ถ้ามีที่ผิดจะคืน error พร้อมเลขแถวทั้งหมด (ไม่นำเข้าบางส่วน)
 */

export const MAX_IMPORT_QUESTIONS = 500;

/** คอลัมน์ของแม่แบบ (ลำดับเดียวกับที่ buildQuestionImportTemplateCsv สร้าง) */
export const QUESTION_IMPORT_HEADERS = [
  'ประเภท',
  'โจทย์',
  'คะแนน',
  'ตัวเลือก A',
  'ตัวเลือก B',
  'ตัวเลือก C',
  'ตัวเลือก D',
  'เฉลย',
  'คำตอบอ้างอิง',
  'คำอธิบาย',
];

/** ชื่อคอลัมน์ที่ยอมรับ (ไทย/อังกฤษ) — เทียบแบบ normalize แล้ว */
const HEADER_ALIASES = {
  type: ['ประเภท', 'type', 'ชนิดข้อ', 'ชนิดข้อสอบ', 'รูปแบบ'],
  prompt: ['โจทย์', 'คำถาม', 'prompt', 'question'],
  points: ['คะแนน', 'points', 'คะแนนเต็ม', 'คะแนนข้อนี้'],
  a: ['ตัวเลือก a', 'a', 'choice a', 'choicea', 'ตัวเลือกa'],
  b: ['ตัวเลือก b', 'b', 'choice b', 'choiceb', 'ตัวเลือกb'],
  c: ['ตัวเลือก c', 'c', 'choice c', 'choicec', 'ตัวเลือกc'],
  d: ['ตัวเลือก d', 'd', 'choice d', 'choiced', 'ตัวเลือกd'],
  correct: ['เฉลย', 'correct', 'correct choice', 'correctchoice', 'คำตอบที่ถูก'],
  referenceText: ['คำตอบอ้างอิง', 'referencetext', 'reference', 'แนวคำตอบ'],
  explanation: ['คำอธิบาย', 'explanation', 'คำอธิบายเฉลย'],
};

/** ป้ายชื่อคอลัมน์สำหรับข้อความ error */
const COLUMN_LABEL = {
  prompt: 'โจทย์',
  points: 'คะแนน',
};

/** ค่าที่ใส่ในคอลัมน์ "ประเภท" ได้ (ไทย/อังกฤษ) */
const TYPE_LABELS = new Map([
  ['multiple_choice', 'MULTIPLE_CHOICE'],
  ['multiplechoice', 'MULTIPLE_CHOICE'],
  ['mcq', 'MULTIPLE_CHOICE'],
  ['ปรนัย', 'MULTIPLE_CHOICE'],
  ['เลือกตอบ', 'MULTIPLE_CHOICE'],
  ['ตัวเลือก', 'MULTIPLE_CHOICE'],
  ['short_answer', 'SHORT_ANSWER'],
  ['shortanswer', 'SHORT_ANSWER'],
  ['อัตนัย', 'SHORT_ANSWER'],
  ['ตอบสั้น', 'SHORT_ANSWER'],
  ['อัตนัยสั้น', 'SHORT_ANSWER'],
  ['long_answer', 'LONG_ANSWER'],
  ['longanswer', 'LONG_ANSWER'],
  ['อัตนัยยาว', 'LONG_ANSWER'],
  ['ตอบยาว', 'LONG_ANSWER'],
  ['บรรยาย', 'LONG_ANSWER'],
]);

const CHOICE_KEYS = ['a', 'b', 'c', 'd'];
const MAX_PROMPT_LENGTH = 20000;
const MAX_POINTS = 1000;

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
  return String(value).replace(/\u00a0/g, ' ').trim();
}

/** อ่านไฟล์ → ตรวจ → ได้รายการข้อคำถามที่พร้อมสร้าง */
export async function readQuestionImportFile(buffer, filename) {
  const rows = await parseTabularFileRows(buffer, filename);
  return rowsToQuestions(rows);
}
/**
 * แปลงตาราง → รายการข้อคำถาม พร้อม error ระดับแถว
 * @returns {{ questions: Array, errors: Array<{row:number, message:string}> }}
 */
export function rowsToQuestions(rows) {
  const errors = [];
  if (!Array.isArray(rows) || rows.length === 0) {
    return { questions: [], errors: [{ row: 0, message: 'ไฟล์ว่างเปล่า' }] };
  }

  const headerIndex = rows.findIndex((row) => !isEmptyRow(row));
  if (headerIndex === -1) {
    return { questions: [], errors: [{ row: 0, message: 'ไม่พบหัวตารางในไฟล์' }] };
  }

  // จับคู่ "ชื่อคอลัมน์ → ลำดับคอลัมน์"
  const columnIndex = new Map();
  rows[headerIndex].forEach((cell, index) => {
    const key = HEADER_LOOKUP.get(norm(cell));
    if (key && !columnIndex.has(key)) columnIndex.set(key, index);
  });

  for (const key of ['prompt', 'points']) {
    if (!columnIndex.has(key)) {
      errors.push({ row: headerIndex + 1, message: `ไม่พบคอลัมน์ "${COLUMN_LABEL[key]}" ในหัวตาราง` });
    }
  }
  if (errors.length > 0) return { questions: [], errors };

  const dataRows = [];
  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    if (isEmptyRow(rows[index])) continue;
    dataRows.push({ rowNumber: index + 1, cells: rows[index] });
  }

  if (dataRows.length === 0) {
    return { questions: [], errors: [{ row: headerIndex + 1, message: 'ไม่พบแถวข้อมูลใต้หัวตาราง' }] };
  }
  if (dataRows.length > MAX_IMPORT_QUESTIONS) {
    return {
      questions: [],
      errors: [
        {
          row: headerIndex + 1,
          message: `นำเข้าได้สูงสุด ${MAX_IMPORT_QUESTIONS} ข้อต่อครั้ง (พบ ${dataRows.length} แถว)`,
        },
      ],
    };
  }

  const questions = [];

  for (const { rowNumber, cells } of dataRows) {
    const read = (key) => (columnIndex.has(key) ? cells[columnIndex.get(key)] : '');
    const problems = [];

    // --- ประเภท -----------------------------------------------------------
    const rawType = cellText(read('type'));
    let type = TYPE_LABELS.get(norm(rawType)) ?? null;
    if (rawType && !type) {
      problems.push(`ไม่รู้จักประเภท "${rawType}" (ใช้ ปรนัย / อัตนัย / อัตนัยยาว หรือ MULTIPLE_CHOICE / SHORT_ANSWER / LONG_ANSWER)`);
    }

    // --- โจทย์ -------------------------------------------------------------
    const prompt = cellText(read('prompt'));
    if (!prompt) problems.push('ต้องระบุโจทย์');
    else if (prompt.length > MAX_PROMPT_LENGTH) problems.push(`โจทย์ยาวเกิน ${MAX_PROMPT_LENGTH} ตัวอักษร`);

    // --- คะแนน -------------------------------------------------------------
    const rawPoints = cellText(read('points')).replace(/,/g, '.');
    let points = null;
    if (!rawPoints) {
      problems.push('ต้องระบุคะแนน');
    } else {
      points = Number(rawPoints);
      if (!Number.isFinite(points) || points <= 0) problems.push('คะแนนต้องเป็นตัวเลขมากกว่า 0');
      else if (points > MAX_POINTS) problems.push(`คะแนนต้องไม่เกิน ${MAX_POINTS}`);
    }

    // --- ตัวเลือก -----------------------------------------------------------
    const choices = CHOICE_KEYS.map((key, index) => ({
      label: String.fromCharCode(65 + index),
      text: cellText(read(key)),
    })).filter((choice) => choice.text !== '');

    // ไม่ระบุประเภท → เดาจากข้อมูลที่มี (มีตัวเลือก = ปรนัย, ไม่มี = อัตนัย)
    if (!type) type = choices.length > 0 ? 'MULTIPLE_CHOICE' : 'SHORT_ANSWER';

    // --- เฉลย (เฉพาะปรนัย) ---------------------------------------------------
    if (type === 'MULTIPLE_CHOICE') {
      if (choices.length < 2) {
        problems.push('ข้อปรนัยต้องมีตัวเลือกอย่างน้อย 2 ตัวเลือก (คอลัมน์ "ตัวเลือก A"–"ตัวเลือก D")');
      }

      const rawCorrect = cellText(read('correct')).toUpperCase();
      if (!rawCorrect) {
        problems.push('ข้อปรนัยต้องระบุเฉลย (A, B, C หรือ D)');
      } else if (!choices.some((choice) => choice.label === rawCorrect)) {
        problems.push(`เฉลย "${cellText(read('correct'))}" ไม่ตรงกับตัวเลือกที่มี (${choices.map((c) => c.label).join(', ') || 'ไม่มี'})`);
      }

      for (const choice of choices) choice.isCorrect = choice.label === rawCorrect;
    }

    // --- ฟิลด์เสริม ---------------------------------------------------------
    const referenceText = cellText(read('referenceText')) || null;
    const explanation = cellText(read('explanation')) || null;
    if (referenceText && referenceText.length > MAX_PROMPT_LENGTH) problems.push('คำตอบอ้างอิงยาวเกินกำหนด');
    if (explanation && explanation.length > MAX_PROMPT_LENGTH) problems.push('คำอธิบายยาวเกินกำหนด');

    if (problems.length > 0) {
      errors.push({ row: rowNumber, message: problems.join(' • ') });
      continue;
    }

    questions.push({
      type,
      prompt,
      points,
      referenceText,
      explanation,
      ...(type === 'MULTIPLE_CHOICE'
        ? { choices: choices.map((choice, index) => ({ ...choice, order: index })) }
        : {}),
    });
  }

  return { questions, errors };
}
