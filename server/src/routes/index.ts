import { Router } from "express";
import * as auth from "../controllers/auth";
import * as dashboard from "../controllers/dashboard";
import * as events from "../controllers/events";
import * as tasks from "../controllers/tasks";
import * as users from "../controllers/users";
import { requireAdmin, requireAuth } from "../middleware/auth";

const router = Router();

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
router.post("/tasks", requireAuth, requireAdmin, tasks.createTask);
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
