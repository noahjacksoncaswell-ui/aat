import { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "../utils/jwt";
import { Role } from "@prisma/client";

export interface AuthedUser {
  id: string;
  role: Role;
  email: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthedUser;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing bearer token" });
  }
  const token = header.slice("Bearer ".length);
  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, role: payload.role as Role, email: payload.email };
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

/**
 * Server-side role gate. This is the authoritative permission check - the
 * frontend hiding a button is a UX nicety only, never the enforcement point.
 */
export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: `Requires role: ${roles.join(" or ")}` });
    }
    next();
  };
}

// Admin and Launch Director are the only roles permitted to execute
// Scrub/Cancel/Postpone/Confirm mission actions and to satisfy FAA
// notification checklist items (spec section 2.2 / 7.4).
export const requireLaunchDirector = requireRole(Role.ADMIN, Role.LAUNCH_DIRECTOR);
export const requireAdmin = requireRole(Role.ADMIN);
