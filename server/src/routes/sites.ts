import { Router } from "express";
import { z } from "zod";
import { SiteStatus, SiteType } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireAdmin } from "../middleware/auth";
import { recordAudit } from "../services/audit";
import { getWeatherForSite } from "../services/weather";
import { computeCoaStatus } from "../services/faa";

const router = Router();

router.get("/", async (_req, res) => {
  const sites = await prisma.site.findMany({ orderBy: { name: "asc" } });
  const coas = await prisma.cOA.findMany();
  const withStatus = sites.map((site) => {
    const siteCoas = coas.filter((c) => c.siteId === site.id);
    const best = siteCoas
      .map((c) => ({ c, status: computeCoaStatus(c) }))
      .sort((a, b) => (a.status === "ACTIVE" ? -1 : 1))[0];
    return { ...site, coaStatus: best ? best.status : "NOT_ON_FILE" };
  });
  res.json(withStatus);
});

router.get("/:id", async (req, res) => {
  const site = await prisma.site.findUnique({
    where: { id: req.params.id },
    include: { photos: true, coas: true, assignedUsers: { include: { user: { select: { id: true, name: true, role: true } } } } },
  });
  if (!site) return res.status(404).json({ error: "Site not found" });
  res.json(site);
});

router.get("/:id/weather", async (req, res) => {
  const site = await prisma.site.findUnique({ where: { id: req.params.id } });
  if (!site) return res.status(404).json({ error: "Site not found" });
  const forceRefresh = req.query.refresh === "true";
  const snapshot = await getWeatherForSite({
    siteId: site.id,
    lat: site.lat,
    lon: site.lon,
    countryCode: site.countryCode,
    forceRefresh,
  });
  res.json(snapshot);
});

const siteSchema = z.object({
  name: z.string().min(1),
  designator: z.string().min(1),
  lat: z.number(),
  lon: z.number(),
  elevationMeters: z.number().optional().nullable(),
  status: z.nativeEnum(SiteStatus).optional(),
  type: z.nativeEnum(SiteType).optional(),
  ownershipNotes: z.string().optional().nullable(),
  jurisdictionNotes: z.string().optional().nullable(),
  nearestPopulationCenters: z.string().optional().nullable(),
  nearestWaterBodies: z.string().optional().nullable(),
  terrainType: z.string().optional().nullable(),
  countryCode: z.string().optional(),
  traconFacilityName: z.string().optional().nullable(),
  traconPhone: z.string().optional().nullable(),
  artccFacilityName: z.string().optional().nullable(),
  artccPhone: z.string().optional().nullable(),
});

router.post("/", requireAdmin, async (req, res) => {
  const parsed = siteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const site = await prisma.site.create({ data: parsed.data });
  await recordAudit({ userId: req.user!.id, action: "SITE_CREATED", targetType: "Site", targetId: site.id });
  res.status(201).json(site);
});

router.patch("/:id", requireAdmin, async (req, res) => {
  const parsed = siteSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const site = await prisma.site.update({ where: { id: req.params.id }, data: parsed.data });
  await recordAudit({ userId: req.user!.id, action: "SITE_UPDATED", targetType: "Site", targetId: site.id, metadata: parsed.data });
  res.json(site);
});

router.delete("/:id", requireAdmin, async (req, res) => {
  const site = await prisma.site.update({ where: { id: req.params.id }, data: { status: SiteStatus.DECOMMISSIONED } });
  await recordAudit({ userId: req.user!.id, action: "SITE_DECOMMISSIONED", targetType: "Site", targetId: site.id });
  res.status(204).send();
});

router.post("/:id/photos", requireAdmin, async (req, res) => {
  const { url, caption } = req.body as { url?: string; caption?: string };
  if (!url) return res.status(400).json({ error: "url is required" });
  const photo = await prisma.sitePhoto.create({ data: { siteId: req.params.id, url, caption } });
  res.status(201).json(photo);
});

export default router;
