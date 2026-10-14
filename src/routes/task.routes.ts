import { Router } from "express";
import {
  createTask,
  listTasks,
  getTask,
  updateTask,
  deleteTask,
} from "../controllers/task.controller";
import { authenticate } from "../middleware/auth.middleware";
import {
  validateBody,
  validateQuery,
  validateParams,
} from "../middleware/validate.middleware";
import {
  createTaskSchema,
  updateTaskSchema,
  taskQuerySchema,
  taskIdParamSchema,
} from "../schemas/task.schema";

const router = Router();

// Enforce JWT authentication on all task endpoints
router.use(authenticate);

// POST /api/tasks - Create personal task
router.post("/", validateBody(createTaskSchema), createTask);

// GET /api/tasks - List authenticated user's tasks with filters, search, sort, pagination
router.get("/", validateQuery(taskQuerySchema), listTasks);

// GET /api/tasks/:id - Retrieve single task owned by authenticated user
router.get("/:id", validateParams(taskIdParamSchema), getTask);

// PATCH /api/tasks/:id - Partially update task owned by authenticated user
router.patch(
  "/:id",
  validateParams(taskIdParamSchema),
  validateBody(updateTaskSchema),
  updateTask
);

// DELETE /api/tasks/:id - Delete task owned by authenticated user
router.delete("/:id", validateParams(taskIdParamSchema), deleteTask);

export default router;
