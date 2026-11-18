# 🔌 Realtime (Socket.IO)

ชั้น realtime ของระบบ ใช้ **Socket.IO 4** แนบอยู่บน HTTP server ตัวเดียวกับ REST API
(พอร์ตเดียวกัน แยกกันที่ path `/socket.io`)

> **หลักคิดสำคัญ:** REST ยังเป็นแหล่งข้อมูลจริงเสมอ
> event ที่ส่งผ่าน socket มีไว้แค่ **"สะกิด"** ว่ามีอะไรเปลี่ยน แล้วให้ frontend ไปดึงข้อมูลใหม่
> จึงไม่มีการส่ง state ทั้งก้อนผ่าน socket และไม่ต้องกังวลเรื่องข้อมูลตกหล่น

---

## การเชื่อมต่อ (ฝั่ง Frontend / Vue)

```bash
npm install socket.io-client
```

```js
import { io } from 'socket.io-client';

const socket = io('http://localhost:4000', {
  auth: { token: accessToken }, // ★ access token จาก POST /api/auth/login
});

socket.on('connect', () => console.log('realtime connected'));
socket.on('connect_error', (err) => console.error('realtime error:', err.message));
socket.on('connected', (payload) => console.log('hello', payload));
```

- ต้องแนบ **access token** ทุกครั้งที่เชื่อมต่อ (ดูหัวข้อ Authentication)
- ต่อได้ทั้ง `websocket` และ `polling` — ปล่อยเป็นค่าเริ่มต้นได้เลย ไม่ต้องตั้ง transports
- token หมดอายุ → server จะปฏิเสธ; ให้ต่อใหม่ด้วย access token ใหม่ (หรือ refresh token ผ่าน REST ก่อน)

---

## Authentication

Server ตรวจ access token **ตอน handshake** (ก่อนเชื่อมต่อสำเร็จ) ด้วย JWT ตัวเดียวกับ REST
แล้วตรวจบัญชีกับฐานข้อมูลซ้ำ (ต้องมีอยู่จริงและ `isActive = true`) เหมือน middleware ของ REST
รับ token ได้ 2 ทาง (อย่างใดอย่างหนึ่ง):

| วิธี | ตัวอย่าง |
| :--- | :--- |
| `auth.token` (แนะนำ) | `io(url, { auth: { token } })` |
| HTTP header | `Authorization: Bearer <accessToken>` (ผ่าน `extraHeaders` หรือ proxy) |

ถ้าไม่ส่งหรือ token ไม่ถูกต้อง → ได้ `connect_error` พร้อมข้อความ:

```
UNAUTHORIZED: ต้องแนบ access token
UNAUTHORIZED: token ไม่ถูกต้องหรือหมดอายุ
UNAUTHORIZED: ไม่พบผู้ใช้ หรือบัญชีถูกระงับการใช้งาน
```

---

## ห้อง (Rooms)

เมื่อเชื่อมต่อสำเร็จ server จะใส่ socket เข้าห้อง **`user:<userId>`** ให้อัตโนมัติ
ทุกแท็บ/ทุกอุปกรณ์ของผู้ใช้คนเดียวกันอยู่ห้องเดียวกัน → ยิงถึงพร้อมกันทั้งหมด

frontend **ไม่ต้อง** join ห้องเอง และตอนนี้ยังไม่มีห้องอื่นให้ join

---

## Event ที่ server → client

| Event | เกิดเมื่อ | Payload |
| :--- | :--- | :--- |
| `connected` | เชื่อมต่อสำเร็จทันที | `{ userId, role, room, serverTime }` |
| `exam:published` | ครูเปิดสอบ (`POST /api/exams/:examId/publish`) | `{ examId, title, serverTime }` |
| `submission:submitted` | นักเรียนกดส่งข้อสอบ | `{ examId, submissionId, studentId, serverTime }` |
| `submission:graded` | ครูตรวจอัตนัย 1 ข้อเสร็จ | `{ examId, submissionId, answerId, serverTime }` |
| `result:released` | ครูกด "ส่งผลไปให้นักเรียน" (รายคนหรือทั้งชุด) | `{ examId, submissionId?, serverTime }` |
| `pong` | ตอบกลับ `ping` (กรณีไม่ได้ส่ง callback) | `{ pong: true, serverTime }` |

### ใครได้รับ event ไหน

| Event | ผู้รับ |
| :--- | :--- |
| `exam:published` | นักเรียน **ทุกคนที่อยู่ในห้องเรียน** ซึ่งถูกมอบหมายข้อสอบนั้น |
| `submission:submitted` | ครู **เจ้าของข้อสอบ** |
| `submission:graded` | ครู **เจ้าของข้อสอบ** (ไว้รีเฟรชความคืบหน้าการตรวจบนแท็บ/อุปกรณ์อื่น) |
| `result:released` | นักเรียน **เจ้าของผลสอบ** (รายคน) หรือทุกคนที่ถูกปล่อยผล (ทั้งชุด) |

> `exam:published` ยิงเฉพาะตอน **เปิดสอบครั้งแรก** — กด publish ซ้ำจะไม่ยิงซ้ำ

### ตัวอย่างการใช้งานฝั่ง frontend

```js
// ครู: มีงานส่งเข้ามาใหม่ → รีเฟรชรายการรอตรวจ
socket.on('submission:submitted', ({ examId }) => {
  if (examId === currentExamId.value) gradingStore.fetchSubmissions(examId);
});

// นักเรียน: ข้อสอบใหม่เปิดให้ทำ → รีเฟรชรายการข้อสอบ
socket.on('exam:published', () => myExamsStore.fetch());

// นักเรียน: ครูปล่อยผลแล้ว → เปิดหน้าผลสอบได้
socket.on('result:released', ({ submissionId }) => {
  resultStore.fetch(submissionId);
  toast.success('ครูประกาศผลสอบแล้ว 🎉');
});
```

---

## Event ที่ client → server

| Event | รายละเอียด |
| :--- | :--- |
| `ping` | ตรวจว่าชั้น realtime ยังทำงานอยู่ — ส่ง callback มารับ `{ pong: true, serverTime }` ได้ |

```js
socket.emit('ping', (payload) => console.log('pong', payload)); // → { pong: true, serverTime }
socket.timeout(5000).emit('ping', (err, payload) => { /* ตรวจ timeout ได้ */ });
```

> ยังไม่มี event อื่นที่ client ส่งขึ้นไป (การบันทึกคำตอบ/ส่งข้อสอบยังใช้ REST ตามเดิม)
> ถ้าต้องการเพิ่ม event ใหม่ ให้เพิ่มชื่อใน `src/realtime/events.js`

---

## ตัวอย่างที่ทำได้ทันที

| สถานการณ์ | Event ที่ควรใช้ |
| :--- | :--- |
| หน้าตรวจข้อสอบของครู ขึ้น "มีงานส่งใหม่" | `submission:submitted` |
| หน้าจอของครู 2 เครื่องอัปเดตความคืบหน้าตรวจพร้อมกัน | `submission:graded` |
| นักเรียนได้ notification "ครูประกาศผลแล้ว" แล้วเปิดผลสอบได้ | `result:released` |
| นักเรียนเห็นข้อสอบใหม่โผล่ในหน้าจอโดยไม่ต้องกดรีเฟรช | `exam:published` |

---

## ทดสอบว่า realtime ทำงาน

```bash
npm run dev          # terminal 1: รันเซิร์ฟเวอร์ (ต้องมีข้อมูล seed แล้ว)
npm run test:realtime # terminal 2: ยิงทดสอบ event ครบทุกตัว
```

สคริปต์อยู่ที่ [`scripts/realtime-smoke.mjs`](../scripts/realtime-smoke.mjs) — ตรวจ handshake/ping ทุก event แล้วคืนค่า DB กลับสู่สภาพหลัง seed

---

## หมายเหตุด้านเทคนิค

- **CORS** ของ socket ใช้ค่า `CORS_ORIGIN` เดียวกับ REST → เพิ่ม origin ของ frontend ที่นั่นได้เลย
- Socket.IO ใช้ URL/path เดียวกันกับ API แต่ถูกแยกออกก่อนถึง Express จึงไม่ชนกับ route ของ API
- ถ้าจะรันแบบหลาย instance (scale out) ต้องเพิ่ม adapter กลาง (เช่น `@socket.io/redis-adapter`) เพราะห้อง `user:<id>` จะไม่ข้าม process กันเอง
- แอปนี้ปิด `serveClient` — ให้ frontend import `socket.io-client` จาก npm เอง (ไม่โหลด SDK จาก backend)
