import { z } from "zod";
import { TaskStatus, TaskPriority } from "@prisma/client";

export const createTaskSchema = z
  .object({
    title: z
      .string({
        message: "Title is required",
      })
      .trim()
      .min(1, "Title must be at least 1 character long")
      .max(255, "Title cannot exceed 255 characters"),
    description: z
      .string()
      .trim()
      .max(5000, "Description cannot exceed 5000 characters")
      .nullable()
      .optional(),
    status: z
      .nativeEnum(TaskStatus, {
        message: "Invalid status value",
      })
      .optional()
      .default(TaskStatus.TODO),
    priority: z
      .nativeEnum(TaskPriority, {
        message: "Invalid priority value",
      })
      .optional()
      .default(TaskPriority.MEDIUM),
    dueDate: z
      .string({
        message: "Due date must be a string in ISO 8601 format",
      })
      .datetime({
        message: "Invalid due date format, expected ISO 8601 string",
      })
      .nullable()
      .optional(),
    teamId: z.coerce
      .number({
        message: "Team ID must be a number",
      })
      .int("Team ID must be an integer")
      .positive("Team ID must be a positive integer")
      .nullable()
      .optional(),
  })
  .strict();

export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, "Title cannot be empty")
      .max(255, "Title cannot exceed 255 characters")
      .optional(),
    description: z
      .string()
      .trim()
      .max(5000, "Description cannot exceed 5000 characters")
      .nullable()
      .optional(),
    status: z
      .nativeEnum(TaskStatus, {
        message: "Invalid status value",
      })
      .optional(),
    priority: z
      .nativeEnum(TaskPriority, {
        message: "Invalid priority value",
      })
      .optional(),
    dueDate: z
      .string({
        message: "Due date must be a string in ISO 8601 format",
      })
      .datetime({
        message: "Invalid due date format, expected ISO 8601 string",
      })
      .nullable()
      .optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided for update",
  });

export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

export const taskQuerySchema = z
  .object({
    page: z.coerce
      .number({
        message: "Page must be a number",
      })
      .int("Page must be an integer")
      .min(1, "Page must be at least 1")
      .default(1),
    limit: z.coerce
      .number({
        message: "Limit must be a number",
      })
      .int("Limit must be an integer")
      .min(1, "Limit must be at least 1")
      .max(100, "Limit cannot exceed 100")
      .default(10),
    status: z
      .nativeEnum(TaskStatus, {
        message: "Invalid status filter",
      })
      .optional(),
    priority: z
      .nativeEnum(TaskPriority, {
        message: "Invalid priority filter",
      })
      .optional(),
    search: z.string().trim().optional(),
    sortBy: z
      .enum(["createdAt", "updatedAt", "dueDate", "title", "priority", "status"], {
        message: "Invalid sortBy field",
      })
      .default("createdAt"),
    sortOrder: z
      .enum(["asc", "desc"], {
        message: "SortOrder must be 'asc' or 'desc'",
      })
      .default("desc"),
    teamId: z.coerce
      .number({
        message: "Team ID must be a number",
      })
      .int("Team ID must be an integer")
      .positive("Team ID must be a positive integer")
      .optional(),
  })
  .strict();

export type TaskQueryInput = z.infer<typeof taskQuerySchema>;

export const taskIdParamSchema = z
  .object({
    id: z.coerce
      .number({
        message: "Task ID must be a number",
      })
      .int("Task ID must be an integer")
      .positive("Task ID must be a positive integer"),
  })
  .strict();

export type TaskIdParam = z.infer<typeof taskIdParamSchema>;
