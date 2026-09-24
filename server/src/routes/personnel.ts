import { Router } from "express";
import { z } from "zod";
import { MissionRole, QualificationRole, Role, UserStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireLaunchDirector } from "../middleware/auth";
import { isUserOnline } from "../websocket";

// v7.0 Section 3 - Personnel & Stations top-of-page list, qualification
// tags, and the sidebar's 24-hour "my station" lookup (Section 9).
const router = Router();

// Section 3, as revised by v7.0.2 Section 1.1 - active Launch Director,
// Operator, or Admin website-role users; Viewer remains excluded (Admin is
// now eligible for mission-role assignment per v7.0.2 Section 1.2, which
// reverses v7.0's original Admin exclusion).
router.get("/", async (_req, res) => {
  const users = await prisma.user.findMany({
    where: { status: UserStatus.ACTIVE, role: { in: [Role.LAUNCH_DIRECTOR, Role.OPERATOR, Role.ADMIN] } },
    orderBy: { name: "asc" },
    include: { qualifications: true },
  });
  res.json(
    users.map((u) => ({
      id: u.id,
      name: u.name,
      websiteRole: u.role,
      isOnline: isUserOnline(u.id),
      qualifications: u.qualifications.map((q) => ({
        role: q.role,
        expiresAt: q.expiresAt,
        active: !q.expiresAt || q.expiresAt.getTime() > Date.now(),
      })),
    }))
  );
});

const qualificationSchema = z.object({
  role: z.enum(["RC", "LWO", "VSE"]),
  expiresAt: z.string().nullable().optional(),
});

// Section 3.1 - a person-level attribute, set/edited from this list; never
// part of the Admin panel's website-role/permission controls.
router.post("/:userId/qualifications", requireLaunchDirector, async (req, res) => {
  const parsed = qualificationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const target = await prisma.user.findUnique({ where: { id: req.params.userId } });
  if (!target || (target.role !== Role.LAUNCH_DIRECTOR && target.role !== Role.OPERATOR && target.role !== Role.ADMIN)) {
    return res.status(400).json({ error: "Qualification tags apply only to Launch Director, Operator, or Admin users." });
  }

  const qualification = await prisma.personnelQualification.upsert({
    where: { userId_role: { userId: req.params.userId, role: parsed.data.role as QualificationRole } },
    update: { expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null, createdById: req.user!.id },
    create: {
      userId: req.params.userId,
      role: parsed.data.role as QualificationRole,
      expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
      createdById: req.user!.id,
    },
  });
  res.status(201).json(qualification);
});

router.delete("/:userId/qualifications/:role", requireLaunchDirector, async (req, res) => {
  await prisma.personnelQualification.deleteMany({
    where: { userId: req.params.userId, role: req.params.role as QualificationRole },
  });
  res.status(204).send();
});

// Section 9 - resolves the current user's qualifying near-term (within 24h,
// including any currently-active window) mission personnel assignment, if
// any, for the sidebar's 4-state check-in control. Mirrors the same
// nearest-targeted-launch-opportunity pattern already used by the
// Dashboard and Range Ops Display.
router.get("/my-station", async (req, res) => {
  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const assignments = await prisma.missionPersonnelAssignment.findMany({
    where: { userId: req.user!.id },
    include: {
      mission: {
        select: {
          id: true,
          designator: true,
          launchPeriodEntries: { where: { isTargeted: true }, select: { windowOpen: true, windowClose: true } },
        },
      },
    },
  });

  const qualifying = assignments
    .map((a) => {
      const targeted = a.mission.launchPeriodEntries[0];
      if (!targeted) return null;
      const opensWithin24h = targeted.windowOpen <= in24h && targeted.windowOpen >= now;
      const currentlyActive = targeted.windowOpen <= now && targeted.windowClose >= now;
      if (!opensWithin24h && !currentlyActive) return null;
      return { assignment: a, windowOpen: targeted.windowOpen };
    })
    .filter((x): x is { assignment: (typeof assignments)[number]; windowOpen: Date } => !!x)
    .sort((a, b) => a.windowOpen.getTime() - b.windowOpen.getTime());

  const nearest = qualifying[0];
  if (!nearest) return res.json({ state: "NO_ASSIGNMENT" });

  const a = nearest.assignment;
  res.json({
    state: a.onStationAt ? "ON_STATION" : "REPORT_TO_STATION",
    assignmentId: a.id,
    missionId: a.missionId,
    missionDesignator: a.mission.designator,
    missionRole: a.role,
    onStationAt: a.onStationAt,
  });
});

export default router;
