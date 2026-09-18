import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAdmin } from "../middleware/auth";
import { recordAudit } from "../services/audit";

const router = Router();

router.get("/", async (_req, res) => {
  const vehicles = await prisma.vehicle.findMany({
    orderBy: { name: "asc" },
    include: { templates: { include: { items: { orderBy: { sortOrder: "asc" } } } } },
  });
  res.json(vehicles);
});

const vehicleSchema = z.object({
  name: z.string().min(1),
  type: z.string().optional().nullable(),
  windMaxKts: z.number().optional().nullable(),
  ceilingMinFt: z.number().optional().nullable(),
  lightningRadiusMi: z.number().optional().nullable(),
  maxPrecipProbability: z.number().optional().nullable(),
  notes: z.string().optional().nullable(),
});

router.post("/", requireAdmin, async (req, res) => {
  const parsed = vehicleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const vehicle = await prisma.vehicle.create({ data: parsed.data });
  await recordAudit({ userId: req.user!.id, action: "VEHICLE_CREATED", targetType: "Vehicle", targetId: vehicle.id });
  res.status(201).json(vehicle);
});

router.patch("/:id", requireAdmin, async (req, res) => {
  const parsed = vehicleSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const vehicle = await prisma.vehicle.update({ where: { id: req.params.id }, data: parsed.data });
  await recordAudit({ userId: req.user!.id, action: "VEHICLE_UPDATED", targetType: "Vehicle", targetId: vehicle.id });
  res.json(vehicle);
});

router.delete("/:id", requireAdmin, async (req, res) => {
  await prisma.vehicle.delete({ where: { id: req.params.id } });
  await recordAudit({ userId: req.user!.id, action: "VEHICLE_DELETED", targetType: "Vehicle", targetId: req.params.id });
  res.status(204).send();
});

const templateSchema = z.object({
  name: z.string().min(1),
  items: z.array(
    z.object({
      label: z.string().min(1),
      tMinusSeconds: z.number(),
      sortOrder: z.number().optional(),
    })
  ),
});

router.post("/:vehicleId/templates", requireAdmin, async (req, res) => {
  const parsed = templateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const template = await prisma.milestoneTemplate.create({
    data: {
      vehicleId: req.params.vehicleId,
      name: parsed.data.name,
      items: {
        create: parsed.data.items.map((item, idx) => ({ ...item, sortOrder: item.sortOrder ?? idx })),
      },
    },
    include: { items: true },
  });
  await recordAudit({
    userId: req.user!.id,
    action: "MILESTONE_TEMPLATE_CREATED",
    targetType: "MilestoneTemplate",
    targetId: template.id,
  });
  res.status(201).json(template);
});

router.delete("/:vehicleId/templates/:templateId", requireAdmin, async (req, res) => {
  await prisma.milestoneTemplate.delete({ where: { id: req.params.templateId } });
  res.status(204).send();
});

export default router;
