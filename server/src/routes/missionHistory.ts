import { Router } from "express";
import { prisma } from "../lib/prisma";
import { buildUnifiedLog, computeLogStatus, computeHeaderClocks } from "../services/missionHistoryLog";

// v9.0 Section 3 - Unified Mission Command Log. Read-only aggregation
// endpoint: merges every existing per-subsystem log into one chronological
// feed (see services/missionHistoryLog.ts). Export/Print (Section 3.4) is
// handled by a separate route that reuses this same builder.
const router = Router({ mergeParams: true });

function missionId(req: any): string {
  return (req.params as { missionId: string }).missionId;
}

router.get("/", async (req, res) => {
  const mId = missionId(req);
  const mission = await prisma.mission.findUnique({ where: { id: mId } });
  if (!mission) return res.status(404).json({ error: "Mission not found" });

  const [entries, logStatus, clocks] = await Promise.all([buildUnifiedLog(mId), computeLogStatus(mId), computeHeaderClocks(mId)]);

  res.json({
    logStatus,
    tCountSeconds: clocks.tCountSeconds,
    projectedLiftoff: clocks.projectedLiftoff,
    entries,
  });
});

export default router;
