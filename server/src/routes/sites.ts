import { Router } from "express";
import { z } from "zod";
import { SiteStatus, SiteType, SiteOwnership } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireAdmin, requireLaunchDirector } from "../middleware/auth";
import { recordAudit } from "../services/audit";
import { getWeatherForSite } from "../services/weather";
import { computeCoaStatus } from "../services/faa";

const router = Router();

// v4.1 Section 8.2 - "[PC]" (Portal Connected) is now part of the category's
// literal name; keep this string in sync with LANDOWNER_AUTHORIZATION_CATEGORY
// in web/src/types/index.ts.
const LANDOWNER_AUTH_CATEGORY = "Landowner Authorization [PC]";

router.get("/", async (_req, res) => {
  const sites = await prisma.site.findMany({ orderBy: { name: "asc" } });
  const coas = await prisma.cOA.findMany();
  // Item 4 - the Landowner Authorization badge is computed, not manually
  // toggled: it reflects whether a Documentation Library entry tagged
  // "Landowner Authorization" exists for this site.
  const landownerDocs = await prisma.document.findMany({
    where: { category: LANDOWNER_AUTH_CATEGORY, siteId: { in: sites.map((s) => s.id) } },
    select: { siteId: true },
  });
  const sitesWithLandownerDoc = new Set(landownerDocs.map((d) => d.siteId));
  const withStatus = sites.map((site) => {
    const siteCoas = coas.filter((c) => c.siteId === site.id);
    const best = siteCoas
      .map((c) => ({ c, status: computeCoaStatus(c) }))
      .sort((a, b) => (a.status === "ACTIVE" ? -1 : 1))[0];
    return {
      ...site,
      coaStatus: best ? best.status : "NOT_ON_FILE",
      landownerAuthorizationStatus: sitesWithLandownerDoc.has(site.id) ? "ON_FILE" : "NOT_ON_FILE",
    };
  });
  res.json(withStatus);
});

router.get("/:id", async (req, res) => {
  const site = await prisma.site.findUnique({
    where: { id: req.params.id },
    include: { photos: true, coas: true, assignedUsers: { include: { user: { select: { id: true, name: true, role: true } } } } },
  });
  if (!site) return res.status(404).json({ error: "Site not found" });
  const landownerDoc = await prisma.document.findFirst({ where: { category: LANDOWNER_AUTH_CATEGORY, siteId: site.id } });
  res.json({ ...site, landownerAuthorizationStatus: landownerDoc ? "ON_FILE" : "NOT_ON_FILE" });
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
  ownership: z.nativeEnum(SiteOwnership).optional(),
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
  otherFacilityName: z.string().optional().nullable(),
  otherFacilityPhone: z.string().optional().nullable(),
  otherFacilityNotApplicable: z.boolean().optional(),
});

// v5.0 Section 5 - Facility Notification Contacts (TRACON, ARTCC, Other)
// are operational contact data a Launch Director needs to keep current
// day-to-day, distinct from the structural site fields above (name,
// coordinates, ownership, etc.) which stay Admin-only via PATCH /:id.
const facilityContactsSchema = z.object({
  traconFacilityName: z.string().optional().nullable(),
  traconPhone: z.string().optional().nullable(),
  artccFacilityName: z.string().optional().nullable(),
  artccPhone: z.string().optional().nullable(),
  otherFacilityName: z.string().optional().nullable(),
  otherFacilityPhone: z.string().optional().nullable(),
  otherFacilityNotApplicable: z.boolean().optional(),
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

// v5.0 Section 5 - Facility Notification Contacts. LD+Admin (not
// Admin-only like the general site PATCH above) since Launch Directors
// are the ones who need to keep this operational contact data current.
router.patch("/:id/facility-contacts", requireLaunchDirector, async (req, res) => {
  const parsed = facilityContactsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const site = await prisma.site.update({ where: { id: req.params.id }, data: parsed.data });
  await recordAudit({ userId: req.user!.id, action: "SITE_FACILITY_CONTACTS_UPDATED", targetType: "Site", targetId: site.id, metadata: parsed.data });
  res.json(site);
});

// v6.0 Section 9 - a genuine hard delete, distinct from the status-only
// decommission flow available via the site edit form's status field.
// Blocked outright (per the directive's stated design philosophy) rather
// than taught elsewhere to tolerate a missing site reference. Per an
// explicit follow-up decision on this directive: blocks on ANY mission on
// file for the site, not only non-closed-out ones - Mission.siteId is a
// required field with no cascade, so a Cancelled/Successful mission left
// on file would otherwise hit a foreign-key error on delete; the
// resolution path is to individually Remove Mission (v4.0 Section 1.2,
// itself only available once a mission is Cancelled) before the site can
// be deleted, not a new cascade-delete path here.
router.delete("/:id", requireLaunchDirector, async (req, res) => {
  const site = await prisma.site.findUnique({
    where: { id: req.params.id },
    include: { coas: true, missions: { select: { id: true } } },
  });
  if (!site) return res.status(404).json({ error: "Site not found" });

  const hasActiveCoa = site.coas.some((c) => computeCoaStatus(c) === "ACTIVE");
  const hasAnyMission = site.missions.length > 0;
  if (hasActiveCoa || hasAnyMission) {
    return res.status(400).json({
      error:
        "This launch site cannot be deleted. An active COA and/or mission(s) are associated with this site. The COA must be marked inactive or deleted, and any associated mission(s) must be individually removed via the Remove Mission action before this site can be deleted.",
    });
  }

  // Document.siteId is optional and already handled as such throughout the
  // app (unlike Mission.siteId), so detaching rather than deleting these
  // documents is a safe, non-destructive way to clear the one remaining
  // non-cascading reference before the site row itself is removed.
  await prisma.$transaction([
    prisma.document.updateMany({ where: { siteId: site.id }, data: { siteId: null } }),
    prisma.site.delete({ where: { id: site.id } }),
  ]);
  await recordAudit({ userId: req.user!.id, action: "SITE_DELETED", targetType: "Site", targetId: site.id });
  res.status(204).send();
});

router.post("/:id/photos", requireAdmin, async (req, res) => {
  const { url, caption } = req.body as { url?: string; caption?: string };
  if (!url) return res.status(400).json({ error: "url is required" });
  const photo = await prisma.sitePhoto.create({ data: { siteId: req.params.id, url, caption } });
  res.status(201).json(photo);
});

export default router;
