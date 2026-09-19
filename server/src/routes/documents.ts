import { Router } from "express";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import path from "path";
import { DocumentStatus, Role } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireRole } from "../middleware/auth";
import { recordAudit } from "../services/audit";
import { storage } from "../services/storage";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

const canManage = requireRole(Role.ADMIN, Role.LAUNCH_DIRECTOR);

router.get("/", async (req, res) => {
  const { siteId, missionId, vehicleId, category, status, q } = req.query as Record<string, string | undefined>;
  const where: any = {};
  if (siteId) where.siteId = siteId;
  if (missionId) where.missionId = missionId;
  if (vehicleId) where.vehicleId = vehicleId;
  if (category) where.category = category;
  if (status) where.status = status;
  if (q) {
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { tags: { has: q } },
    ];
  }
  const documents = await prisma.document.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    include: {
      uploadedBy: { select: { id: true, name: true } },
      site: { select: { id: true, name: true, designator: true } },
      mission: { select: { id: true, name: true, designator: true } },
      vehicle: { select: { id: true, name: true, designator: true } },
      versions: { orderBy: { version: "desc" }, take: 1 },
    },
  });
  res.json(documents);
});

router.get("/:id", async (req, res) => {
  const document = await prisma.document.findUnique({
    where: { id: req.params.id },
    include: {
      uploadedBy: { select: { id: true, name: true } },
      versions: { orderBy: { version: "desc" }, include: { uploadedBy: { select: { id: true, name: true } } } },
      auditLog: { orderBy: { timestamp: "desc" }, include: { user: { select: { id: true, name: true } } }, take: 50 },
      site: { select: { id: true, name: true, designator: true } },
      mission: { select: { id: true, name: true, designator: true } },
      vehicle: { select: { id: true, name: true, designator: true } },
    },
  });
  if (!document) return res.status(404).json({ error: "Document not found" });
  res.json(document);
});

const uploadMetaSchema = z.object({
  title: z.string().min(1),
  category: z.string().min(1),
  siteId: z.string().optional(),
  missionId: z.string().optional(),
  vehicleId: z.string().optional(),
  status: z.nativeEnum(DocumentStatus).optional(),
  tags: z.string().optional(), // comma-separated
});

router.post("/", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "file is required" });
  const parsed = uploadMetaSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { title, category, siteId, missionId, vehicleId, status, tags } = parsed.data;

  const documentId = uuidv4();
  const storageKey = `documents/${documentId}/v1/${req.file.originalname}`;
  await storage.putObject(storageKey, req.file.buffer, req.file.mimetype);

  const document = await prisma.document.create({
    data: {
      id: documentId,
      title,
      category,
      siteId: siteId || null,
      missionId: missionId || null,
      vehicleId: vehicleId || null,
      status: status ?? DocumentStatus.DRAFT,
      tags: tags ? tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
      uploadedById: req.user!.id,
      currentVersion: 1,
      versions: {
        create: {
          version: 1,
          storageKey,
          fileName: req.file.originalname,
          mimeType: req.file.mimetype,
          fileSizeBytes: req.file.size,
          uploadedById: req.user!.id,
        },
      },
      auditLog: { create: { userId: req.user!.id, action: "UPLOADED" } },
    },
  });

  await recordAudit({ userId: req.user!.id, action: "DOCUMENT_UPLOADED", targetType: "Document", targetId: document.id });
  res.status(201).json(document);
});

// Upload a new version of an existing document
router.post("/:id/versions", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "file is required" });
  const document = await prisma.document.findUnique({ where: { id: req.params.id } });
  if (!document) return res.status(404).json({ error: "Document not found" });

  const nextVersion = document.currentVersion + 1;
  const storageKey = `documents/${document.id}/v${nextVersion}/${req.file.originalname}`;
  await storage.putObject(storageKey, req.file.buffer, req.file.mimetype);

  const [version] = await prisma.$transaction([
    prisma.documentVersion.create({
      data: {
        documentId: document.id,
        version: nextVersion,
        storageKey,
        fileName: req.file.originalname,
        mimeType: req.file.mimetype,
        fileSizeBytes: req.file.size,
        uploadedById: req.user!.id,
        notes: (req.body?.notes as string) || undefined,
      },
    }),
    prisma.document.update({ where: { id: document.id }, data: { currentVersion: nextVersion } }),
    prisma.documentAuditEntry.create({ data: { documentId: document.id, userId: req.user!.id, action: "EDITED", metadata: { version: nextVersion } } }),
  ]);

  await recordAudit({ userId: req.user!.id, action: "DOCUMENT_NEW_VERSION", targetType: "Document", targetId: document.id, metadata: { version: nextVersion } });
  res.status(201).json(version);
});

const metaUpdateSchema = z.object({
  title: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  siteId: z.string().optional().nullable(),
  missionId: z.string().optional().nullable(),
  vehicleId: z.string().optional().nullable(),
  status: z.nativeEnum(DocumentStatus).optional(),
  tags: z.array(z.string()).optional(),
});

router.patch("/:id", canManage, async (req, res) => {
  const parsed = metaUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const document = await prisma.document.update({
    where: { id: req.params.id },
    data: {
      ...parsed.data,
      auditLog: { create: { userId: req.user!.id, action: "STATUS_CHANGED", metadata: parsed.data as any } },
    },
  });
  await recordAudit({ userId: req.user!.id, action: "DOCUMENT_UPDATED", targetType: "Document", targetId: document.id, metadata: parsed.data });
  res.json(document);
});

router.delete("/:id", canManage, async (req, res) => {
  const document = await prisma.document.findUnique({ where: { id: req.params.id }, include: { versions: true } });
  if (!document) return res.status(404).json({ error: "Document not found" });
  for (const v of document.versions) {
    await storage.deleteObject(v.storageKey);
  }
  await prisma.document.delete({ where: { id: document.id } });
  await recordAudit({ userId: req.user!.id, action: "DOCUMENT_DELETED", targetType: "Document", targetId: document.id });
  res.status(204).send();
});

// Streams (local fallback) or redirects (S3 signed URL) to the file content,
// logging a VIEWED/DOWNLOADED audit entry per spec 8.3.
router.get("/:id/versions/:version/content", async (req, res) => {
  const document = await prisma.document.findUnique({ where: { id: req.params.id } });
  if (!document) return res.status(404).json({ error: "Document not found" });
  const version = await prisma.documentVersion.findUnique({
    where: { documentId_version: { documentId: document.id, version: Number(req.params.version) } },
  });
  if (!version) return res.status(404).json({ error: "Version not found" });

  await prisma.documentAuditEntry.create({
    data: { documentId: document.id, userId: req.user!.id, action: "VIEWED", metadata: { version: version.version } },
  });

  const signedUrl = await storage.getSignedDownloadUrl(version.storageKey, version.fileName);
  if (signedUrl) return res.redirect(signedUrl);

  const stream = await storage.getObjectStream(version.storageKey);
  res.setHeader("Content-Type", version.mimeType);
  res.setHeader("Content-Disposition", `inline; filename="${path.basename(version.fileName)}"`);
  (stream as any).pipe(res);
});

export default router;
