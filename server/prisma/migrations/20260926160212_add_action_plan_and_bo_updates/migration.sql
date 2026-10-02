-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "actionPlan" TEXT,
ADD COLUMN     "actionPlanTdc" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "TaskOfficerUpdate" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "officerId" TEXT NOT NULL,
    "remark" TEXT,
    "attachmentUrl" TEXT,
    "attachmentName" TEXT,
    "attachmentType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskOfficerUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskOfficerUpdate_taskId_idx" ON "TaskOfficerUpdate"("taskId");

-- CreateIndex
CREATE INDEX "TaskOfficerUpdate_officerId_idx" ON "TaskOfficerUpdate"("officerId");

-- AddForeignKey
ALTER TABLE "TaskOfficerUpdate" ADD CONSTRAINT "TaskOfficerUpdate_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskOfficerUpdate" ADD CONSTRAINT "TaskOfficerUpdate_officerId_fkey" FOREIGN KEY ("officerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
