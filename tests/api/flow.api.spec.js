import { bearer, expect, registerTeacher, test } from './fixtures.js';

/**
 * โฟลว์จริงข้ามบทบาท (black-box): ครูตั้งรายวิชา/ห้องเรียน → นักเรียนเข้าห้องด้วยรหัส
 * ตรวจว่า "สัญญาระหว่างหน้าจอ" ต่อกันได้จริง ไม่ใช่แค่แต่ละ endpoint ทำงานเดี่ยว
 */

const PASSWORD = 'Password123!';

test.describe('โฟลว์ครู + นักเรียน', () => {
  test('ครูสร้างวิชา+ห้องเรียน แล้วนักเรียนเข้าห้องด้วยรหัส', async ({ request }) => {
    // 1) ครูสมัครและได้ token
    const teacher = await registerTeacher(request, 'flow.teacher@test.local', 'ครูโฟลว์');
    const teacherAuth = bearer(teacher.accessToken);

    // 2) สร้างรายวิชา
    const courseResponse = await request.post('/api/courses', {
      headers: teacherAuth,
      data: { code: 'MATH101', title: 'คณิตศาสตร์', description: 'ทดสอบ' },
    });
    expect(courseResponse.status()).toBe(201);
    const course = (await courseResponse.json()).course;
    expect(course).toMatchObject({ code: 'MATH101', title: 'คณิตศาสตร์' });

    // 3) สร้างห้องเรียนในรายวิชานั้น — ระบบออก joinCode ให้
    const classroomResponse = await request.post('/api/classrooms', {
      headers: teacherAuth,
      data: { name: 'ม.4/1', courseId: course.id },
    });
    expect(classroomResponse.status()).toBe(201);
    const classroom = (await classroomResponse.json()).classroom;
    expect(classroom.joinCode).toMatch(/^[A-Z0-9]{4,20}$/);

    // 4) นักเรียนสมัครพร้อมรหัสห้องเรียน → เข้าห้องทันที
    const studentEmail = 'flow.student@test.local';
    const studentResponse = await request.post('/api/auth/student/register', {
      data: {
        email: studentEmail,
        password: PASSWORD,
        fullName: 'นักเรียนโฟลว์',
        studentCode: 'S001',
        joinCode: classroom.joinCode,
      },
    });
    expect(studentResponse.status()).toBe(201);
    const student = await studentResponse.json();
    expect(student.user.role).toBe('STUDENT');

    // 5) ฝั่งนักเรียนเห็นห้องที่เพิ่งเข้า
    const myClassrooms = await request.get('/api/my/classrooms', { headers: bearer(student.accessToken) });
    expect(myClassrooms.status()).toBe(200);
    const mine = (await myClassrooms.json()).classrooms;
    expect(mine.map((item) => item.id)).toContain(classroom.id);

    // 6) ฝั่งครูเห็นรายชื่อนักเรียนในห้อง
    const roster = await request.get(`/api/classrooms/${classroom.id}/students`, { headers: teacherAuth });
    expect(roster.status()).toBe(200);
    const students = (await roster.json()).students;
    expect(students.map((item) => item.email)).toContain(studentEmail);
  });

  test('นักเรียนสร้างรายวิชาไม่ได้ (กันสิทธิ์ข้ามบทบาท) → 403', async ({ request }) => {
    const register = await request.post('/api/auth/student/register', {
      data: { email: 'no-rights@test.local', password: PASSWORD, fullName: 'นักเรียนทั่วไป' },
    });
    expect(register.status()).toBe(201);
    const { accessToken } = await register.json();

    const response = await request.post('/api/courses', {
      headers: bearer(accessToken),
      data: { code: 'HACK', title: 'ไม่ควรสร้างได้' },
    });

    expect(response.status()).toBe(403);
  });

  test('ครูคนอื่นเข้าถึงรายวิชาที่ไม่ใช่ของตัวเอง → 403', async ({ request }) => {
    const owner = await registerTeacher(request, 'owner@test.local', 'ครูเจ้าของ');
    const stranger = await registerTeacher(request, 'stranger@test.local', 'ครูคนอื่น');

    const created = await request.post('/api/courses', {
      headers: bearer(owner.accessToken),
      data: { code: 'PRIVATE', title: 'รายวิชาส่วนตัว' },
    });
    const courseId = (await created.json()).course.id;

    const response = await request.get(`/api/courses/${courseId}`, {
      headers: bearer(stranger.accessToken),
    });

    expect(response.status()).toBe(403);
  });
});
