ALTER TABLE "WhatsAppLog" DROP CONSTRAINT "WhatsAppLog_officerId_fkey";

ALTER TABLE "WhatsAppLog" DROP CONSTRAINT "WhatsAppLog_taskId_fkey";

DROP INDEX "User_mobile_idx";

ALTER TABLE "User" DROP COLUMN "mobile",
DROP COLUMN "waEnabled";

DROP TABLE "WhatsAppLog";