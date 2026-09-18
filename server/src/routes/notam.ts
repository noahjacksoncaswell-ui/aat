import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireLaunchDirector } from "../middleware/auth";
import { recordAudit } from "../services/audit";
import { computeNotamStatus } from "../services/faa";
import { broadcastMissionUpdate } from "../websocket";

const router = Router({ mergeParams: true });

async function withStatus(missionId: string) {
  const mission = await prisma.mission.findUnique({
    where: { id: missionId },
    include: { launchPeriodEntries: true, notamFilings: { orderBy: { createdAt: "desc" } } },
  });
  if (!mission) return null;
  const targeted = mission.launchPeriodEntries.find((e) => e.isTargeted);
  const latest = mission.notamFilings[0] ?? null;
  return {
    filings: mission.notamFilings,
    status: computeNotamStatus(latest, targeted?.windowOpen ?? null),
    targetedWindowOpen: targeted?.windowOpen ?? null,
  };
}

router.get("/", async (req, res) => {
  const result = await withStatus((req.params as { missionId: string }).missionId);
  if (!result) return res.status(404).json({ error: "Mission not found" });
  res.json(result);
});

const filingSchema = z.object({
  filedDate: z.string(),
  leidosConfirmationNumber: z.string().optional().nullable(),
  notamWindowOpen: z.string(),
  notamWindowClose: z.string(),
  notes: z.string().optional().nullable(),
});

router.post("/", requireLaunchDirector, async (req, res) => {
  const parsed = filingSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const filing = await prisma.nOTAMFiling.create({
    data: {
      missionId: (req.params as { missionId: string }).missionId,
      filedDate: new Date(parsed.data.filedDate),
      leidosConfirmationNumber: parsed.data.leidosConfirmationNumber,
      notamWindowOpen: new Date(parsed.data.notamWindowOpen),
      notamWindowClose: new Date(parsed.data.notamWindowClose),
      notes: parsed.data.notes,
      filedById: req.user!.id,
    },
  });
  await recordAudit({ userId: req.user!.id, action: "NOTAM_FILED", targetType: "Mission", targetId: (req.params as { missionId: string }).missionId });
  broadcastMissionUpdate((req.params as { missionId: string }).missionId);
  res.status(201).json(filing);
});

export default router;
