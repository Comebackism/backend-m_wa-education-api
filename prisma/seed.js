import 'dotenv/config';
import { hash } from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });
const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS ?? 10);

const DEFAULT_CUTOFFS = [
  { grade: 'A', minPercent: 80 },
  { grade: 'B+', minPercent: 75 },
  { grade: 'B', minPercent: 70 },
  { grade: 'C+', minPercent: 65 },
  { grade: 'C', minPercent: 60 },
  { grade: 'D+', minPercent: 55 },
  { grade: 'D', minPercent: 50 },
  { grade: 'F', minPercent: 0 },
];

const TEACHER = { email: 'teacher@demo.local', password: 'Teacher123!', fullName: 'ครูสมชาย ใจดี' };
const STUDENTS = [
  { email: 'student1@demo.local', password: 'Student123!', fullName: 'สมหญิง เรียนดี', studentCode: 'S001' },
  { email: 'student2@demo.local', password: 'Student123!', fullName: 'สมปอง ขยันดี', studentCode: 'S002' },
  { email: 'student3@demo.local', password: 'Student123!', fullName: 'สมศรี ตั้งใจ', studentCode: 'S003' },
];
/// บัญชีผู้ดูแล: เข้าสู่ระบบได้ทั้งช่องทางนักเรียนและครู
const ADMIN = { email: 'foqw007100@gmail.com', password: 'wa1234', fullName: 'ผู้ดูแลระบบ (เดโม)' };

const JOIN_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomJoinCode(length = 6) {
  let code = '';
  for (let index = 0; index < length; index += 1) {
    code += JOIN_CODE_ALPHABET[Math.floor(Math.random() * JOIN_CODE_ALPHABET.length)];
  }
  return code;
}

function daysFromNow(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

async function main() {
  const existingTeacher = await prisma.user.findUnique({ where: { email: TEACHER.email } });
  if (existingTeacher) {
    console.log('[seed] demo data already exists — skipping (use `npm run reset` to start over)');
    return;
  }

  // 1) users ------------------------------------------------------------------
  const teacher = await prisma.user.create({
    data: {
      email: TEACHER.email,
      passwordHash: await hash(TEACHER.password, BCRYPT_ROUNDS),
      fullName: TEACHER.fullName,
      role: 'TEACHER',
    },
  });

  const students = [];
  for (const student of STUDENTS) {
    students.push(
      await prisma.user.create({
        data: {
          email: student.email,
          passwordHash: await hash(student.password, BCRYPT_ROUNDS),
          fullName: student.fullName,
          studentCode: student.studentCode,
          role: 'STUDENT',
        },
      }),
    );
  }

  // 2) บัญชีผู้ดูแล (เข้าได้ทั้งนักเรียนและครู) --------------------------------
  const admin = await prisma.user.create({
    data: {
      email: ADMIN.email,
      passwordHash: await hash(ADMIN.password, BCRYPT_ROUNDS),
      fullName: ADMIN.fullName,
      role: 'ADMIN',
    },
  });

  // 3) classrooms — ไม่ผูกกับรายวิชา: ม.1/1–ม.6/3 (ระดับละ 3 ห้อง = 18 ห้อง) -->
  const usedCodes = new Set(['MATH41']);
  const uniqueJoinCode = () => {
    let code = randomJoinCode();
    while (usedCodes.has(code)) code = randomJoinCode();
    usedCodes.add(code);
    return code;
  };

  const classrooms = [];
  for (let level = 1; level <= 6; level += 1) {
    for (let section = 1; section <= 3; section += 1) {
      const name = `ม.${level}/${section}`;
      classrooms.push(
        await prisma.classroom.create({
          data: {
            name,
            // คงรหัสเดิมของห้อง ม.4/1 ไว้ให้ตรงกับเอกสาร/เดโม
            joinCode: name === 'ม.4/1' ? 'MATH41' : uniqueJoinCode(),
            courseId: null,
            teacherId: teacher.id,
          },
        }),
      );
    }
  }

  const classroom = classrooms.find((room) => room.name === 'ม.4/1');

  for (const student of [...students, admin]) {
    await prisma.enrollment.create({ data: { classroomId: classroom.id, studentId: student.id } });
  }

  // 4) exam + questions + cutoffs + assignment -------------------------------
  const exam = await prisma.exam.create({
    data: {
      title: 'สอบกลางภาค คณิตศาสตร์ ม.4',
      description: 'ครอบคลุมบทที่ 1–3 จำนวน 5 ข้อ (จำกัดเวลา 60 นาที)',
      status: 'PUBLISHED',
      teacherId: teacher.id,
      courseId: null,
      timeLimitMinutes: 60,
      defaultDisplayMode: 'PAGINATED',
      questionsPerPage: 3,
      totalsPoints: 10,
    },
  });

  const q1 = await prisma.question.create({
    data: {
      examId: exam.id,
      type: 'MULTIPLE_CHOICE',
      prompt: 'ข้อใดไม่ใช่จำนวนอตรรกยะ?',
      points: 2,
      order: 1,
      explanation: '22/7 เป็นจำนวนตรรกยะ (เศษส่วนของจำนวนเต็ม) ส่วน √2, π และ e เป็นจำนวนอตรรกยะ',
      choices: {
        create: [
          { label: 'A', text: '√2', isCorrect: false, order: 0 },
          { label: 'B', text: 'π', isCorrect: false, order: 1 },
          { label: 'C', text: '22/7', isCorrect: true, order: 2 },
          { label: 'D', text: 'e', isCorrect: false, order: 3 },
        ],
      },
    },
    include: { choices: true },
  });

  const q2 = await prisma.question.create({
    data: {
      examId: exam.id,
      type: 'MULTIPLE_CHOICE',
      prompt: 'ค่าของ |−7| + |3| เท่ากับเท่าใด?',
      points: 2,
      order: 2,
      explanation: '|−7| = 7 และ |3| = 3 ดังนั้น 7 + 3 = 10',
      choices: {
        create: [
          { label: 'A', text: '−4', isCorrect: false, order: 0 },
          { label: 'B', text: '4', isCorrect: false, order: 1 },
          { label: 'C', text: '10', isCorrect: true, order: 2 },
          { label: 'D', text: '−10', isCorrect: false, order: 3 },
        ],
      },
    },
    include: { choices: true },
  });

  const q3 = await prisma.question.create({
    data: {
      examId: exam.id,
      type: 'MULTIPLE_CHOICE',
      prompt: 'จำนวนใดเป็นจำนวนเฉพาะ?',
      points: 2,
      order: 3,
      explanation: '17 ไม่มีตัวหารร่วมอื่นนอกจาก 1 และ 17',
      choices: {
        create: [
          { label: 'A', text: '1', isCorrect: false, order: 0 },
          { label: 'B', text: '9', isCorrect: false, order: 1 },
          { label: 'C', text: '15', isCorrect: false, order: 2 },
          { label: 'D', text: '17', isCorrect: true, order: 3 },
        ],
      },
    },
    include: { choices: true },
  });

  const q4 = await prisma.question.create({
    data: {
      examId: exam.id,
      type: 'SHORT_ANSWER',
      prompt: 'จงหาค่า x จากสมการ 2x + 6 = 0',
      points: 2,
      order: 4,
      referenceText: 'x = −3',
      explanation: '2x = −6 → x = −3',
    },
  });

  const q5 = await prisma.question.create({
    data: {
      examId: exam.id,
      type: 'LONG_ANSWER',
      prompt: 'จงอธิบายทฤษฎีบทพีทาโกรัส พร้อมยกตัวอย่างการนำไปใช้ 1 ตัวอย่าง',
      points: 2,
      order: 5,
      referenceText: 'ในสามเหลี่ยมมุมฉาก a² + b² = c² เมื่อ c เป็นด้านตรงข้ามมุมฉาก เช่น 3-4-5 → 9 + 16 = 25',
    },
  });

  await prisma.gradeCutoff.createMany({
    data: DEFAULT_CUTOFFS.map((cutoff) => ({ examId: exam.id, ...cutoff })),
  });

  await prisma.examAssignment.create({
    data: {
      examId: exam.id,
      classroomId: classroom.id,
      availableFrom: daysFromNow(-1),
      availableTo: daysFromNow(7),
    },
  });

  // 5) ตัวอย่างการส่งข้อสอบที่ตรวจแล้ว + ปล่อยผลแล้ว -------------------------
  const student1 = students[0];
  const submission = await prisma.submission.create({
    data: {
      examId: exam.id,
      studentId: student1.id,
      status: 'IN_PROGRESS',
      displayMode: 'PAGINATED',
      startedAt: daysFromNow(-1),
      expiresAt: daysFromNow(-1),
    },
  });

  const correct = (question) => question.choices.find((choice) => choice.isCorrect).id;
  const wrong = (question) => question.choices.find((choice) => !choice.isCorrect).id;

  await prisma.answer.createMany({
    data: [
      // ปรนัย → ตรวจอัตโนมัติ
      { submissionId: submission.id, questionId: q1.id, choiceId: correct(q1), isCorrect: true, autoGraded: true, awardedPoints: 2 },
      { submissionId: submission.id, questionId: q2.id, choiceId: wrong(q2), isCorrect: false, autoGraded: true, awardedPoints: 0 },
      { submissionId: submission.id, questionId: q3.id, choiceId: correct(q3), isCorrect: true, autoGraded: true, awardedPoints: 2 },
      // อัตนัย → ครูตรวจเอง
      {
        submissionId: submission.id,
        questionId: q4.id,
        textAnswer: 'x = -3',
        isCorrect: true,
        autoGraded: false,
        awardedPoints: 2,
        graderComment: 'ถูกต้อง ตอบ −3 ได้ แต่ควรเขียนแสดงวิธีทำทีละขั้น',
        gradedById: teacher.id,
        gradedAt: daysFromNow(0),
      },
      {
        submissionId: submission.id,
        questionId: q5.id,
        textAnswer: 'a² + b² = c² ใช้หาความยาวด้านในสามเหลี่ยมมุมฉาก เช่น 3-4-5',
        isCorrect: true,
        autoGraded: false,
        awardedPoints: 1,
        graderComment: 'อธิบายสูตรถูกต้อง แต่ตัวอย่างยังไม่แสดงการแทนค่าเป็นตัวเลข',
        gradedById: teacher.id,
        gradedAt: daysFromNow(0),
      },
    ],
  });

  // totalScore = 2 + 0 + 2 + 2 + 1 = 7 / 10 = 70% → B
  await prisma.submission.update({
    where: { id: submission.id },
    data: {
      status: 'RELEASED',
      submittedAt: daysFromNow(-1),
      gradedAt: daysFromNow(0),
      releasedAt: daysFromNow(0),
      autoScore: 4,
      manualScore: 3,
      totalScore: 7,
      percent: 70,
      grade: 'B',
    },
  });

  console.log('[seed] demo data created');
  console.log(`   ครู      : ${TEACHER.email} / ${TEACHER.password}`);
  console.log(`   ผู้ดูแล   : ${ADMIN.email} / ${ADMIN.password} (เข้าได้ทั้งนักเรียนและครู)`);
  console.log(`   นักเรียน : ${STUDENTS[0].email} / ${STUDENTS[0].password} (มีผลสอบที่ปล่อยแล้ว)`);
  console.log(`   นักเรียน : ${STUDENTS[1].email} / ${STUDENTS[1].password}`);
  console.log(`   นักเรียน : ${STUDENTS[2].email} / ${STUDENTS[2].password}`);
  console.log(`   ห้องเรียน : ${classrooms.map((room) => room.name).join(', ')} (${classrooms.length} ห้อง, ไม่ผูกวิชา)`);
  console.log(`   รหัสเข้าห้อง ม.4/1: ${classroom.joinCode}`);
}

main()
  .catch((error) => {
    console.error('[seed] failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
