import { Router } from "express";
import * as auth from "../controllers/auth";
import * as dashboard from "../controllers/dashboard";
import * as events from "../controllers/events";
import * as tasks from "../controllers/tasks";
import * as users from "../controllers/users";
import { requireAdmin, requireAuth } from "../middleware/auth";
import multer from "multer";
import path from "path";
import fs from "fs";
import { put } from "@vercel/blob";
import { runTaskReminders } from "../jobs/taskReminder";

const router = Router();
const uploadDir = path.join(process.cwd(), "uploads");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    const allowedTypes = [
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/webp",
    ];

    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF and image files are allowed."));
    }
  },
});

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
  async (req, res, next) => {
    if (!req.file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }

    const safeName = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    const filename = `${Date.now()}-${safeName}`;
    let attachmentUrl: string;

    try {
      // On Vercel the filesystem is ephemeral, so store in Vercel Blob
      // (token auth, or OIDC via BLOB_STORE_ID on newer Blob stores).
      // Without Blob credentials (local dev), keep writing to ./uploads.
      if (process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID) {
        const blob = await put(`uploads/${filename}`, req.file.buffer, {
          access: "public",
          addRandomSuffix: true,
          contentType: req.file.mimetype,
        });
        attachmentUrl = blob.url;
      } else {
        fs.mkdirSync(uploadDir, { recursive: true });
        fs.writeFileSync(path.join(uploadDir, filename), req.file.buffer);
        attachmentUrl = `/uploads/${filename}`;
      }
    } catch (error) {
      next(error);
      return;
    }

    res.json({
      attachmentUrl,
      attachmentName: req.file.originalname,
      attachmentType: req.file.mimetype,
    });
  }
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
router.get("/tasks/:id", requireAuth, tasks.getTask);
router.put("/tasks/:id", requireAuth, requireAdmin, tasks.updateTask);
router.patch("/tasks/:id/status", requireAuth, tasks.updateTaskStatus);
router.delete("/tasks/:id/hard", requireAuth, requireAdmin, tasks.hardDelete);
router.delete("/tasks/:id", requireAuth, requireAdmin, tasks.softDelete);
router.post("/tasks/:id/restore", requireAuth, requireAdmin, tasks.restore);

router.get("/dashboard/stats", requireAuth, dashboard.stats);
router.get("/dashboard/task-status", requireAuth, dashboard.taskStatus);
router.get("/dashboard/weekly", requireAuth, dashboard.weekly);
router.get("/dashboard/notifications", requireAuth, dashboard.notifications);

router.get("/events", requireAuth, events.streamEvents);

export default router;
