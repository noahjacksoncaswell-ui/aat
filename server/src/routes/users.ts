import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { Role, UserStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireAdmin } from "../middleware/auth";
import { recordAudit } from "../services/audit";

const router = Router();

// All routes in this file are Admin-only (user management - Module 6).
router.use(requireAdmin);

router.get("/", async (_req, res) => {
  const users = await prisma.user.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
      createdAt: true,
      assignedSites: { select: { site: { select: { id: true, name: true, designator: true } } } },
      assignedMissions: { select: { mission: { select: { id: true, name: true, designator: true } }, role: true } },
    },
  });
  res.json(users);
});

const createSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.nativeEnum(Role),
  siteIds: z.array(z.string()).optional(),
  missionIds: z.array(z.string()).optional(),
});

router.post("/", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { name, email, password, role, siteIds = [], missionIds = [] } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (existing) return res.status(409).json({ error: "A user with that email already exists" });

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: {
      name,
      email: email.toLowerCase(),
      passwordHash,
      role,
      assignedSites: { create: siteIds.map((siteId) => ({ siteId })) },
      assignedMissions: { create: missionIds.map((missionId) => ({ missionId })) },
    },
  });

  await recordAudit({ userId: req.user!.id, action: "USER_CREATED", targetType: "User", targetId: user.id, metadata: { email, role } });
  res.status(201).json({ id: user.id, name: user.name, email: user.email, role: user.role, status: user.status });
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  role: z.nativeEnum(Role).optional(),
  status: z.nativeEnum(UserStatus).optional(),
  password: z.string().min(8).optional(),
  siteIds: z.array(z.string()).optional(),
  missionIds: z.array(z.string()).optional(),
});

router.patch("/:id", async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { siteIds, missionIds, password, ...rest } = parsed.data;

  const data: Record<string, unknown> = { ...rest };
  if (password) data.passwordHash = await bcrypt.hash(password, 12);

  if (siteIds) {
    await prisma.userSiteAssignment.deleteMany({ where: { userId: req.params.id } });
    await prisma.userSiteAssignment.createMany({ data: siteIds.map((siteId) => ({ userId: req.params.id, siteId })) });
  }
  if (missionIds) {
    await prisma.userMissionAssignment.deleteMany({ where: { userId: req.params.id } });
    await prisma.userMissionAssignment.createMany({
      data: missionIds.map((missionId) => ({ userId: req.params.id, missionId })),
    });
  }

  const user = await prisma.user.update({ where: { id: req.params.id }, data });
  await recordAudit({ userId: req.user!.id, action: "USER_UPDATED", targetType: "User", targetId: user.id, metadata: rest });
  res.json({ id: user.id, name: user.name, email: user.email, role: user.role, status: user.status });
});

router.delete("/:id", async (req, res) => {
  // Soft-delete: deactivate rather than destroy, to preserve audit/history integrity.
  const user = await prisma.user.update({ where: { id: req.params.id }, data: { status: UserStatus.INACTIVE } });
  await recordAudit({ userId: req.user!.id, action: "USER_DEACTIVATED", targetType: "User", targetId: user.id });
  res.status(204).send();
});

export default router;
