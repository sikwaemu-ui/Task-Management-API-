import { Request, Response, NextFunction } from "express";
import * as taskService from "../services/task.service";
import {
  CreateTaskInput,
  UpdateTaskInput,
  TaskQueryInput,
  TaskIdParam,
} from "../schemas/task.schema";
import { UnauthorizedError } from "../utils/errors";

export const createTask = async (
  req: Request<{}, {}, CreateTaskInput>,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      throw new UnauthorizedError("Authentication required");
    }

    const task = await taskService.createTask(req.user.id, req.body);

    res.status(201).json({
      success: true,
      message: "Task created successfully",
      data: {
        task,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const listTasks = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      throw new UnauthorizedError("Authentication required");
    }

    const result = await taskService.getTasks(
      req.user.id,
      req.query as unknown as TaskQueryInput
    );

    res.status(200).json({
      success: true,
      message: "Tasks retrieved successfully",
      data: {
        tasks: result.tasks,
        pagination: result.pagination,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const getTask = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      throw new UnauthorizedError("Authentication required");
    }

    const taskId = Number(req.params.id);
    const task = await taskService.getTaskById(req.user.id, taskId);

    res.status(200).json({
      success: true,
      message: "Task retrieved successfully",
      data: {
        task,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const updateTask = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      throw new UnauthorizedError("Authentication required");
    }

    const taskId = Number(req.params.id);
    const task = await taskService.updateTask(
      req.user.id,
      taskId,
      req.body as UpdateTaskInput
    );

    res.status(200).json({
      success: true,
      message: "Task updated successfully",
      data: {
        task,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const deleteTask = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      throw new UnauthorizedError("Authentication required");
    }

    const taskId = Number(req.params.id);
    await taskService.deleteTask(req.user.id, taskId);

    res.status(200).json({
      success: true,
      message: "Task deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};
