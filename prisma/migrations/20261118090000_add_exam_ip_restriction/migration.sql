-- AlterTable
ALTER TABLE "exams" ADD COLUMN "allowedIpRanges" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
