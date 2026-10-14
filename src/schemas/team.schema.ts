import { z } from "zod";

export const createTeamSchema = z
  .object({
    name: z
      .string({
        message: "Team name is required",
      })
      .trim()
      .min(1, "Team name must be at least 1 character long")
      .max(100, "Team name cannot exceed 100 characters"),
  })
  .strict();

export type CreateTeamInput = z.infer<typeof createTeamSchema>;

export const updateTeamSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Team name cannot be empty")
      .max(100, "Team name cannot exceed 100 characters")
      .optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided for update",
  });

export type UpdateTeamInput = z.infer<typeof updateTeamSchema>;

export const teamQuerySchema = z
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
  })
  .strict();

export type TeamQueryInput = z.infer<typeof teamQuerySchema>;

export const teamIdParamSchema = z
  .object({
    id: z.coerce
      .number({
        message: "Team ID must be a number",
      })
      .int("Team ID must be an integer")
      .positive("Team ID must be a positive integer"),
  })
  .strict();

export type TeamIdParam = z.infer<typeof teamIdParamSchema>;

export const addMemberSchema = z
  .object({
    email: z
      .string()
      .trim()
      .toLowerCase()
      .email("Invalid email format")
      .optional(),
    userId: z.coerce
      .number()
      .int("User ID must be an integer")
      .positive("User ID must be a positive integer")
      .optional(),
  })
  .strict()
  .refine((data) => data.email !== undefined || data.userId !== undefined, {
    message: "Either email or userId must be provided",
  });

export type AddMemberInput = z.infer<typeof addMemberSchema>;

export const teamMemberParamSchema = z
  .object({
    id: z.coerce
      .number({
        message: "Team ID must be a number",
      })
      .int("Team ID must be an integer")
      .positive("Team ID must be a positive integer"),
    userId: z.coerce
      .number({
        message: "User ID must be a number",
      })
      .int("User ID must be an integer")
      .positive("User ID must be a positive integer"),
  })
  .strict();

export type TeamMemberParam = z.infer<typeof teamMemberParamSchema>;
