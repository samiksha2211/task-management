-- CreateEnum
CREATE TYPE "AttachmentKind" AS ENUM ('FILE', 'LINK');

-- CreateTable
CREATE TABLE "TaskAttachment" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "officerUpdateId" TEXT,
    "kind" "AttachmentKind" NOT NULL,
    "url" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskAttachment_taskId_idx" ON "TaskAttachment"("taskId");

-- CreateIndex
CREATE INDEX "TaskAttachment_officerUpdateId_idx" ON "TaskAttachment"("officerUpdateId");

-- CreateIndex
CREATE INDEX "TaskAttachment_url_idx" ON "TaskAttachment"("url");

-- AddForeignKey
ALTER TABLE "TaskAttachment" ADD CONSTRAINT "TaskAttachment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAttachment" ADD CONSTRAINT "TaskAttachment_officerUpdateId_fkey" FOREIGN KEY ("officerUpdateId") REFERENCES "TaskOfficerUpdate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAttachment" ADD CONSTRAINT "TaskAttachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Copy the existing single DRM and BO attachments into the new table.
-- Fixed ids make this safe to run twice (no duplicate rows).
INSERT INTO "TaskAttachment" ("id", "taskId", "officerUpdateId", "kind", "url", "name", "mimeType", "createdAt")
SELECT 'legacy_drm_' || t."id", t."id", NULL, 'FILE', t."attachmentUrl",
       COALESCE(NULLIF(t."attachmentName", ''), 'Attachment'), t."attachmentType", t."updatedAt"
FROM "Task" t
WHERE t."attachmentUrl" IS NOT NULL AND t."attachmentUrl" <> ''
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "TaskAttachment" ("id", "taskId", "officerUpdateId", "kind", "url", "name", "mimeType", "uploadedById", "createdAt")
SELECT 'legacy_bo_' || u."id", u."taskId", u."id", 'FILE', u."attachmentUrl",
       COALESCE(NULLIF(u."attachmentName", ''), 'Attachment'), u."attachmentType", u."officerId", u."createdAt"
FROM "TaskOfficerUpdate" u
WHERE u."attachmentUrl" IS NOT NULL AND u."attachmentUrl" <> ''
ON CONFLICT ("id") DO NOTHING;
