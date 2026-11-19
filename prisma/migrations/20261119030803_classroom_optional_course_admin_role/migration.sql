-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'ADMIN';

-- DropForeignKey
ALTER TABLE "classrooms" DROP CONSTRAINT "classrooms_courseId_fkey";

-- AlterTable
ALTER TABLE "classrooms" ALTER COLUMN "courseId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "classrooms" ADD CONSTRAINT "classrooms_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
