import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAdmin } from "../middleware/auth";

const router = Router();
router.use(requireAdmin);

router.get("/activity-log", async (req, res) => {
  const { targetType, userId, limit } = req.query as Record<string, string | undefined>;
  const entries = await prisma.auditLogEntry.findMany({
    where: {
      ...(targetType ? { targetType } : {}),
      ...(userId ? { userId } : {}),
    },
    orderBy: { timestamp: "desc" },
    take: limit ? Math.min(Number(limit), 500) : 200,
    include: { user: { select: { id: true, name: true, email: true } } },
  });
  res.json(entries);
});

export default router;
