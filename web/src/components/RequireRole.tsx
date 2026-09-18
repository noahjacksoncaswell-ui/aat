import React from "react";
import { useAuth } from "../context/AuthContext";
import type { Role } from "../types";

export function RequireRole({ roles, children }: { roles: Role[]; children: React.ReactNode }) {
  const { hasRole } = useAuth();
  if (!hasRole(...roles)) return null;
  return <>{children}</>;
}
