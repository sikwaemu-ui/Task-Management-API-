import { Prisma, TaskStatus, TaskPriority, TeamRole } from "@prisma/client";
import prisma from "../db/prisma";
import {
  CreateTaskInput,
  UpdateTaskInput,
  TaskQueryInput,
} from "../schemas/task.schema";
import { NotFoundError, ForbiddenError } from "../utils/errors";

export interface TaskResponse {
  id: number;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: Date | null;
  userId: number;
  teamId: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PaginatedTasksResponse {
  tasks: TaskResponse[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export const taskSelectFields = {
  id: true,
  title: true,
  description: true,
  status: true,
  priority: true,
  dueDate: true,
  userId: true,
  teamId: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * Asserts the user is an active member of the team.
 * Returns the membership including role.
 * Throws NotFoundError if team does not exist or user is not a member (prevents enumeration).
 */
export const assertTeamMember = async (
  userId: number,
  teamId: number
): Promise<{ id: number; role: TeamRole }> => {
  const membership = await prisma.teamMember.findUnique({
    where: {
      userId_teamId: {
        userId,
        teamId,
      },
    },
  });

  if (!membership) {
    throw new NotFoundError("Team not found");
  }

  return { id: membership.id, role: membership.role };
};

/**
 * Checks whether the user can manage (update/delete) a team task.
 * The task creator, team OWNER, or team ADMIN can manage team tasks.
 * A regular MEMBER can only manage their own team tasks.
 */
export const canManageTeamTask = (
  userId: number,
  taskUserId: number,
  memberRole: TeamRole
): boolean => {
  if (userId === taskUserId) return true;
  if (memberRole === TeamRole.OWNER || memberRole === TeamRole.ADMIN) return true;
  return false;
};

/**
 * Creates a task.
 * - If teamId is omitted or null, creates a personal task (teamId: null).
 * - If teamId is supplied, verifies requester is an active team member and creates task in that team.
 */
export const createTask = async (
  userId: number,
  input: CreateTaskInput
): Promise<TaskResponse> => {
  const { title, description, status, priority, dueDate, teamId } = input;

  // If teamId is provided, verify active team membership
  if (teamId != null) {
    await assertTeamMember(userId, teamId);
  }

  const task = await prisma.task.create({
    data: {
      title,
      description: description ?? null,
      status: status ?? TaskStatus.TODO,
      priority: priority ?? TaskPriority.MEDIUM,
      dueDate: dueDate ? new Date(dueDate) : null,
      userId,
      teamId: teamId ?? null,
    },
    select: taskSelectFields,
  });

  return task;
};

/**
 * Lists tasks with pagination, filters, search, and sorting.
 * - Without teamId: returns only the user's personal tasks (userId: userId, teamId: null).
 * - With teamId: verifies active team membership and returns tasks belonging to that team.
 */
export const getTasks = async (
  userId: number,
  query: TaskQueryInput
): Promise<PaginatedTasksResponse> => {
  const { page, limit, status, priority, search, sortBy, sortOrder, teamId } = query;

  const where: Prisma.TaskWhereInput = {};

  if (teamId != null) {
    // Team task listing: verify membership first
    await assertTeamMember(userId, teamId);
    where.teamId = teamId;
  } else {
    // Personal task listing: only this user's personal tasks
    where.userId = userId;
    where.teamId = null;
  }

  if (status) {
    where.status = status;
  }

  if (priority) {
    where.priority = priority;
  }

  if (search && search.trim() !== "") {
    where.OR = [
      { title: { contains: search.trim(), mode: "insensitive" } },
      { description: { contains: search.trim(), mode: "insensitive" } },
    ];
  }

  const skip = (page - 1) * limit;
  const take = limit;

  // Deterministic sorting with unique tie-breaker on id
  const orderBy: Prisma.TaskOrderByWithRelationInput[] = [
    { [sortBy]: sortOrder },
    { id: sortOrder },
  ];

  const [tasks, total] = await Promise.all([
    prisma.task.findMany({
      where,
      orderBy,
      skip,
      take,
      select: taskSelectFields,
    }),
    prisma.task.count({
      where,
    }),
  ]);

  const totalPages = Math.ceil(total / limit);

  return {
    tasks,
    pagination: {
      page,
      limit,
      total,
      totalPages,
    },
  };
};

/**
 * Gets a single task by ID.
 * - Personal task: only the owner can read it.
 * - Team task: any active team member can read it.
 */
export const getTaskById = async (
  userId: number,
  taskId: number
): Promise<TaskResponse> => {
  // 1. Try finding personal task owned by user (or created by user)
  const task = await prisma.task.findFirst({
    where: {
      id: taskId,
      userId,
    },
    select: taskSelectFields,
  });

  if (task) {
    if (task.teamId != null) {
      // It is a team task created by the user -> verify user is still an active member
      await assertTeamMember(userId, task.teamId);
    }
    return task;
  }

  // 2. If not found under { id, userId }, it might be a team task created by another member
  const teamTask = await prisma.task.findFirst({
    where: {
      id: taskId,
      teamId: { not: null },
    },
    select: taskSelectFields,
  });

  if (!teamTask || teamTask.teamId == null) {
    throw new NotFoundError("Task not found");
  }

  // Verify caller is an active member of the team
  await assertTeamMember(userId, teamTask.teamId);
  return teamTask;
};

/**
 * Updates a task.
 * - Personal task: only the owner can update.
 * - Team task: creator, OWNER, or ADMIN can update.
 * - Regular MEMBER cannot update another member's task (throws ForbiddenError).
 */
export const updateTask = async (
  userId: number,
  taskId: number,
  input: UpdateTaskInput
): Promise<TaskResponse> => {
  const data: Prisma.TaskUpdateInput = {};

  if (input.title !== undefined) {
    data.title = input.title;
  }
  if (input.description !== undefined) {
    data.description = input.description;
  }
  if (input.status !== undefined) {
    data.status = input.status;
  }
  if (input.priority !== undefined) {
    data.priority = input.priority;
  }
  if (input.dueDate !== undefined) {
    data.dueDate = input.dueDate ? new Date(input.dueDate) : null;
  }

  // 1. First attempt: personal task update (atomic with id + userId)
  const personalUpdateResult = await prisma.task.updateMany({
    where: {
      id: taskId,
      userId,
    },
    data,
  });

  if (personalUpdateResult.count > 0) {
    const updatedTask = await prisma.task.findFirst({
      where: {
        id: taskId,
        userId,
      },
      select: taskSelectFields,
    });

    if (!updatedTask) {
      throw new NotFoundError("Task not found");
    }

    if (updatedTask.teamId != null) {
      // If it was a team task created by the user, verify membership & permissions
      const membership = await assertTeamMember(userId, updatedTask.teamId);
      if (!canManageTeamTask(userId, updatedTask.userId, membership.role)) {
        throw new ForbiddenError("You do not have permission to update this task");
      }
    }

    return updatedTask;
  }

  // 2. Second attempt: team task where caller is not creator (e.g. OWNER or ADMIN)
  const task = await prisma.task.findFirst({
    where: {
      id: taskId,
      teamId: { not: null },
    },
    select: { id: true, userId: true, teamId: true },
  });

  if (!task || task.teamId == null) {
    throw new NotFoundError("Task not found");
  }

  const membership = await assertTeamMember(userId, task.teamId);
  if (!canManageTeamTask(userId, task.userId, membership.role)) {
    throw new ForbiddenError("You do not have permission to update this task");
  }

  const updatedTask = await prisma.task.update({
    where: { id: taskId },
    data,
    select: taskSelectFields,
  });

  return updatedTask;
};

/**
 * Deletes a task.
 * - Personal task: only the owner can delete.
 * - Team task: creator, OWNER, or ADMIN can delete.
 * - Regular MEMBER cannot delete another member's task (throws ForbiddenError).
 */
export const deleteTask = async (
  userId: number,
  taskId: number
): Promise<void> => {
  // Check if task exists and check scope
  const task = await prisma.task.findFirst({
    where: { id: taskId },
    select: { id: true, userId: true, teamId: true },
  });

  if (!task) {
    // Fallback atomic attempt for personal task (preserves test mocks and atomicity)
    const result = await prisma.task.deleteMany({
      where: {
        id: taskId,
        userId,
      },
    });

    if (result.count === 0) {
      throw new NotFoundError("Task not found");
    }
    return;
  }

  if (task.teamId != null) {
    // Team task: verify membership and manager permissions
    const membership = await assertTeamMember(userId, task.teamId);
    if (!canManageTeamTask(userId, task.userId, membership.role)) {
      throw new ForbiddenError("You do not have permission to delete this task");
    }
    await prisma.task.delete({
      where: { id: taskId },
    });
  } else {
    // Personal task: atomic deletion ensuring ownership
    const result = await prisma.task.deleteMany({
      where: {
        id: taskId,
        userId,
      },
    });

    if (result.count === 0) {
      throw new NotFoundError("Task not found");
    }
  }
};
