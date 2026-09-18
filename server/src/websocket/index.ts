import { Server as HttpServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import { verifyAccessToken } from "../utils/jwt";
import { env } from "../config/env";

let io: SocketIOServer | null = null;

export function initWebsocket(httpServer: HttpServer) {
  io = new SocketIOServer(httpServer, {
    cors: { origin: env.corsOrigin },
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return next(new Error("Missing auth token"));
    try {
      verifyAccessToken(token);
      next();
    } catch {
      next(new Error("Invalid auth token"));
    }
  });

  io.on("connection", (socket) => {
    socket.on("subscribe:mission", (missionId: string) => {
      socket.join(`mission:${missionId}`);
    });
    socket.on("unsubscribe:mission", (missionId: string) => {
      socket.leave(`mission:${missionId}`);
    });
    socket.join("dashboard");
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
