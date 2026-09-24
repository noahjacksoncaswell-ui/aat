import { Router } from "express";
import { z } from "zod";
import { MissionRole, Role, UserStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireLaunchDirector } from "../middleware/auth";
import { broadcastMissionUpdate } from "../websocket";

// v7.0 - mission-scoped personnel assignment (LD/RC/LWO/VSE/Ops Support).
// Genuinely separate data from the website RBAC role and from the
// pre-existing free-text UserMissionAssignment console roster (Section
// 2/10 of the directive) - see prisma/schema.prisma's MissionPersonnelAssignment
// comment for the full rationale.
const router = Router({ mergeParams: true });

function missionId(req: any): string {
  return (req.params as { missionId: string }).missionId;
}

const REQUIRED_ROLES: MissionRole[] = [MissionRole.LD, MissionRole.RC, MissionRole.LWO, MissionRole.VSE];

function serializeAssignment(a: any) {
  return {
    id: a.id,
    missionId: a.missionId,
    role: a.role,
    userId: a.userId,
    userName: a.user.name,
    assignedAt: a.assignedAt,
    assignedById: a.assignedById,
    assignedByName: a.assignedBy.name,
    attestationSignatureName: a.attestationSignatureName,
    attestationSignatureRole: a.attestationSignatureRole,
    attestationSignedAt: a.attestationSignedAt,
    onStationAt: a.onStationAt,
    offStationOverride: a.offStationOverride,
    offStationOverrideReason: a.offStationOverrideReason,
    offStationOverrideById: a.offStationOverrideById,
    offStationOverrideByName: a.offStationOverrideBy?.name ?? null,
    offStationOverrideAt: a.offStationOverrideAt,
  };
}

const ASSIGNMENT_INCLUDE = {
  user: { select: { id: true, name: true, role: true } },
  assignedBy: { select: { id: true, name: true } },
  offStationOverrideBy: { select: { id: true, name: true } },
};

router.get("/", async (req, res) => {
  const assignments = await prisma.missionPersonnelAssignment.findMany({
    where: { missionId: missionId(req) },
    include: ASSIGNMENT_INCLUDE,
    orderBy: { assignedAt: "asc" },
  });
  const serialized = assignments.map(serializeAssignment);
  const filledRoles = new Set(serialized.filter((a) => a.role !== "OPS_SUPPORT").map((a) => a.role));
  const missingRoles = REQUIRED_ROLES.filter((r) => !filledRoles.has(r));
  res.json({ assignments: serialized, missingRoles });
});

router.get("/history", async (req, res) => {
  const entries = await prisma.missionPersonnelAuditEntry.findMany({
    where: { missionId: missionId(req) },
    include: {
      actor: { select: { id: true, name: true } },
      previousUser: { select: { id: true, name: true } },
      newUser: { select: { id: true, name: true } },
    },
    orderBy: { timestamp: "desc" },
  });
  res.json(
    entries.map((e) => ({
      id: e.id,
      role: e.role,
      action: e.action,
      previousUserName: e.previousUser?.name ?? null,
      newUserName: e.newUser?.name ?? null,
      notes: e.notes,
      actorName: e.actor.name,
      timestamp: e.timestamp,
    }))
  );
});

/**
 * Assigns `userId` to `role` on `missionId`, replacing whoever previously
 * held that role (for singular roles LD/RC/LWO/VSE) and/or moving the user
 * off any other role they held on this mission (the DB-level invariant:
 * @@unique([missionId, userId]) - a person holds at most one role per
 * mission). Every change is recorded to the audit history (Section 5) -
 * never a silent overwrite.
 */
async function assignRole(params: {
  missionId: string;
  role: MissionRole;
  userId: string;
  assignedById: string;
  attestation?: { signatureName: string; signatureRole: string };
}) {
  const { missionId, role, userId, assignedById, attestation } = params;

  return prisma.$transaction(async (tx) => {
    const existingForUser = await tx.missionPersonnelAssignment.findUnique({
      where: { missionId_userId: { missionId, userId } },
    });
    const existingForRole =
      role === MissionRole.OPS_SUPPORT
        ? null
        : await tx.missionPersonnelAssignment.findFirst({ where: { missionId, role } });

    // Same person already holds this exact role - update in place (this is
    // how an LD re-attestation, or an Ops Support "re-add", is handled).
    if (existingForUser && existingForUser.role === role) {
      const updated = await tx.missionPersonnelAssignment.update({
        where: { id: existingForUser.id },
        data: {
          assignedById,
          assignedAt: new Date(),
          ...(attestation
            ? { attestationSignatureName: attestation.signatureName, attestationSignatureRole: attestation.signatureRole, attestationSignedAt: new Date() }
            : {}),
        },
        include: ASSIGNMENT_INCLUDE,
      });
      await tx.missionPersonnelAuditEntry.create({
        data: { missionId, role, action: "REASSIGNED", previousUserId: userId, newUserId: userId, actorId: assignedById, notes: "Re-affirmed" },
      });
      return updated;
    }

    // A different person currently holds this singular role - bump them.
    if (existingForRole && existingForRole.userId !== userId) {
      await tx.missionPersonnelAssignment.delete({ where: { id: existingForRole.id } });
    }
    // This user currently holds a different role on this mission - they're moving.
    if (existingForUser && existingForUser.role !== role) {
      await tx.missionPersonnelAssignment.delete({ where: { id: existingForUser.id } });
    }

    const created = await tx.missionPersonnelAssignment.create({
      data: {
        missionId,
        role,
        userId,
        assignedById,
        ...(attestation
          ? { attestationSignatureName: attestation.signatureName, attestationSignatureRole: attestation.signatureRole, attestationSignedAt: new Date() }
          : {}),
      },
      include: ASSIGNMENT_INCLUDE,
    });
    await tx.missionPersonnelAuditEntry.create({
      data: {
        missionId,
        role,
        action: existingForRole ? "REASSIGNED" : "ASSIGNED",
        previousUserId: existingForRole?.userId ?? null,
        newUserId: userId,
        actorId: assignedById,
      },
    });
    return created;
  });
}

const ldSchema = z.object({
  userId: z.string().min(1),
  signatureName: z.string().min(1),
  signatureRole: z.string().min(1),
});

// Section 4.2 - LD assignment. The assigning user must hold Admin or
// Launch Director website role; the confirmation/attestation text itself
// is presented and affirmed client-side (the exact verbatim strings live
// in the frontend, matching the LOT Submission form's e-signature
// convention), and the typed signature + server timestamp are recorded
// here as the signature of record.
router.post("/ld", requireLaunchDirector, async (req, res) => {
  const parsed = ldSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  // v7.0.2 Section 1.2 - Admin-website-role users are now eligible for LD
  // assignment too, identical in eligibility to Launch Director; this
  // supersedes v7.0's original exclusion of Admin from this dropdown.
  const candidate = await prisma.user.findUnique({ where: { id: parsed.data.userId } });
  if (!candidate || (candidate.role !== Role.LAUNCH_DIRECTOR && candidate.role !== Role.ADMIN) || candidate.status !== UserStatus.ACTIVE) {
    return res.status(400).json({ error: "Selected user is not an active Launch Director or Admin." });
  }

  const assignment = await assignRole({
    missionId: missionId(req),
    role: MissionRole.LD,
    userId: parsed.data.userId,
    assignedById: req.user!.id,
    attestation: { signatureName: parsed.data.signatureName, signatureRole: parsed.data.signatureRole },
  });
  broadcastMissionUpdate(missionId(req));
  res.status(201).json(serializeAssignment(assignment));
});

const operatorSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(["RC", "LWO", "VSE", "OPS_SUPPORT"]),
});

// Section 4.3 - RC/LWO/VSE/Ops Support assignment. Gated the same as LD
// assignment (Admin/Launch Director) - this page's assignment actions are
// mission-critical staffing changes, consistent with how this application
// gates comparable actions (mission actions, COA edits) elsewhere.
router.post("/operators", requireLaunchDirector, async (req, res) => {
  const parsed = operatorSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  // v7.0.2 Section 1.2 - Admin-website-role users are now eligible for
  // RC/LWO/VSE/Ops Support too, identical in eligibility to Operator.
  const candidate = await prisma.user.findUnique({ where: { id: parsed.data.userId } });
  if (!candidate || (candidate.role !== Role.OPERATOR && candidate.role !== Role.ADMIN) || candidate.status !== UserStatus.ACTIVE) {
    return res.status(400).json({ error: "Selected user is not an active Operator or Admin." });
  }

  const assignment = await assignRole({
    missionId: missionId(req),
    role: parsed.data.role as MissionRole,
    userId: parsed.data.userId,
    assignedById: req.user!.id,
  });
  broadcastMissionUpdate(missionId(req));
  res.status(201).json(serializeAssignment(assignment));
});

router.delete("/:assignmentId", requireLaunchDirector, async (req, res) => {
  const assignment = await prisma.missionPersonnelAssignment.findUnique({ where: { id: req.params.assignmentId } });
  if (!assignment || assignment.missionId !== missionId(req)) return res.status(404).json({ error: "Assignment not found" });

  await prisma.$transaction([
    prisma.missionPersonnelAssignment.delete({ where: { id: assignment.id } }),
    prisma.missionPersonnelAuditEntry.create({
      data: { missionId: assignment.missionId, role: assignment.role, action: "REMOVED", previousUserId: assignment.userId, actorId: req.user!.id },
    }),
  ]);
  broadcastMissionUpdate(missionId(req));
  res.status(204).send();
});

const stationSchema = z.object({ onStation: z.boolean() });

// Section 9 - self-check-in. The assignment holder toggles their own
// status; Admin/Launch Director may also correct it if needed.
router.post("/:assignmentId/station", async (req, res) => {
  const parsed = stationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const assignment = await prisma.missionPersonnelAssignment.findUnique({ where: { id: req.params.assignmentId } });
  if (!assignment || assignment.missionId !== missionId(req)) return res.status(404).json({ error: "Assignment not found" });

  const isSelf = assignment.userId === req.user!.id;
  const isElevated = req.user!.role === Role.ADMIN || req.user!.role === Role.LAUNCH_DIRECTOR;
  if (!isSelf && !isElevated) return res.status(403).json({ error: "Only the assigned person, an Admin, or a Launch Director may change on-station status." });

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.missionPersonnelAssignment.update({
      where: { id: assignment.id },
      data: { onStationAt: parsed.data.onStation ? new Date() : null },
      include: ASSIGNMENT_INCLUDE,
    });
    await tx.missionPersonnelAuditEntry.create({
      data: {
        missionId: assignment.missionId,
        role: assignment.role,
        action: parsed.data.onStation ? "ON_STATION" : "OFF_STATION",
        newUserId: assignment.userId,
        actorId: req.user!.id,
      },
    });
    return u;
  });
  broadcastMissionUpdate(missionId(req));
  res.json(serializeAssignment(updated));
});

const overrideSchema = z.object({ reason: z.string().min(1) });

// Section 8.1 - off-station override, verbatim attestation text is
// presented/affirmed client-side; server records the reason and actor.
router.post("/:assignmentId/override", requireLaunchDirector, async (req, res) => {
  const parsed = overrideSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const assignment = await prisma.missionPersonnelAssignment.findUnique({ where: { id: req.params.assignmentId } });
  if (!assignment || assignment.missionId !== missionId(req)) return res.status(404).json({ error: "Assignment not found" });
  if (!REQUIRED_ROLES.includes(assignment.role)) return res.status(400).json({ error: "Override applies only to LD/RC/LWO/VSE." });

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.missionPersonnelAssignment.update({
      where: { id: assignment.id },
      data: { offStationOverride: true, offStationOverrideReason: parsed.data.reason, offStationOverrideById: req.user!.id, offStationOverrideAt: new Date() },
      include: ASSIGNMENT_INCLUDE,
    });
    await tx.missionPersonnelAuditEntry.create({
      data: {
        missionId: assignment.missionId,
        role: assignment.role,
        action: "OFF_STATION_OVERRIDE",
        newUserId: assignment.userId,
        actorId: req.user!.id,
        notes: parsed.data.reason,
      },
    });
    return u;
  });
  broadcastMissionUpdate(missionId(req));
  res.json(serializeAssignment(updated));
});

// Section 5 - overrides remain editable, same as every other assignment on
// this page.
router.delete("/:assignmentId/override", requireLaunchDirector, async (req, res) => {
  const assignment = await prisma.missionPersonnelAssignment.findUnique({ where: { id: req.params.assignmentId } });
  if (!assignment || assignment.missionId !== missionId(req)) return res.status(404).json({ error: "Assignment not found" });

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.missionPersonnelAssignment.update({
      where: { id: assignment.id },
      data: { offStationOverride: false, offStationOverrideReason: null, offStationOverrideById: null, offStationOverrideAt: null },
      include: ASSIGNMENT_INCLUDE,
    });
    await tx.missionPersonnelAuditEntry.create({
      data: { missionId: assignment.missionId, role: assignment.role, action: "OFF_STATION_OVERRIDE_CLEARED", newUserId: assignment.userId, actorId: req.user!.id },
    });
    return u;
  });
  broadcastMissionUpdate(missionId(req));
  res.json(serializeAssignment(updated));
});

export default router;
