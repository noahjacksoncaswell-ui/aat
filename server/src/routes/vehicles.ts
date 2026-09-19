import { Router } from "express";
import { z } from "zod";
import { Role, VehicleStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireAdmin, requireRole } from "../middleware/auth";
import { recordAudit } from "../services/audit";

const router = Router();
const requireVehicleEditor = requireRole(Role.ADMIN, Role.LAUNCH_DIRECTOR);

router.get("/", async (_req, res) => {
  const vehicles = await prisma.vehicle.findMany({
    orderBy: { name: "asc" },
    include: {
      templates: { include: { items: { orderBy: { sortOrder: "asc" } } } },
      missions: { select: { id: true, name: true, designator: true, status: true, updatedAt: true } },
    },
  });
  res.json(
    vehicles.map((v) => ({
      ...v,
      totalMissionsFlown: v.missions.filter((m) => m.status === "SUCCESSFUL").length,
      lastFlightDate: v.missions
        .filter((m) => m.status === "SUCCESSFUL")
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0]?.updatedAt ?? null,
    }))
  );
});

router.get("/:id", async (req, res) => {
  const vehicle = await prisma.vehicle.findUnique({
    where: { id: req.params.id },
    include: {
      templates: { include: { items: { orderBy: { sortOrder: "asc" } } } },
      documents: {
        orderBy: { updatedAt: "desc" },
        include: { uploadedBy: { select: { id: true, name: true } }, versions: { orderBy: { version: "desc" }, take: 1 } },
      },
      missions: {
        orderBy: { updatedAt: "desc" },
        include: { site: { select: { id: true, name: true, designator: true } }, disposition: true },
      },
    },
  });
  if (!vehicle) return res.status(404).json({ error: "Vehicle not found" });
  res.json(vehicle);
});

const vehicleSchema = z.object({
  name: z.string().min(1),
  type: z.string().optional().nullable(),
  designator: z.string().optional().nullable(),
  vehicleClass: z.string().optional().nullable(),
  program: z.string().optional().nullable(),
  status: z.nativeEnum(VehicleStatus).optional(),
  configurationNotes: z.string().optional().nullable(),

  totalLengthIn: z.number().optional().nullable(),
  diameterIn: z.number().optional().nullable(),
  finSpanIn: z.number().optional().nullable(),
  wetMassKg: z.number().optional().nullable(),
  dryMassKg: z.number().optional().nullable(),
  massFraction: z.number().optional().nullable(),

  motorType: z.string().optional().nullable(),
  motorManufacturer: z.string().optional().nullable(),
  propellantType: z.string().optional().nullable(),
  totalImpulseNs: z.number().optional().nullable(),
  burnTimeSeconds: z.number().optional().nullable(),
  avgThrustN: z.number().optional().nullable(),
  maxThrustN: z.number().optional().nullable(),
  specificImpulseS: z.number().optional().nullable(),

  stageConfiguration: z.string().optional().nullable(),

  drogueChuteSpec: z.string().optional().nullable(),
  mainChuteSpec: z.string().optional().nullable(),
  deploymentMethod: z.string().optional().nullable(),
  ejectionChargeConfig: z.string().optional().nullable(),

  flightComputer: z.string().optional().nullable(),
  telemetrySystem: z.string().optional().nullable(),
  gpsTracking: z.string().optional().nullable(),
  avionicsRedundancy: z.string().optional().nullable(),

  predictedApogeeM: z.number().optional().nullable(),
  predictedMaxVelocityMach: z.number().optional().nullable(),
  predictedMaxQPsf: z.number().optional().nullable(),

  windMaxKts: z.number().optional().nullable(),
  ceilingMinFt: z.number().optional().nullable(),
  lightningRadiusMi: z.number().optional().nullable(),
  maxPrecipProbability: z.number().optional().nullable(),
  notes: z.string().optional().nullable(),
});

router.post("/", requireVehicleEditor, async (req, res) => {
  const parsed = vehicleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const vehicle = await prisma.vehicle.create({ data: parsed.data });
  await recordAudit({ userId: req.user!.id, action: "VEHICLE_CREATED", targetType: "Vehicle", targetId: vehicle.id });
  res.status(201).json(vehicle);
});

router.patch("/:id", requireVehicleEditor, async (req, res) => {
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

router.post("/:vehicleId/templates", requireVehicleEditor, async (req, res) => {
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

router.delete("/:vehicleId/templates/:templateId", requireVehicleEditor, async (req, res) => {
  await prisma.milestoneTemplate.delete({ where: { id: req.params.templateId } });
  res.status(204).send();
});

export default router;
