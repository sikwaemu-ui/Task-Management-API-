import { Router } from "express";
import { register, login, getMe } from "../controllers/auth.controller";
import { validateBody } from "../middleware/validate.middleware";
import { authenticate } from "../middleware/auth.middleware";
import { registerSchema, loginSchema } from "../schemas/auth.schema";

const router = Router();

router.post("/register", validateBody(registerSchema), register);
router.post("/login", validateBody(loginSchema), login);
router.get("/me", authenticate, getMe);

export default router;
