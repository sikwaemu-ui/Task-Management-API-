import { z } from "zod";

export const registerSchema = z
  .object({
    email: z
      .string({
        message: "Email is required",
      })
      .trim()
      .toLowerCase()
      .email({
        message: "Invalid email address",
      }),
    password: z
      .string({
        message: "Password is required",
      })
      .min(8, {
        message: "Password must be at least 8 characters long",
      })
      .refine(
        (val) => Buffer.byteLength(val, "utf8") <= 72,
        {
          message: "Password cannot exceed 72 bytes",
        }
      ),
  })
  .strict();

export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z
  .object({
    email: z
      .string({
        message: "Email is required",
      })
      .trim()
      .toLowerCase()
      .email({
        message: "Invalid email address",
      }),
    password: z
      .string({
        message: "Password is required",
      })
      .min(1, {
        message: "Password is required",
      })
      .refine(
        (val) => Buffer.byteLength(val, "utf8") <= 72,
        {
          message: "Password cannot exceed 72 bytes",
        }
      ),
  })
  .strict();

export type LoginInput = z.infer<typeof loginSchema>;
