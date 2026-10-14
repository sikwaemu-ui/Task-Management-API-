import { Router } from "express";
import {
  createTeam,
  listTeams,
  getTeam,
  updateTeam,
  addMember,
  removeMember,
} from "../controllers/team.controller";
import { authenticate } from "../middleware/auth.middleware";
import {
  validateBody,
  validateQuery,
  validateParams,
} from "../middleware/validate.middleware";
import {
  createTeamSchema,
  updateTeamSchema,
  teamQuerySchema,
  teamIdParamSchema,
  addMemberSchema,
  teamMemberParamSchema,
} from "../schemas/team.schema";

const router = Router();

// Enforce JWT authentication across all team routes
router.use(authenticate);

// POST /api/teams - Create a team
router.post("/", validateBody(createTeamSchema), createTeam);

// GET /api/teams - List teams the authenticated user belongs to
router.get("/", validateQuery(teamQuerySchema), listTeams);

// GET /api/teams/:id - Retrieve team details and members
router.get("/:id", validateParams(teamIdParamSchema), getTeam);

// PATCH /api/teams/:id - Update team details (name)
router.patch(
  "/:id",
  validateParams(teamIdParamSchema),
  validateBody(updateTeamSchema),
  updateTeam
);

// POST /api/teams/:id/members - Add an existing user to the team
router.post(
  "/:id/members",
  validateParams(teamIdParamSchema),
  validateBody(addMemberSchema),
  addMember
);

// DELETE /api/teams/:id/members/:userId - Remove a member from the team
router.delete(
  "/:id/members/:userId",
  validateParams(teamMemberParamSchema),
  removeMember
);

export default router;
