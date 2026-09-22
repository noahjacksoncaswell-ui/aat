import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireLaunchDirector } from "../middleware/auth";
import { recordAudit } from "../services/audit";
import { computeCoaStatus } from "../services/faa";

const router = Router();

router.get("/", async (req, res) => {
  const { siteId } = req.query as { siteId?: string };
  const coas = await prisma.cOA.findMany({
    where: siteId ? { siteId } : undefined,
    include: { site: { select: { id: true, name: true, designator: true, lat: true, lon: true } } },
    orderBy: { expirationDate: "desc" },
  });
  res.json(coas.map((c) => ({ ...c, status: computeCoaStatus(c) })));
});

router.get("/:id", async (req, res) => {
  const coa = await prisma.cOA.findUnique({
    where: { id: req.params.id },
    include: { site: { select: { id: true, name: true, designator: true, lat: true, lon: true } } },
  });
  if (!coa) return res.status(404).json({ error: "COA not found" });
  res.json({ ...coa, status: computeCoaStatus(coa) });
});

// Revision Directive v4.0 Section 2.1 - every field is required on this
// form; there are no optional fields on a COA record.
const coaSchema = z.object({
  siteId: z.string().min(1),
  coaNumber: z.string().min(1),
  issuedTo: z.string().min(1),
  issuingFacility: z.string().min(1),
  authorizedOperationRadiusNm: z.number().positive(),
  fixRadialDistance: z.string().min(1),
  effectiveDate: z.string().min(1),
  expirationDate: z.string().min(1),
  dailyWindowOpen: z.string().min(1),
  dailyWindowClose: z.string().min(1),
  authorizedActivity: z.string().min(1),
  altitudeLimits: z.string().min(1),
  conditions: z.string().min(1),
});

router.post("/", requireLaunchDirector, async (req, res) => {
  const parsed = coaSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { effectiveDate, expirationDate, ...rest } = parsed.data;
  const coa = await prisma.cOA.create({
    data: { ...rest, effectiveDate: new Date(effectiveDate), expirationDate: new Date(expirationDate) },
  });
  await recordAudit({ userId: req.user!.id, action: "COA_CREATED", targetType: "COA", targetId: coa.id });
  res.status(201).json({ ...coa, status: computeCoaStatus(coa) });
});

router.patch("/:id", requireLaunchDirector, async (req, res) => {
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

router.delete("/:id", requireLaunchDirector, async (req, res) => {
  await prisma.cOA.delete({ where: { id: req.params.id } });
  await recordAudit({ userId: req.user!.id, action: "COA_DELETED", targetType: "COA", targetId: req.params.id });
  res.status(204).send();
});

export default router;
