import { Request, Response, NextFunction } from "express";
import { RegisterInput, LoginInput } from "../schemas/auth.schema";
import * as authService from "../services/auth.service";
import { UnauthorizedError } from "../utils/errors";

export const register = async (
  req: Request<{}, {}, RegisterInput>,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const user = await authService.registerUser(req.body);

    res.status(201).json({
      success: true,
      message: "Account created successfully",
      data: {
        user,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const login = async (
  req: Request<{}, {}, LoginInput>,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const result = await authService.loginUser(req.body);

    res.status(200).json({
      success: true,
      message: "Login successful",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

export const getMe = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      throw new UnauthorizedError("Authentication required");
    }

    const user = await authService.getUserProfile(req.user.id);

    res.status(200).json({
      success: true,
      message: "User profile retrieved successfully",
      data: {
        user,
      },
    });
  } catch (error) {
    next(error);
  }
};
