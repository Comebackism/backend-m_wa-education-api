-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('TEACHER', 'STUDENT');

-- CreateEnum
CREATE TYPE "ExamStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CLOSED');

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('MULTIPLE_CHOICE', 'SHORT_ANSWER', 'LONG_ANSWER');

-- CreateEnum
CREATE TYPE "DisplayMode" AS ENUM ('SINGLE_PAGE', 'PAGINATED');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('IN_PROGRESS', 'SUBMITTED', 'GRADED', 'RELEASED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "studentCode" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courses" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "teacherId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classrooms" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "joinCode" TEXT NOT NULL,
    "courseId" UUID NOT NULL,
    "teacherId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "classrooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrollments" (
    "id" UUID NOT NULL,
    "classroomId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exams" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "ExamStatus" NOT NULL DEFAULT 'DRAFT',
    "courseId" UUID,
    "teacherId" UUID NOT NULL,
    "timeLimitMinutes" INTEGER,
    "defaultDisplayMode" "DisplayMode" NOT NULL DEFAULT 'SINGLE_PAGE',
    "questionsPerPage" INTEGER NOT NULL DEFAULT 10,
    "totalsPoints" DECIMAL(7,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_assignments" (
    "id" UUID NOT NULL,
    "examId" UUID NOT NULL,
    "classroomId" UUID NOT NULL,
    "availableFrom" TIMESTAMP(3),
    "availableTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exam_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "questions" (
    "id" UUID NOT NULL,
    "examId" UUID NOT NULL,
    "type" "QuestionType" NOT NULL,
    "prompt" TEXT NOT NULL,
    "points" DECIMAL(6,2) NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "referenceText" TEXT,
    "explanation" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "choices" (
    "id" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "isCorrect" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "choices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grade_cutoffs" (
    "id" UUID NOT NULL,
    "examId" UUID NOT NULL,
    "grade" TEXT NOT NULL,
    "minPercent" DECIMAL(5,2) NOT NULL,

    CONSTRAINT "grade_cutoffs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submissions" (
    "id" UUID NOT NULL,
    "examId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "displayMode" "DisplayMode" NOT NULL DEFAULT 'SINGLE_PAGE',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "gradedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "autoScore" DECIMAL(7,2) NOT NULL DEFAULT 0,
    "manualScore" DECIMAL(7,2) NOT NULL DEFAULT 0,
    "totalScore" DECIMAL(7,2) NOT NULL DEFAULT 0,
    "percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "grade" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "answers" (
    "id" UUID NOT NULL,
    "submissionId" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "choiceId" UUID,
    "textAnswer" TEXT,
    "isCorrect" BOOLEAN,
    "autoGraded" BOOLEAN NOT NULL DEFAULT false,
    "awardedPoints" DECIMAL(6,2),
    "graderComment" TEXT,
    "gradedById" UUID,
    "gradedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "answers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_studentCode_key" ON "users"("studentCode");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");

-- CreateIndex
CREATE INDEX "courses_teacherId_idx" ON "courses"("teacherId");

-- CreateIndex
CREATE UNIQUE INDEX "courses_teacherId_code_key" ON "courses"("teacherId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "classrooms_joinCode_key" ON "classrooms"("joinCode");

-- CreateIndex
CREATE INDEX "classrooms_courseId_idx" ON "classrooms"("courseId");

-- CreateIndex
CREATE INDEX "classrooms_teacherId_idx" ON "classrooms"("teacherId");

-- CreateIndex
CREATE INDEX "enrollments_studentId_idx" ON "enrollments"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "enrollments_classroomId_studentId_key" ON "enrollments"("classroomId", "studentId");

-- CreateIndex
CREATE INDEX "exams_teacherId_idx" ON "exams"("teacherId");

-- CreateIndex
CREATE INDEX "exams_courseId_idx" ON "exams"("courseId");

-- CreateIndex
CREATE INDEX "exams_status_idx" ON "exams"("status");

-- CreateIndex
CREATE INDEX "exam_assignments_classroomId_idx" ON "exam_assignments"("classroomId");

-- CreateIndex
CREATE UNIQUE INDEX "exam_assignments_examId_classroomId_key" ON "exam_assignments"("examId", "classroomId");

-- CreateIndex
CREATE INDEX "questions_examId_idx" ON "questions"("examId");

-- CreateIndex
CREATE UNIQUE INDEX "choices_questionId_label_key" ON "choices"("questionId", "label");

-- CreateIndex
CREATE INDEX "grade_cutoffs_examId_idx" ON "grade_cutoffs"("examId");

-- CreateIndex
CREATE UNIQUE INDEX "grade_cutoffs_examId_grade_key" ON "grade_cutoffs"("examId", "grade");

-- CreateIndex
CREATE INDEX "submissions_studentId_idx" ON "submissions"("studentId");

-- CreateIndex
CREATE INDEX "submissions_status_idx" ON "submissions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "submissions_examId_studentId_key" ON "submissions"("examId", "studentId");

-- CreateIndex
CREATE INDEX "answers_questionId_idx" ON "answers"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "answers_submissionId_questionId_key" ON "answers"("submissionId", "questionId");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classrooms" ADD CONSTRAINT "classrooms_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classrooms" ADD CONSTRAINT "classrooms_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "classrooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exams" ADD CONSTRAINT "exams_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exams" ADD CONSTRAINT "exams_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_assignments" ADD CONSTRAINT "exam_assignments_examId_fkey" FOREIGN KEY ("examId") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_assignments" ADD CONSTRAINT "exam_assignments_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "classrooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_examId_fkey" FOREIGN KEY ("examId") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "choices" ADD CONSTRAINT "choices_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_cutoffs" ADD CONSTRAINT "grade_cutoffs_examId_fkey" FOREIGN KEY ("examId") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_examId_fkey" FOREIGN KEY ("examId") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "answers" ADD CONSTRAINT "answers_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "answers" ADD CONSTRAINT "answers_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "answers" ADD CONSTRAINT "answers_choiceId_fkey" FOREIGN KEY ("choiceId") REFERENCES "choices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "answers" ADD CONSTRAINT "answers_gradedById_fkey" FOREIGN KEY ("gradedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
