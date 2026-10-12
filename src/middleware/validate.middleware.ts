import { Request, Response, NextFunction } from "express";
import { ZodSchema } from "zod";

export const validateBody = (schema: ZodSchema) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      const formattedErrors = result.error.issues.map((issue) => {
        const field =
          issue.path.length > 0
            ? issue.path.join(".")
            : issue.code === "unrecognized_keys" && "keys" in issue
            ? (issue as { keys: string[] }).keys.join(", ")
            : "body";

        return {
          field,
          message: issue.message,
        };
      });

      res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: formattedErrors,
      });
      return;
    }

    req.body = result.data;
    next();
  };
};
