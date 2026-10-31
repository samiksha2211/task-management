import { Router, type NextFunction, type Request, type Response } from "express";
import * as auth from "../controllers/auth";
import * as dashboard from "../controllers/dashboard";
import * as events from "../controllers/events";
import * as meetings from "../controllers/meetings";
import * as tasks from "../controllers/tasks";
import * as users from "../controllers/users";
import { requireAdmin, requireAuth } from "../middleware/auth";
import { storeFile, upload } from "../lib/storage";
import { runTaskReminders } from "../jobs/taskReminder";

const router = Router();

/** Upload one file and return its stored location (used by older forms). */
async function handleUpload(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }
  try {
    const stored = await storeFile(req.file);
    res.json({
      attachmentUrl: stored.url,
      attachmentName: stored.name,
      attachmentType: stored.mimeType,
    });
  } catch (error) {
    next(error);
  }
}

// Called daily by Vercel Cron (see vercel.json). Vercel sends
// "Authorization: Bearer $CRON_SECRET" when CRON_SECRET is set.
router.get("/cron/task-reminders", async (req, res, next) => {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    await runTaskReminders();
    res.json({ status: "ok" });
  } catch (error) {
    next(error);
  }
});

router.post("/auth/login", auth.login);
router.post("/auth/register", auth.register);
router.get("/auth/me", requireAuth, auth.me);
router.patch("/auth/me", requireAuth, auth.updateMe);
router.post("/auth/change-password", requireAuth, auth.changePassword);
router.post("/auth/forgot-password", auth.forgotPassword);
router.post("/auth/reset-password", auth.resetPassword);

router.get("/users", requireAuth, requireAdmin, users.listUsers);
router.post("/users", requireAuth, requireAdmin, users.createUser);
router.post(
  "/users/ensure-by-designation",
  requireAuth,
  requireAdmin,
  users.ensureUserByDesignation
);
router.get("/users/:id", requireAuth, requireAdmin, users.getUser);
router.put("/users/:id", requireAuth, requireAdmin, users.updateUser);
router.delete("/users/:id", requireAuth, requireAdmin, users.deleteUser);

router.get("/tasks/recycle-bin", requireAuth, requireAdmin, tasks.recycleBin);
router.get("/tasks", requireAuth, tasks.listTasks);
router.get("/tasks/export", requireAuth, tasks.exportTasks);
router.post(
  "/tasks/upload",
  requireAuth,
  requireAdmin,
  upload.single("file"),
  handleUpload
);
// BO (officer) attachments. The officer view already called this route,
// but it did not exist, so officers' attachment uploads failed.
router.post(
  "/tasks/officer-update/upload",
  requireAuth,
  upload.single("file"),
  handleUpload
);
router.post("/tasks", requireAuth, requireAdmin, tasks.createTask);
router.post(
  "/tasks/:id/officer-updates",
  requireAuth,
  tasks.createOfficerUpdate
);
router.put(
  "/tasks/:id/officer-updates/:updateId",
  requireAuth,
  requireAdmin,
  tasks.updateOfficerUpdate
);
router.delete(
  "/tasks/:id/officer-updates/:updateId",
  requireAuth,
  requireAdmin,
  tasks.deleteOfficerUpdate
);
// DRM (task) and BO (officer update) attachments: several files or links each.
router.post("/tasks/:id/attachments", requireAuth, upload.array("files", 10), tasks.addAttachments);
router.delete("/tasks/:id/attachments/:attachmentId", requireAuth, tasks.removeAttachment);
router.get("/tasks/:id", requireAuth, tasks.getTask);
router.put("/tasks/:id", requireAuth, requireAdmin, tasks.updateTask);
router.patch("/tasks/:id/status", requireAuth, tasks.updateTaskStatus);
router.delete("/tasks/:id/hard", requireAuth, requireAdmin, tasks.hardDelete);
router.delete("/tasks/:id", requireAuth, requireAdmin, tasks.softDelete);
router.post("/tasks/:id/restore", requireAuth, requireAdmin, tasks.restore);

// Monday meeting: cycle registers, agenda and scheduling (admin only).
router.get("/meetings/register", requireAuth, requireAdmin, meetings.getRegister);
router.get("/meetings/register/pdf", requireAuth, requireAdmin, meetings.downloadRegisterPdf);
router.get("/meetings/agenda", requireAuth, requireAdmin, meetings.getAgenda);
router.post("/meetings/:date/finalize", requireAuth, requireAdmin, meetings.finalizeAgenda);
router.post("/meetings/:date/reopen", requireAuth, requireAdmin, meetings.reopenAgenda);
router.get("/meetings/:date/export", requireAuth, requireAdmin, meetings.exportAgenda);
router.post("/meetings/:date/items/:taskId/outcome", requireAuth, requireAdmin, meetings.recordOutcome);
router.post("/schedule/cycle", requireAuth, requireAdmin, meetings.setCycleBulk);
router.patch("/schedule/tasks/:id/cycle", requireAuth, requireAdmin, meetings.setCycle);
router.post("/schedule/tasks/:id/reschedule", requireAuth, requireAdmin, meetings.rescheduleTask);
router.get("/schedule/tasks/:id/history", requireAuth, requireAdmin, meetings.taskHistory);

router.get("/dashboard/stats", requireAuth, dashboard.stats);
router.get("/dashboard/task-status", requireAuth, dashboard.taskStatus);
router.get("/dashboard/weekly", requireAuth, dashboard.weekly);
router.get("/dashboard/notifications", requireAuth, dashboard.notifications);

router.get("/events", requireAuth, events.streamEvents);

export default router;
