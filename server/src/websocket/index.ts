import { Server as HttpServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import { verifyAccessToken } from "../utils/jwt";
import { env } from "../config/env";

let io: SocketIOServer | null = null;

// v7.0 Section 8 - "Online Status" for the ON STATION table needs some
// notion of "currently authenticated and active in an application
// session." This app has no session table (JWT access/refresh only), so
// presence is tracked via live socket connections instead: a per-user
// open-connection count (a user can have more than one tab/socket open),
// incremented on connect and decremented on disconnect. A lightweight,
// in-memory mechanism, consistent with this codebase's existing pattern
// for the v4.1 live hold-trigger scheduler.
const onlineConnectionCounts = new Map<string, number>();

export function isUserOnline(userId: string): boolean {
  return (onlineConnectionCounts.get(userId) ?? 0) > 0;
}

export function initWebsocket(httpServer: HttpServer) {
  io = new SocketIOServer(httpServer, {
    cors: { origin: env.corsOrigin },
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return next(new Error("Missing auth token"));
    try {
      const payload = verifyAccessToken(token);
      (socket.data as { userId?: string }).userId = payload.sub;
      next();
    } catch {
      next(new Error("Invalid auth token"));
    }
  });

  io.on("connection", (socket) => {
    const userId = (socket.data as { userId?: string }).userId;
    if (userId) {
      onlineConnectionCounts.set(userId, (onlineConnectionCounts.get(userId) ?? 0) + 1);
    }

    socket.on("subscribe:mission", (missionId: string) => {
      socket.join(`mission:${missionId}`);
    });
    socket.on("unsubscribe:mission", (missionId: string) => {
      socket.leave(`mission:${missionId}`);
    });
    socket.join("dashboard");

    socket.on("disconnect", () => {
      if (!userId) return;
      const next = (onlineConnectionCounts.get(userId) ?? 1) - 1;
      if (next <= 0) onlineConnectionCounts.delete(userId);
      else onlineConnectionCounts.set(userId, next);
    });
  });

  return io;
}

/** Broadcast that a mission (countdown, GO/NO-GO, checklist, log) changed. */
export function broadcastMissionUpdate(missionId: string) {
  io?.to(`mission:${missionId}`).emit("mission:updated", { missionId });
  io?.to("dashboard").emit("dashboard:refresh", { reason: "mission_updated", missionId });
}

export function broadcastSiteUpdate(siteId: string) {
  io?.to("dashboard").emit("dashboard:refresh", { reason: "site_updated", siteId });
}
