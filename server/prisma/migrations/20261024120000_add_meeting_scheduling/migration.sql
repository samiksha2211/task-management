-- CreateEnum
CREATE TYPE "DiscussionFrequency" AS ENUM ('M', 'F', 'NM');

-- CreateEnum
CREATE TYPE "ScheduleState" AS ENUM ('SCHEDULED', 'DEFERRED', 'BROUGHT_FORWARD', 'PINNED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MeetingStatus" AS ENUM ('DRAFT', 'FINALIZED', 'CLOSED');

-- CreateEnum
CREATE TYPE "AgendaSection" AS ENUM ('URGENT', 'BLOCKED_OVERDUE', 'WEEKLY', 'FORTNIGHTLY', 'MONTHLY', 'NEW');

-- CreateEnum
CREATE TYPE "AgendaInclusion" AS ENUM ('DUE', 'BROUGHT_FORWARD', 'MANUAL');

-- CreateEnum
CREATE TYPE "AgendaOutcome" AS ENUM ('PENDING', 'DISCUSSED', 'NOT_DISCUSSED', 'DEFERRED');

-- CreateEnum
CREATE TYPE "ScheduleEventType" AS ENUM ('INITIALIZED', 'FREQUENCY_CHANGED', 'RESCHEDULED', 'BROUGHT_FORWARD', 'DEFERRED', 'DISCUSSED', 'DISCUSSION_UNDONE', 'REVIEW_UPDATED', 'ADDED_TO_AGENDA', 'REMOVED_FROM_AGENDA', 'COMPLETED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "discussionFrequency" "DiscussionFrequency",
ADD COLUMN     "estimatedDiscussionMinutes" INTEGER,
ADD COLUMN     "flaggedForReview" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isBlocked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastDiscussedAt" DATE,
ADD COLUMN     "latestReviewAt" TIMESTAMP(3),
ADD COLUMN     "latestReviewNote" TEXT,
ADD COLUMN     "monthlyMondayOrdinal" INTEGER,
ADD COLUMN     "nextDiscussionDate" DATE,
ADD COLUMN     "originalDiscussionDate" DATE,
ADD COLUMN     "scheduleReason" TEXT,
ADD COLUMN     "scheduleState" "ScheduleState" NOT NULL DEFAULT 'SCHEDULED';

-- CreateTable
CREATE TABLE "Meeting" (
    "id" TEXT NOT NULL,
    "meetingDate" DATE NOT NULL,
    "status" "MeetingStatus" NOT NULL DEFAULT 'DRAFT',
    "durationLimitMinutes" INTEGER NOT NULL DEFAULT 90,
    "notes" TEXT,
    "reportUrl" TEXT,
    "reportName" TEXT,
    "finalizedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Meeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingAgendaItem" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "section" "AgendaSection" NOT NULL,
    "inclusion" "AgendaInclusion" NOT NULL,
    "reason" TEXT NOT NULL,
    "estimatedMinutes" INTEGER NOT NULL,
    "outcome" "AgendaOutcome" NOT NULL DEFAULT 'PENDING',
    "discussionNotes" TEXT,
    "decisions" TEXT,
    "deferredTo" DATE,
    "deferReason" TEXT,
    "prevLastDiscussedAt" DATE,
    "prevNextDiscussionDate" DATE,
    "prevScheduleState" "ScheduleState",
    "prevOriginalDate" DATE,
    "prevScheduleReason" TEXT,
    "outcomeAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeetingAgendaItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskScheduleEvent" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "meetingId" TEXT,
    "userId" TEXT,
    "type" "ScheduleEventType" NOT NULL,
    "fromDate" DATE,
    "toDate" DATE,
    "fromFrequency" "DiscussionFrequency",
    "toFrequency" "DiscussionFrequency",
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskScheduleEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Meeting_meetingDate_key" ON "Meeting"("meetingDate");

-- CreateIndex
CREATE INDEX "MeetingAgendaItem_taskId_idx" ON "MeetingAgendaItem"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingAgendaItem_meetingId_taskId_key" ON "MeetingAgendaItem"("meetingId", "taskId");

-- CreateIndex
CREATE INDEX "TaskScheduleEvent_taskId_createdAt_idx" ON "TaskScheduleEvent"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "TaskScheduleEvent_meetingId_idx" ON "TaskScheduleEvent"("meetingId");

-- CreateIndex
CREATE INDEX "Task_nextDiscussionDate_idx" ON "Task"("nextDiscussionDate");

-- AddForeignKey
ALTER TABLE "MeetingAgendaItem" ADD CONSTRAINT "MeetingAgendaItem_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingAgendaItem" ADD CONSTRAINT "MeetingAgendaItem_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskScheduleEvent" ADD CONSTRAINT "TaskScheduleEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskScheduleEvent" ADD CONSTRAINT "TaskScheduleEvent_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskScheduleEvent" ADD CONSTRAINT "TaskScheduleEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

