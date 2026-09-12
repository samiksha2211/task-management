-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "priority" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "department" TEXT,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "mobile" TEXT,
ADD COLUMN     "waEnabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "WhatsAppLog" (
    "id" TEXT NOT NULL,
    "officerId" TEXT NOT NULL,
    "taskId" TEXT,
    "type" TEXT NOT NULL,
    "phone" TEXT,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WhatsAppLog_officerId_idx" ON "WhatsAppLog"("officerId");

-- CreateIndex
CREATE INDEX "WhatsAppLog_taskId_idx" ON "WhatsAppLog"("taskId");

-- CreateIndex
CREATE INDEX "WhatsAppLog_type_idx" ON "WhatsAppLog"("type");

-- CreateIndex
CREATE INDEX "WhatsAppLog_sentAt_idx" ON "WhatsAppLog"("sentAt");

-- CreateIndex
CREATE INDEX "User_designation_idx" ON "User"("designation");

-- CreateIndex
CREATE INDEX "User_mobile_idx" ON "User"("mobile");

-- AddForeignKey
ALTER TABLE "WhatsAppLog" ADD CONSTRAINT "WhatsAppLog_officerId_fkey" FOREIGN KEY ("officerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppLog" ADD CONSTRAINT "WhatsAppLog_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
