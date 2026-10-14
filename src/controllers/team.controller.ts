import { Request, Response, NextFunction } from "express";
import * as teamService from "../services/team.service";
import {
  CreateTeamInput,
  UpdateTeamInput,
  TeamQueryInput,
  AddMemberInput,
} from "../schemas/team.schema";
import { UnauthorizedError } from "../utils/errors";

export const createTeam = async (
  req: Request<{}, {}, CreateTeamInput>,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      throw new UnauthorizedError("Authentication required");
    }

    const team = await teamService.createTeam(req.user.id, req.body);

    res.status(201).json({
      success: true,
      message: "Team created successfully",
      data: {
        team,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const listTeams = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      throw new UnauthorizedError("Authentication required");
    }

    const result = await teamService.getTeams(
      req.user.id,
      req.query as unknown as TeamQueryInput
    );

    res.status(200).json({
      success: true,
      message: "Teams retrieved successfully",
      data: {
        teams: result.teams,
        pagination: result.pagination,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const getTeam = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      throw new UnauthorizedError("Authentication required");
    }

    const teamId = Number(req.params.id);
    const team = await teamService.getTeamById(req.user.id, teamId);

    res.status(200).json({
      success: true,
      message: "Team retrieved successfully",
      data: {
        team,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const updateTeam = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      throw new UnauthorizedError("Authentication required");
    }

    const teamId = Number(req.params.id);
    const team = await teamService.updateTeam(
      req.user.id,
      teamId,
      req.body as UpdateTeamInput
    );

    res.status(200).json({
      success: true,
      message: "Team updated successfully",
      data: {
        team,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const addMember = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      throw new UnauthorizedError("Authentication required");
    }

    const teamId = Number(req.params.id);
    const member = await teamService.addMember(
      req.user.id,
      teamId,
      req.body as AddMemberInput
    );

    res.status(201).json({
      success: true,
      message: "Team member added successfully",
      data: {
        member,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const removeMember = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      throw new UnauthorizedError("Authentication required");
    }

    const teamId = Number(req.params.id);
    const targetUserId = Number(req.params.userId);

    await teamService.removeMember(req.user.id, teamId, targetUserId);

    res.status(200).json({
      success: true,
      message: "Team member removed successfully",
    });
  } catch (error) {
    next(error);
  }
};
