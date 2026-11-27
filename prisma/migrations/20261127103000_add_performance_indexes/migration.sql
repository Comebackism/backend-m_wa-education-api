-- CreateIndex
CREATE INDEX "refresh_tokens_expiresAt_idx" ON "refresh_tokens"("expiresAt");

-- CreateIndex
CREATE INDEX "submissions_examId_status_idx" ON "submissions"("examId", "status");

-- CreateIndex
CREATE INDEX "submissions_examId_submittedAt_idx" ON "submissions"("examId", "submittedAt");

-- CreateIndex
CREATE INDEX "answers_submissionId_isCorrect_idx" ON "answers"("submissionId", "isCorrect");
