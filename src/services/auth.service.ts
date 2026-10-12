import bcrypt from "bcryptjs";
import { Prisma, Role } from "@prisma/client";
import prisma from "../db/prisma";
import { RegisterInput, LoginInput } from "../schemas/auth.schema";
import { ConflictError, UnauthorizedError } from "../utils/errors";
import { generateToken } from "../utils/jwt";

const BCRYPT_SALT_ROUNDS = 12;

// Pre-computed dummy hash with cost factor 12 to mitigate timing attacks on nonexistent users
const DUMMY_BCRYPT_HASH =
  "$2a$12$e8rG.Lq3O2jFvK5E1g2fweP9wY5I0FhTjP1X4yH3pQ2d1K2J3L4m6";

export interface RegisteredUser {
  id: number;
  email: string;
  role: Role;
  createdAt: Date;
}

export interface LoginResponse {
  token: string;
  tokenType: "Bearer";
  user: {
    id: number;
    email: string;
    role: Role;
  };
}

export const registerUser = async (
  input: RegisterInput
): Promise<RegisteredUser> => {
  const { email, password } = input;

  // 1. Check if user already exists
  const existingUser = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });

  if (existingUser) {
    throw new ConflictError("An account with this email already exists");
  }

  // 2. Hash password with bcrypt cost factor of 12
  const hashedPassword = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

  // 3. Create user in database with default USER role
  try {
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
      },
      select: {
        id: true,
        email: true,
        role: true,
        createdAt: true,
      },
    });

    return user;
  } catch (error) {
    // Handle concurrent request unique-constraint violation safely
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new ConflictError("An account with this email already exists");
    }
    throw error;
  }
};

export const loginUser = async (input: LoginInput): Promise<LoginResponse> => {
  const { email, password } = input;

  // 1. Query user by normalized email
  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      password: true,
      role: true,
    },
  });

  // 2. Timing attack mitigation: always execute bcrypt compare
  const hashToCompare = user ? user.password : DUMMY_BCRYPT_HASH;
  const isPasswordValid = await bcrypt.compare(password, hashToCompare);

  // 3. Constant generic 401 error for both missing user and bad password
  if (!user || !isPasswordValid) {
    throw new UnauthorizedError("Invalid email or password");
  }

  // 4. Generate signed JWT token
  const token = generateToken({
    id: user.id,
    email: user.email,
    role: user.role,
  });

  return {
    token,
    tokenType: "Bearer",
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
    },
  };
};
