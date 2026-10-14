import { Prisma, TeamRole } from "@prisma/client";
import prisma from "../db/prisma";
import {
  CreateTeamInput,
  UpdateTeamInput,
  TeamQueryInput,
  AddMemberInput,
} from "../schemas/team.schema";
import {
  NotFoundError,
  ForbiddenError,
  ConflictError,
  BadRequestError,
} from "../utils/errors";

export interface TeamMemberResponse {
  id: number;
  teamId: number;
  userId: number;
  role: TeamRole;
  createdAt: Date;
  user: {
    id: number;
    email: string;
    role: string;
  };
}

export interface TeamDetailResponse {
  id: number;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  myRole: TeamRole;
  members: TeamMemberResponse[];
}

export interface TeamSummaryResponse {
  id: number;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  myRole: TeamRole;
  memberCount: number;
}

export interface PaginatedTeamsResponse {
  teams: TeamSummaryResponse[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

const userSafeSelect = {
  id: true,
  email: true,
  role: true,
} as const;

/**
 * Verifies that the user belongs to the team and possesses manager privileges (OWNER or ADMIN).
 * If the user is not a member of the team, throws NotFoundError to prevent private team enumeration.
 * If the user is an ordinary MEMBER, throws ForbiddenError.
 */
export const assertTeamManager = async (
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

  if (membership.role !== TeamRole.OWNER && membership.role !== TeamRole.ADMIN) {
    throw new ForbiddenError("You do not have permission to manage this team");
  }

  return { id: membership.id, role: membership.role };
};

/**
 * Creates a team and atomically assigns the creator as OWNER in TeamMember.
 */
export const createTeam = async (
  userId: number,
  input: CreateTeamInput
): Promise<TeamSummaryResponse> => {
  const result = await prisma.$transaction(async (tx) => {
    const team = await tx.team.create({
      data: {
        name: input.name,
      },
    });

    const membership = await tx.teamMember.create({
      data: {
        teamId: team.id,
        userId,
        role: TeamRole.OWNER,
      },
    });

    return {
      team,
      membership,
    };
  });

  return {
    id: result.team.id,
    name: result.team.name,
    createdAt: result.team.createdAt,
    updatedAt: result.team.updatedAt,
    myRole: result.membership.role,
    memberCount: 1,
  };
};

/**
 * Lists teams that the authenticated user belongs to with pagination.
 */
export const getTeams = async (
  userId: number,
  query: TeamQueryInput
): Promise<PaginatedTeamsResponse> => {
  const { page, limit } = query;
  const skip = (page - 1) * limit;
  const take = limit;

  const where: Prisma.TeamWhereInput = {
    memberships: {
      some: {
        userId,
      },
    },
  };

  const [teams, total] = await Promise.all([
    prisma.team.findMany({
      where,
      skip,
      take,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        name: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            memberships: true,
          },
        },
        memberships: {
          where: {
            userId,
          },
          select: {
            role: true,
          },
        },
      },
    }),
    prisma.team.count({
      where,
    }),
  ]);

  const totalPages = Math.ceil(total / limit);

  const formattedTeams: TeamSummaryResponse[] = teams.map((team) => ({
    id: team.id,
    name: team.name,
    createdAt: team.createdAt,
    updatedAt: team.updatedAt,
    myRole: team.memberships[0]?.role ?? TeamRole.MEMBER,
    memberCount: team._count.memberships,
  }));

  return {
    teams: formattedTeams,
    pagination: {
      page,
      limit,
      total,
      totalPages,
    },
  };
};

/**
 * Retrieves team details and member list for an authorized team member.
 * Non-members receive a generic NotFoundError to prevent team existence enumeration.
 */
export const getTeamById = async (
  userId: number,
  teamId: number
): Promise<TeamDetailResponse> => {
  const team = await prisma.team.findFirst({
    where: {
      id: teamId,
      memberships: {
        some: {
          userId,
        },
      },
    },
    select: {
      id: true,
      name: true,
      createdAt: true,
      updatedAt: true,
      memberships: {
        orderBy: {
          createdAt: "asc",
        },
        select: {
          id: true,
          teamId: true,
          userId: true,
          role: true,
          createdAt: true,
          user: {
            select: userSafeSelect,
          },
        },
      },
    },
  });

  if (!team) {
    throw new NotFoundError("Team not found");
  }

  const myMembership = team.memberships.find((m) => m.userId === userId);

  return {
    id: team.id,
    name: team.name,
    createdAt: team.createdAt,
    updatedAt: team.updatedAt,
    myRole: myMembership?.role ?? TeamRole.MEMBER,
    members: team.memberships,
  };
};

/**
 * Updates team name. Requires OWNER or ADMIN permission.
 */
export const updateTeam = async (
  userId: number,
  teamId: number,
  input: UpdateTeamInput
): Promise<{ id: number; name: string; updatedAt: Date }> => {
  await assertTeamManager(userId, teamId);

  const updatedTeam = await prisma.team.update({
    where: {
      id: teamId,
    },
    data: {
      name: input.name,
    },
    select: {
      id: true,
      name: true,
      updatedAt: true,
    },
  });

  return updatedTeam;
};

/**
 * Adds an existing user to a team with default role MEMBER.
 * Requires OWNER or ADMIN permission.
 */
export const addMember = async (
  callerUserId: number,
  teamId: number,
  input: AddMemberInput
): Promise<TeamMemberResponse> => {
  await assertTeamManager(callerUserId, teamId);

  // Find target user
  let targetUser = null;
  if (input.email) {
    targetUser = await prisma.user.findUnique({
      where: { email: input.email },
      select: userSafeSelect,
    });
  } else if (input.userId) {
    targetUser = await prisma.user.findUnique({
      where: { id: input.userId },
      select: userSafeSelect,
    });
  }

  if (!targetUser) {
    throw new NotFoundError("User not found");
  }

  // Prevent duplicate membership
  const existingMembership = await prisma.teamMember.findUnique({
    where: {
      userId_teamId: {
        userId: targetUser.id,
        teamId,
      },
    },
  });

  if (existingMembership) {
    throw new ConflictError("User is already a member of this team");
  }

  // Assign default MEMBER role (do not allow caller to set arbitrary role)
  const newMembership = await prisma.teamMember.create({
    data: {
      teamId,
      userId: targetUser.id,
      role: TeamRole.MEMBER,
    },
    select: {
      id: true,
      teamId: true,
      userId: true,
      role: true,
      createdAt: true,
      user: {
        select: userSafeSelect,
      },
    },
  });

  return newMembership;
};

/**
 * Removes a member from a team.
 * Requires OWNER or ADMIN permission. Prevents removal of the last owner.
 */
export const removeMember = async (
  callerUserId: number,
  teamId: number,
  targetUserId: number
): Promise<void> => {
  const caller = await assertTeamManager(callerUserId, teamId);

  const targetMembership = await prisma.teamMember.findUnique({
    where: {
      userId_teamId: {
        userId: targetUserId,
        teamId,
      },
    },
  });

  if (!targetMembership) {
    throw new NotFoundError("Team member not found");
  }

  // Ownership removal protection
  if (targetMembership.role === TeamRole.OWNER) {
    if (caller.role !== TeamRole.OWNER) {
      throw new ForbiddenError("Only team owners can remove an owner");
    }

    const ownerCount = await prisma.teamMember.count({
      where: {
        teamId,
        role: TeamRole.OWNER,
      },
    });

    if (ownerCount <= 1) {
      throw new BadRequestError(
        "Cannot remove the only owner of the team. Transfer ownership before leaving or removing."
      );
    }
  }

  await prisma.teamMember.delete({
    where: {
      id: targetMembership.id,
    },
  });
};
