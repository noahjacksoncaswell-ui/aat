import { Router } from "express";
import { z } from "zod";
import { CommsRecipient, MissionRole } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { broadcastMissionUpdate } from "../websocket";
import { actionsForRole, findAction, formatCommsLine } from "../services/commsActions";

// v9.0 Section 4.4 - Formal Role Communications. This route ONLY reads and
// writes FormalCommsMessage rows (plus, for HOLD/TERM APPR|DENY, marks
// outstanding REC HOLD/REC TERM rows resolved - still just a field on this
// same table). Per Section 4.4.4/Section 6, nothing here may call into any
// other module's state-changing logic (no MissionHold writes, no PollItem
// writes, etc.) - a formal comms message is a logged communication, never
// a real control action.
const router = Router({ mergeParams: true });

function missionId(req: any): string {
  return (req.params as { missionId: string }).missionId;
}

function serialize(m: any) {
  return {
    id: m.id,
    missionId: m.missionId,
    senderId: m.senderId,
    senderName: m.sender.name,
    senderRole: m.senderRole,
    recipient: m.recipient,
    actionCode: m.actionCode,
    fields: m.fields,
    detail: m.detail,
    resolvedAt: m.resolvedAt,
    resolvedById: m.resolvedById,
    resolvedByName: m.resolvedBy?.name ?? null,
    resolutionCode: m.resolutionCode,
    timestamp: m.timestamp,
    line: formatCommsLine({ timestamp: m.timestamp, senderRole: m.senderRole, recipient: m.recipient, actionCode: m.actionCode, fields: m.fields, detail: m.detail }),
  };
}

const INCLUDE = {
  sender: { select: { id: true, name: true } },
  resolvedBy: { select: { id: true, name: true } },
};

router.get("/", async (req, res) => {
  const messages = await prisma.formalCommsMessage.findMany({
    where: { missionId: missionId(req) },
    include: INCLUDE,
    orderBy: { timestamp: "desc" },
    take: 200,
  });
  res.json(messages.map(serialize));
});

// v9.0 Section 4.4.1 - the action catalog available to the CURRENT user for
// the selected mission, derived from their own mission-role assignment
// (never manually selected). Returns 404-equivalent (empty actions) if the
// user holds no assignment on this mission.
router.get("/actions", async (req, res) => {
  const assignment = await prisma.missionPersonnelAssignment.findUnique({
    where: { missionId_userId: { missionId: missionId(req), userId: req.user!.id } },
  });
  if (!assignment) return res.json({ role: null, actions: [] });
  res.json({ role: assignment.role, actions: actionsForRole(assignment.role) });
});

const composeSchema = z.object({
  recipient: z.nativeEnum(CommsRecipient),
  actionCode: z.string().min(1),
  fields: z.record(z.any()).optional(),
  detail: z.string().optional(),
});

router.post("/", async (req, res) => {
  const parsed = composeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { recipient, actionCode, fields, detail } = parsed.data;
  const mId = missionId(req);

  // Sender role is resolved server-side from the mission's own personnel
  // assignment, never trusted from the client (Section 4.4.1).
  const assignment = await prisma.missionPersonnelAssignment.findUnique({
    where: { missionId_userId: { missionId: mId, userId: req.user!.id } },
  });
  if (!assignment) {
    return res.status(403).json({ error: "You hold no mission-role assignment on this mission and cannot send formal comms." });
  }
  const senderRole: MissionRole = assignment.role;

  const actionDef = findAction(senderRole, actionCode);
  if (!actionDef) {
    return res.status(400).json({ error: `Action ${actionCode} is not available to role ${senderRole}.` });
  }

  // Section 4.4.2 - REC HOLD / REC TERM may only be addressed to LD.
  if (actionDef.recipientLockedToLd && recipient !== CommsRecipient.LD) {
    return res.status(400).json({ error: `${actionCode} may only be addressed to LD.` });
  }

  // Required-field gate, exactly per the action's catalog entry.
  const f = fields ?? {};
  for (const fieldDef of actionDef.fields) {
    if (!fieldDef.required) continue;
    if (fieldDef.id === "detail") continue; // detail is validated separately below
    const v = (f as Record<string, unknown>)[fieldDef.id];
    const present = v !== undefined && v !== null && v !== "";
    // Duration is not required when Indefinite is set.
    if (fieldDef.id === "duration" && (f as any).isIndefinite) continue;
    if (!present) return res.status(400).json({ error: `Field "${fieldDef.label}" is required for action ${actionCode}.` });
  }
  const detailFieldDef = actionDef.fields.find((fd) => fd.id === "detail");
  if (detailFieldDef?.required && !detail) {
    return res.status(400).json({ error: `Detail is required for action ${actionCode}.` });
  }

  const message = await prisma.formalCommsMessage.create({
    data: {
      missionId: mId,
      senderId: req.user!.id,
      senderRole,
      recipient,
      actionCode,
      fields: f as any,
      detail: detail ?? null,
    },
    include: INCLUDE,
  });

  // v9.0 Section 5.4 resolution linkage - interpretive choice documented in
  // schema.prisma/FormalCommsMessage: since the composer has no per-message
  // reply mechanism, an LD HOLD APPR/HOLD DENY resolves every currently-
  // outstanding REC HOLD message; TERM APPR/DENY likewise for REC TERM.
  // This ONLY marks FormalCommsMessage rows resolved - it does not touch
  // MissionHold or any other table (Section 4.4.4 boundary).
  if (senderRole === MissionRole.LD && ["HOLD APPR", "HOLD DENY", "TERM APPR", "TERM DENY"].includes(actionCode)) {
    const targetActionCode = actionCode.startsWith("HOLD") ? "REC HOLD" : "REC TERM";
    await prisma.formalCommsMessage.updateMany({
      where: { missionId: mId, actionCode: targetActionCode, resolvedAt: null },
      data: { resolvedAt: new Date(), resolvedById: req.user!.id, resolutionCode: actionCode },
    });
  }

  broadcastMissionUpdate(mId);
  res.status(201).json(serialize(message));
});

export default router;
