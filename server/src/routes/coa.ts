import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAdmin } from "../middleware/auth";
import { recordAudit } from "../services/audit";
import { computeCoaStatus } from "../services/faa";

const router = Router();

router.get("/", async (req, res) => {
  const { siteId } = req.query as { siteId?: string };
  const coas = await prisma.cOA.findMany({
    where: siteId ? { siteId } : undefined,
    include: { site: { select: { id: true, name: true, designator: true } } },
    orderBy: { expirationDate: "desc" },
  });
  res.json(coas.map((c) => ({ ...c, status: computeCoaStatus(c) })));
});

const coaSchema = z.object({
  siteId: z.string(),
  coaNumber: z.string().min(1),
  issuingFacility: z.string().min(1),
  effectiveDate: z.string(),
  expirationDate: z.string(),
  authorizedActivity: z.string().optional().nullable(),
  altitudeLimits: z.string().optional().nullable(),
  conditions: z.string().optional().nullable(),
});

router.post("/", requireAdmin, async (req, res) => {
  const parsed = coaSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { effectiveDate, expirationDate, ...rest } = parsed.data;
  const coa = await prisma.cOA.create({
    data: { ...rest, effectiveDate: new Date(effectiveDate), expirationDate: new Date(expirationDate) },
  });
  await recordAudit({ userId: req.user!.id, action: "COA_CREATED", targetType: "COA", targetId: coa.id });
  res.status(201).json({ ...coa, status: computeCoaStatus(coa) });
});

router.patch("/:id", requireAdmin, async (req, res) => {
  const parsed = coaSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { effectiveDate, expirationDate, ...rest } = parsed.data;
  const coa = await prisma.cOA.update({
    where: { id: req.params.id },
    data: {
      ...rest,
      ...(effectiveDate ? { effectiveDate: new Date(effectiveDate) } : {}),
      ...(expirationDate ? { expirationDate: new Date(expirationDate) } : {}),
    },
  });
  await recordAudit({ userId: req.user!.id, action: "COA_UPDATED", targetType: "COA", targetId: coa.id, metadata: parsed.data });
  res.json({ ...coa, status: computeCoaStatus(coa) });
});

router.delete("/:id", requireAdmin, async (req, res) => {
  await prisma.cOA.delete({ where: { id: req.params.id } });
  await recordAudit({ userId: req.user!.id, action: "COA_DELETED", targetType: "COA", targetId: req.params.id });
  res.status(204).send();
});

export default router;
