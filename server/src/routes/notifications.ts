import { Router } from "express";
import { z } from "zod";
import { NotificationType } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireLaunchDirector } from "../middleware/auth";
import { recordAudit } from "../services/audit";
import { broadcastMissionUpdate } from "../websocket";

const router = Router({ mergeParams: true });

router.get("/", async (req, res) => {
  const items = await prisma.launchDayNotification.findMany({
    where: { missionId: (req.params as { missionId: string }).missionId },
    include: { contactedBy: { select: { id: true, name: true } } },
  });
  res.json(items);
});

const updateSchema = z.object({
  satisfied: z.boolean().optional(),
  notApplicable: z.boolean().optional(),
  contactedFacility: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

// Only the Launch Director/Admin can satisfy or mark not-applicable a launch
// day FAA notification checklist item - this is a hard, server-enforced gate
// per spec section 2.2 / 7.4, not merely a UI affordance.
router.patch("/:notificationType", requireLaunchDirector, async (req, res) => {
  const notificationType = req.params.notificationType.toUpperCase() as NotificationType;
  if (!Object.values(NotificationType).includes(notificationType)) {
    return res.status(400).json({ error: "Invalid notification type" });
  }
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const existing = await prisma.launchDayNotification.findUnique({
    where: { missionId_notificationType: { missionId: (req.params as { missionId: string }).missionId, notificationType } },
  });
  if (!existing) return res.status(404).json({ error: "Checklist item not found for this mission" });

  const updated = await prisma.launchDayNotification.update({
    where: { id: existing.id },
    data: {
      ...parsed.data,
      contactedById: req.user!.id,
      timestamp: new Date(),
    },
  });

  await recordAudit({
    userId: req.user!.id,
    action: "LAUNCH_DAY_NOTIFICATION_LOGGED",
    targetType: "Mission",
    targetId: (req.params as { missionId: string }).missionId,
    metadata: { notificationType, ...parsed.data },
  });
  broadcastMissionUpdate((req.params as { missionId: string }).missionId);
  res.json(updated);
});

export default router;
