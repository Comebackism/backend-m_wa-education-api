/**
 * Smoke test ชั้น realtime (Socket.IO) — รันได้ด้วย `npm run test:realtime`
 *
 * ต้องมีเซิร์ฟเวอร์รันอยู่ (ค่าเริ่มต้น http://localhost:4000) และมีข้อมูลจาก `npm run seed`
 * ตรวจว่า:
 *   1. handshake ปฏิเสธเมื่อไม่มี token / token ปลอม
 *   2. ต่อสำเร็จแล้วได้ event `connected` + ถูกใส่ห้อง user:<id>
 *   3. ping/pong ทำงาน
 *   4. REST ที่เปลี่ยนสถานะ → ยิง event ให้ถูกคน
 *      (exam:published, submission:submitted, submission:graded, result:released)
 *
 * ข้อมูลที่สร้างระหว่างเทสต์จะถูกลบในตอนจบ เพื่อให้ DB กลับสู่สภาพหลัง seed
 */
import { io } from 'socket.io-client';
import { prisma } from '../src/lib/prisma.js';

const BASE = process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 4000}`;
const EXAM_TITLE_FOR_TEST = 'Realtime Smoke Exam';

const results = [];
function check(label, ok, extra = '') {
  results.push({ label, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`);
}

async function api(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

function waitFor(socket, event, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout: ไม่ได้รับ event "${event}"`)), timeoutMs);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

const connect = (token) => io(BASE, { auth: token ? { token } : {}, transports: ['websocket', 'polling'] });

const createdSubmissionIds = [];
let createdExamId = null;

try {
  // --- login ---
  const teacher = (await api('POST', '/api/auth/login', { body: { email: 'teacher@demo.local', password: 'Teacher123!', role: 'TEACHER' } })).data;
  const student = (await api('POST', '/api/auth/login', { body: { email: 'student2@demo.local', password: 'Student123!', role: 'STUDENT' } })).data;
  check('login ได้ทั้งครูและนักเรียน', Boolean(teacher?.accessToken && student?.accessToken));
  if (!teacher?.accessToken || !student?.accessToken) throw new Error('login ไม่สำเร็จ — ตรวจว่ามีข้อมูล seed และรหัสผ่านถูกต้อง');

  // --- 1) handshake ---
  await new Promise((resolve) => {
    const bad = connect(null);
    const timer = setTimeout(() => {
      check('ไม่มี token → connect_error', false, 'ไม่เกิด error ภายในเวลา');
      bad.close();
      resolve();
    }, 8000);
    bad.once('connect_error', (err) => {
      clearTimeout(timer);
      check('ไม่มี token → connect_error', /UNAUTHORIZED/.test(err.message), err.message);
      bad.close();
      resolve();
    });
    bad.once('connect', () => {
      clearTimeout(timer);
      check('ไม่มี token → connect_error', false, 'connect สำเร็จทั้งที่ไม่มี token');
      bad.close();
      resolve();
    });
  });

  // --- 2) connect + room ---
  const teacherSock = connect(teacher.accessToken);
  const studentSock = connect(student.accessToken);
  const [teacherHello, studentHello] = await Promise.all([
    waitFor(teacherSock, 'connected'),
    waitFor(studentSock, 'connected'),
  ]);
  check('ครูได้ event connected + ห้อง user:<id>', teacherHello.room === `user:${teacher.user.id}` && teacherHello.role === 'TEACHER', teacherHello.room);
  check('นักเรียนได้ event connected + ห้อง user:<id>', studentHello.room === `user:${student.user.id}` && studentHello.role === 'STUDENT', studentHello.room);

  // --- 3) ping/pong ---
  const pong = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 5000);
    studentSock.emit('ping', (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
  check('client → server: ping ได้ ack pong', pong?.pong === true);

  // --- 4) exam:published ---
  const classroomId = (await api('GET', '/api/classrooms', { token: teacher.accessToken })).data.classrooms[0].id;
  const newExam = (await api('POST', '/api/exams', {
    token: teacher.accessToken,
    body: { title: EXAM_TITLE_FOR_TEST, timeLimitMinutes: 30 },
  })).data.exam;
  createdExamId = newExam.id;

  await api('POST', `/api/exams/${createdExamId}/questions`, {
    token: teacher.accessToken,
    body: {
      type: 'MULTIPLE_CHOICE',
      prompt: 'ข้อทดสอบ realtime',
      points: 1,
      choices: [
        { label: 'A', text: 'ถูก', isCorrect: true },
        { label: 'B', text: 'ผิด', isCorrect: false },
      ],
    },
  });
  await api('POST', `/api/exams/${createdExamId}/assignments`, { token: teacher.accessToken, body: { classroomId } });

  const publishedWait = waitFor(studentSock, 'exam:published');
  const publishRes = await api('POST', `/api/exams/${createdExamId}/publish`, { token: teacher.accessToken });
  const published = await publishedWait;
  check('เปิดสอบ → นักเรียนได้ exam:published', publishRes.status === 200 && published.examId === createdExamId);

  // --- 5) submission:submitted ---
  const seededExam = (await api('GET', '/api/exams', { token: teacher.accessToken })).data.exams.find((exam) => exam.status === 'PUBLISHED' && exam.title !== EXAM_TITLE_FOR_TEST);
  const startRes = await api('POST', `/api/my/exams/${seededExam.id}/submissions`, {
    token: student.accessToken,
    body: { displayMode: 'SINGLE_PAGE' },
  });
  const submissionId = startRes.data?.submission?.id;
  if (submissionId) createdSubmissionIds.push(submissionId);
  check('นักเรียนเริ่มทำข้อสอบได้', startRes.status === 201 && Boolean(submissionId), `status=${startRes.status}`);
  if (!submissionId) throw new Error('เริ่มทำข้อสอบไม่สำเร็จ — ทดสอบขั้นถัดไปไม่ได้');

  const submittedWait = waitFor(teacherSock, 'submission:submitted');
  const submitRes = await api('POST', `/api/my/submissions/${submissionId}/submit`, {
    token: student.accessToken,
    body: { displayMode: 'SINGLE_PAGE' },
  });
  const submitted = await submittedWait;
  check('ส่งข้อสอบ → ครูได้ submission:submitted', submitRes.status === 200 && submitted.submissionId === submissionId);

  // --- 6) submission:graded ---
  const detail = (await api('GET', `/api/grading/submissions/${submissionId}`, { token: teacher.accessToken })).data.submission;
  const subjective = detail.answers.filter((answer) => answer.type !== 'MULTIPLE_CHOICE');
  check('มีข้ออัตนัยให้ตรวจ', subjective.length > 0, `พบ ${subjective.length} ข้อ`);

  const gradedWait = waitFor(teacherSock, 'submission:graded');
  await api('PATCH', `/api/grading/answers/${subjective[0].id}`, {
    token: teacher.accessToken,
    body: { isCorrect: true, graderComment: 'ถูกต้อง (smoke test)' },
  });
  const graded = await gradedWait;
  check('ตรวจข้อ → ครูได้ submission:graded', graded.submissionId === submissionId);

  for (const answer of subjective.slice(1)) {
    await api('PATCH', `/api/grading/answers/${answer.id}`, {
      token: teacher.accessToken,
      body: { isCorrect: false, awardedPoints: 0, graderComment: 'ยังไม่ครบ (smoke test)' },
    });
  }

  // --- 7) result:released ---
  const releasedWait = waitFor(studentSock, 'result:released');
  const releaseRes = await api('POST', `/api/grading/submissions/${submissionId}/release`, { token: teacher.accessToken });
  const released = await releasedWait;
  const releasedSubmission = releaseRes.data?.submission;
  check('ปล่อยผล → นักเรียนได้ result:released', releaseRes.status === 200 && released.submissionId === submissionId);
  check('หลังปล่อยผลสถานะเป็น RELEASED + มีเกรด', releasedSubmission?.status === 'RELEASED' && Boolean(releasedSubmission?.grade), `grade=${releasedSubmission?.grade}`);

  teacherSock.close();
  studentSock.close();
} catch (error) {
  check(`เกิดข้อผิดพลาดกลางทาง: ${error.message}`, false);
} finally {
  // คืน DB สู่สภาพหลัง seed
  try {
    if (createdExamId) await prisma.exam.delete({ where: { id: createdExamId } }).catch(() => {});
    for (const id of createdSubmissionIds) {
      await prisma.submission.delete({ where: { id } }).catch(() => {});
    }
    console.log('[cleanup] คืนข้อมูลทดสอบเรียบร้อย');
  } catch (cleanupError) {
    console.error('[cleanup] ล้มเหลว:', cleanupError.message);
  }

  await prisma.$disconnect();
  const failed = results.filter((result) => !result.ok).length;
  console.log(`\n=== ${results.length - failed}/${results.length} passed ===`);
  process.exit(failed > 0 ? 1 : 0);
}
