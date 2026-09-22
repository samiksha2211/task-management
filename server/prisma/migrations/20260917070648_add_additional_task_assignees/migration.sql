-- CreateTable
CREATE TABLE "TaskAdditionalAssignee" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "officerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskAdditionalAssignee_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskAdditionalAssignee_taskId_idx" ON "TaskAdditionalAssignee"("taskId");

-- CreateIndex
CREATE INDEX "TaskAdditionalAssignee_officerId_idx" ON "TaskAdditionalAssignee"("officerId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskAdditionalAssignee_taskId_officerId_key" ON "TaskAdditionalAssignee"("taskId", "officerId");

-- AddForeignKey
ALTER TABLE "TaskAdditionalAssignee" ADD CONSTRAINT "TaskAdditionalAssignee_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAdditionalAssignee" ADD CONSTRAINT "TaskAdditionalAssignee_officerId_fkey" FOREIGN KEY ("officerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
