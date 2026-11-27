import { prisma } from './prisma.js';
import { ApiError } from './errors.js';
import { toNumber } from './serialize.js';

/**
 * เทียบเปอร์เซ็นต์กับเกณฑ์ตัดเกรดของข้อสอบ
 * cutoffs = [{ grade: 'A', minPercent: 80 }, ...] โดย minPercent เป็น "ขอบล่างแบบรวม"
 */
export function resolveGrade(cutoffs, percent) {
  const sorted = [...cutoffs].sort((a, b) => toNumber(b.minPercent) - toNumber(a.minPercent));
  const hit = sorted.find((cutoff) => percent >= toNumber(cutoff.minPercent));
  return hit?.grade ?? null;
}

export function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

/**
 * รวมยอดคะแนนของใบเดียวจากตัวเลขที่รวบมาแล้ว (ใช้ร่วมกันทั้งแบบใบเดียวและแบบกลุ่ม)
 *   autoScore   = ปรนัย (autoGraded = true) → ตรวจอัตโนมัติจากเฉลย
 *   manualScore = อัตนัย → คะแนนที่ครูให้ (awardedPoints)
 *   percent     = totalScore / คะแนนเต็ม * 100
 *   status      = GRADED เมื่อตรวจครบทุกข้อ, SUBMITTED = "ส่งแล้ว รอตรวจ"
 */
function computeTotals({ autoScore, manualScore, ungradedCount, totalPoints, cutoffs, status }) {
  const totalScore = round2(autoScore + manualScore);
  const percent = totalPoints > 0 ? round2((totalScore / totalPoints) * 100) : 0;
  const grade = resolveGrade(cutoffs, percent);
  const allGraded = ungradedCount === 0;

  return {
    autoScore,
    manualScore,
    totalScore,
    percent,
    grade,
    allGraded,
    status: status === 'RELEASED' ? 'RELEASED' : allGraded ? 'GRADED' : 'SUBMITTED',
  };
}

/**
 * คิดคะแนนใหม่ทั้งหมดจากการตอบของนักเรียนทุกข้อ
 * ส่ง `tx` เข้ามาเพื่อให้คิดคะแนนภายใน transaction เดียวกับผู้เรียกได้
 */
export async function recalculateSubmission(submissionId, { tx = prisma } = {}) {
  const submission = await tx.submission.findUnique({
    where: { id: submissionId },
    include: {
      exam: { include: { cutoffs: true, questions: { select: { points: true } } } },
      answers: true,
    },
  });

  if (!submission) throw ApiError.notFound('ไม่พบการส่งข้อสอบ');

  let autoScore = 0;
  let manualScore = 0;
  let ungradedCount = 0;

  for (const answer of submission.answers) {
    if (answer.isCorrect === null || answer.awardedPoints === null) {
      ungradedCount += 1;
      continue;
    }
    if (answer.autoGraded) autoScore += toNumber(answer.awardedPoints);
    else manualScore += toNumber(answer.awardedPoints);
  }

  const totalPoints = submission.exam.questions.reduce((sum, question) => sum + toNumber(question.points), 0);
  const totals = computeTotals({
    autoScore,
    manualScore,
    ungradedCount,
    totalPoints,
    cutoffs: submission.exam.cutoffs,
    status: submission.status,
  });

  return tx.submission.update({
    where: { id: submissionId },
    data: {
      autoScore: totals.autoScore,
      manualScore: totals.manualScore,
      totalScore: totals.totalScore,
      percent: totals.percent,
      grade: totals.grade,
      status: totals.status,
      gradedAt: totals.allGraded && !submission.gradedAt ? new Date() : submission.gradedAt,
    },
  });
}

/**
 * คิดคะแนนใหม่ "หลายใบพร้อมกัน" ของข้อสอบชุดเดียว ด้วย query คงที่ (ไม่โตตามจำนวนใบ)
 *   - ไม่ส่ง `submissionIds` → เก็บทุกใบที่ส่งแล้ว (SUBMITTED/GRADED/RELEASED) เหมือนพฤติกรรมเดิม
 *   - ส่ง `submissionIds` มา → จำกัดเฉพาะใบเหล่านั้น (ใช้ตอนปล่อยผลบางส่วน)
 *   - ส่ง `totalPoints` มาได้เพื่อข้ามการรวมคะแนนเต็มซ้ำ
 * ผลลัพธ์ต่อใบเหมือน `recalculateSubmission` ทุกฟิลด์
 */
export async function recalculateExamSubmissions(examId, { submissionIds, totalPoints, tx = prisma } = {}) {
  const submissions = await tx.submission.findMany({
    where: {
      examId,
      ...(submissionIds
        ? { id: { in: submissionIds } }
        : { status: { in: ['SUBMITTED', 'GRADED', 'RELEASED'] } }),
    },
    select: { id: true, status: true },
  });

  if (submissions.length === 0) return [];

  const cutoffs = await tx.gradeCutoff.findMany({
    where: { examId },
    select: { grade: true, minPercent: true },
  });

  let pointsTotal = totalPoints;
  if (pointsTotal === undefined) {
    const questions = await tx.question.findMany({ where: { examId }, select: { points: true } });
    pointsTotal = questions.reduce((sum, question) => sum + toNumber(question.points), 0);
  }

  // รวมคะแนนต่อใบใน 1 query (ไม่ดึง textAnswer และไม่วนทีละใบใน Node)
  const aggregates = await tx.$queryRaw`
    SELECT a."submissionId",
           COALESCE(SUM(CASE WHEN a."isCorrect" IS NOT NULL AND a."awardedPoints" IS NOT NULL AND a."autoGraded"
                             THEN a."awardedPoints" ELSE 0 END), 0)::float8 AS "autoScore",
           COALESCE(SUM(CASE WHEN a."isCorrect" IS NOT NULL AND a."awardedPoints" IS NOT NULL AND NOT a."autoGraded"
                             THEN a."awardedPoints" ELSE 0 END), 0)::float8 AS "manualScore",
           (COUNT(*) FILTER (WHERE a."isCorrect" IS NULL OR a."awardedPoints" IS NULL))::int AS "ungradedCount"
    FROM "answers" AS a
    JOIN "submissions" AS s ON s."id" = a."submissionId"
    WHERE s."examId" = ${examId}::uuid
    GROUP BY a."submissionId"
  `;

  const aggregateBySubmission = new Map(aggregates.map((row) => [row.submissionId, row]));

  const values = submissions.map((submission) => {
    const aggregate = aggregateBySubmission.get(submission.id) ?? {
      autoScore: 0,
      manualScore: 0,
      ungradedCount: 0,
    };
    const totals = computeTotals({
      autoScore: Number(aggregate.autoScore),
      manualScore: Number(aggregate.manualScore),
      ungradedCount: Number(aggregate.ungradedCount),
      totalPoints: pointsTotal,
      cutoffs,
      status: submission.status,
    });

    return {
      id: submission.id,
      autoScore: totals.autoScore,
      manualScore: totals.manualScore,
      totalScore: totals.totalScore,
      percent: totals.percent,
      grade: totals.grade,
      status: totals.status,
      allGraded: totals.allGraded,
    };
  });

  // อัปเดตทุกใบใน 1 statement — gradedAt ตั้ง "ตอนนี้" เฉพาะใบที่ตรวจครบและยังไม่เคยตั้ง
  await tx.$executeRaw`
    UPDATE "submissions" AS s
    SET "autoScore" = v."autoScore",
        "manualScore" = v."manualScore",
        "totalScore" = v."totalScore",
        "percent" = v."percent",
        "grade" = v."grade",
        "status" = v."status"::"SubmissionStatus",
        "gradedAt" = CASE WHEN v."allGraded" AND s."gradedAt" IS NULL THEN (NOW() AT TIME ZONE 'UTC') ELSE s."gradedAt" END,
        "updatedAt" = (NOW() AT TIME ZONE 'UTC')
    FROM jsonb_to_recordset(${JSON.stringify(values)}::jsonb) AS v(
      id uuid,
      "autoScore" numeric,
      "manualScore" numeric,
      "totalScore" numeric,
      "percent" numeric,
      grade text,
      status text,
      "allGraded" boolean
    )
    WHERE s."id" = v."id"
  `;

  return values;
}

/**
 * คิดคะแนนเต็มของข้อสอบใหม่ (เรียกหลังเพิ่ม/แก้/ลบข้อสอบ)
 */
export async function recalculateExamTotals(examId) {
  const questions = await prisma.question.findMany({
    where: { examId },
    select: { points: true },
  });
  const totalsPoints = round2(questions.reduce((sum, question) => sum + toNumber(question.points), 0));

  await prisma.exam.update({ where: { id: examId }, data: { totalsPoints } });

  const submissions = await prisma.submission.findMany({
    where: { examId, status: { in: ['SUBMITTED', 'GRADED', 'RELEASED'] } },
    select: { id: true },
  });
  for (const submission of submissions) {
    await recalculateSubmission(submission.id);
  }

  return totalsPoints;
}

/**
 * ตรวจปรนัยอัตโนมัติ ตอนกดส่งข้อสอบ
 * อัตนัยยังเป็น null → รอครูตรวจ ("ส่งแล้ว รอตรวจ")
 */
export function autoGradeAnswer(question, answer) {
  if (question.type !== 'MULTIPLE_CHOICE') {
    return { isCorrect: null, autoGraded: false, awardedPoints: null };
  }

  const correctChoice = question.choices.find((choice) => choice.isCorrect);
  const isCorrect = Boolean(correctChoice && answer.choiceId && answer.choiceId === correctChoice.id);

  return {
    isCorrect,
    autoGraded: true,
    awardedPoints: isCorrect ? toNumber(question.points) : 0,
  };
}
