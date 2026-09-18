import { prisma } from "../lib/prisma";

export async function recordAudit(params: {
  userId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  await prisma.auditLogEntry.create({
    data: {
      userId: params.userId ?? null,
      action: params.action,
      targetType: params.targetType,
      targetId: params.targetId ?? null,
      metadata: params.metadata ? (params.metadata as any) : undefined,
    },
  });
}
