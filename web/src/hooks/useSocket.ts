import { useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { getStoredTokens } from "../api/client";

let sharedSocket: Socket | null = null;

export function getSocket(): Socket | null {
  const tokens = getStoredTokens();
  if (!tokens) return null;
  if (!sharedSocket) {
    sharedSocket = io({ auth: { token: tokens.accessToken }, autoConnect: true });
  }
  return sharedSocket;
}

export function useMissionSocket(missionId: string | undefined, onUpdate: () => void) {
  const cbRef = useRef(onUpdate);
  cbRef.current = onUpdate;

  useEffect(() => {
    if (!missionId) return;
    const socket = getSocket();
    if (!socket) return;
    socket.emit("subscribe:mission", missionId);
    const handler = (payload: { missionId: string }) => {
      if (payload.missionId === missionId) cbRef.current();
    };
    socket.on("mission:updated", handler);
    return () => {
      socket.emit("unsubscribe:mission", missionId);
      socket.off("mission:updated", handler);
    };
  }, [missionId]);
}

export function useDashboardSocket(onRefresh: () => void) {
  const cbRef = useRef(onRefresh);
  cbRef.current = onRefresh;
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const handler = () => cbRef.current();
    socket.on("dashboard:refresh", handler);
    return () => {
      socket.off("dashboard:refresh", handler);
    };
  }, []);
}
