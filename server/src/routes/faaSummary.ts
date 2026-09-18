import { Router } from "express";
import { prisma } from "../lib/prisma";
import { computeBestSiteCoaStatus, computeCoaStatus, computeNotamStatus, REQUIRED_NOTIFICATION_TYPES } from "../services/faa";

const router = Router();

// Module 4.5 - top-level FAA summary: all sites' COA status, all upcoming
// missions within 14 days and NOTAM status, and today's targeted missions
// with their live 3-item notification checklist.
router.get("/summary", async (_req, res) => {
  const now = new Date();
  const in14Days = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

  const [sites, missions] = await Promise.all([
    prisma.site.findMany({ include: { coas: true } }),
    prisma.mission.findMany({
      include: {
        vehicle: true,
        site: true,
        launchPeriodEntries: true,
        notamFilings: { orderBy: { createdAt: "desc" }, take: 1 },
        launchDayNotifications: true,
      },
    }),
  ]);

  const siteCoaStatus = sites.map((site) => ({
    siteId: site.id,
    siteName: site.name,
    designator: site.designator,
    status: computeBestSiteCoaStatus(site.coas),
    coas: site.coas.map((c) => ({ id: c.id, coaNumber: c.coaNumber, status: computeCoaStatus(c), expirationDate: c.expirationDate })),
  }));

  const upcoming = missions
    .map((m) => {
      const targeted = m.launchPeriodEntries.find((e) => e.isTargeted);
      if (!targeted || targeted.windowOpen > in14Days || targeted.windowOpen < now) return null;
      return {
        missionId: m.id,
        missionName: m.name,
        designator: m.designator,
        siteName: m.site.name,
        targetedWindowOpen: targeted.windowOpen,
        notamStatus: computeNotamStatus(m.notamFilings[0], targeted.windowOpen, now),
      };
    })
    .filter(Boolean);

  const today = missions
    .map((m) => {
      const targeted = m.launchPeriodEntries.find((e) => e.isTargeted);
      if (!targeted) return null;
      const sameDay =
        targeted.date.getUTCFullYear() === now.getUTCFullYear() &&
        targeted.date.getUTCMonth() === now.getUTCMonth() &&
        targeted.date.getUTCDate() === now.getUTCDate();
      if (!sameDay) return null;
      return {
        missionId: m.id,
        missionName: m.name,
        designator: m.designator,
        siteName: m.site.name,
        windowOpen: targeted.windowOpen,
        windowClose: targeted.windowClose,
        checklist: REQUIRED_NOTIFICATION_TYPES.map((type) => {
          const item = m.launchDayNotifications.find((n) => n.notificationType === type);
          return {
            notificationType: type,
            satisfied: item?.satisfied ?? false,
            notApplicable: item?.notApplicable ?? false,
            timestamp: item?.timestamp ?? null,
          };
        }),
      };
    })
    .filter(Boolean);

  res.json({ siteCoaStatus, upcomingNotamStatus: upcoming, todayChecklists: today });
});

export default router;
