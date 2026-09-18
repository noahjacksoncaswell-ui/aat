import { Router } from "express";
import { prisma } from "../lib/prisma";
import { computeBestSiteCoaStatus, computeNotamStatus, REQUIRED_NOTIFICATION_TYPES } from "../services/faa";
import { getWeatherForSite, evaluateWeatherAgainstLimits } from "../services/weather";
import { MissionStatus } from "@prisma/client";

const router = Router();

router.get("/", async (_req, res) => {
  const now = new Date();

  const activeMissions = await prisma.mission.findMany({
    where: { status: { in: [MissionStatus.TARGETED, MissionStatus.PENDING_WINDOW, MissionStatus.HOLD] } },
    include: {
      vehicle: true,
      site: { include: { coas: true } },
      launchPeriodEntries: true,
      notamFilings: { orderBy: { createdAt: "desc" }, take: 1 },
      launchDayNotifications: true,
      assignedUsers: { include: { user: { select: { id: true, name: true, role: true } } } },
    },
  });

  // Next targeted opportunity across all missions (soonest future window).
  const targetedWithWindow = activeMissions
    .map((m) => ({ mission: m, entry: m.launchPeriodEntries.find((e) => e.isTargeted) }))
    .filter((x) => x.entry)
    .sort((a, b) => a.entry!.windowOpen.getTime() - b.entry!.windowOpen.getTime());

  const next = targetedWithWindow[0];
  let nextOpportunity = null as any;
  if (next) {
    const weather = await getWeatherForSite({
      siteId: next.mission.siteId,
      lat: next.mission.site.lat,
      lon: next.mission.site.lon,
      countryCode: next.mission.site.countryCode,
    });
    const evaluation = evaluateWeatherAgainstLimits(weather, next.mission.vehicle);
    nextOpportunity = {
      missionId: next.mission.id,
      missionName: next.mission.name,
      designator: next.mission.designator,
      vehicleName: next.mission.vehicle.name,
      siteName: next.mission.site.name,
      windowOpen: next.entry!.windowOpen,
      windowClose: next.entry!.windowClose,
      weatherStatus: evaluation.overallStatus,
      coaStatus: computeBestSiteCoaStatus(next.mission.site.coas),
      personnelOnConsole: next.mission.assignedUsers.map((a) => ({ id: a.user.id, name: a.user.name, role: a.role ?? a.user.role })),
    };
  }

  const openActionItems: Array<{ type: string; missionId: string; missionName: string; detail: string }> = [];
  for (const { mission, entry } of targetedWithWindow) {
    const notamStatus = computeNotamStatus(mission.notamFilings[0], entry!.windowOpen, now);
    if (notamStatus === "OVERDUE") {
      openActionItems.push({
        type: "NOTAM_OVERDUE",
        missionId: mission.id,
        missionName: mission.name,
        detail: `Leidos/NOTAM advance notice not yet filed for ${mission.designator} (window opens ${entry!.windowOpen.toISOString()})`,
      });
    }
    const unresolvedChecklist = REQUIRED_NOTIFICATION_TYPES.filter((t) => {
      const item = mission.launchDayNotifications.find((n) => n.notificationType === t);
      return !(item?.satisfied || item?.notApplicable);
    });
    const sameDay =
      entry!.date.getUTCFullYear() === now.getUTCFullYear() &&
      entry!.date.getUTCMonth() === now.getUTCMonth() &&
      entry!.date.getUTCDate() === now.getUTCDate();
    if (sameDay && unresolvedChecklist.length > 0) {
      openActionItems.push({
        type: "FAA_CHECKLIST_OPEN",
        missionId: mission.id,
        missionName: mission.name,
        detail: `${unresolvedChecklist.length} FAA notification checklist item(s) outstanding for ${mission.designator}`,
      });
    }
    if (computeBestSiteCoaStatus(mission.site.coas) !== "ACTIVE") {
      openActionItems.push({
        type: "COA_NOT_ACTIVE",
        missionId: mission.id,
        missionName: mission.name,
        detail: `${mission.site.name} does not have an Active COA on file`,
      });
    }
  }

  const recentDocuments = await prisma.document.findMany({
    orderBy: { updatedAt: "desc" },
    take: 10,
    include: { uploadedBy: { select: { id: true, name: true } } },
  });

  res.json({
    nextOpportunity,
    activeMissionCount: activeMissions.length,
    openActionItemCount: openActionItems.length,
    openActionItems,
    recentDocuments,
  });
});

export default router;
