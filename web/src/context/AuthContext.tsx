import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api, getStoredTokens, setStoredTokens } from "../api/client";
import type { AuthUser, Role } from "../types";

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  hasRole: (...roles: Role[]) => boolean;
  isLaunchDirector: boolean;
  isAdmin: boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const loadMe = useCallback(async () => {
    const tokens = getStoredTokens();
    if (!tokens) {
      setLoading(false);
      return;
    }
    try {
      const res = await api.get("/auth/me");
      setUser({ id: res.data.id, name: res.data.name, email: res.data.email, role: res.data.role });
    } catch {
      setStoredTokens(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMe();
  }, [loadMe]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.post("/auth/login", { email, password });
    setStoredTokens({ accessToken: res.data.accessToken, refreshToken: res.data.refreshToken });
    setUser(res.data.user);
  }, []);

  const logout = useCallback(async () => {
    const tokens = getStoredTokens();
    try {
      if (tokens) await api.post("/auth/logout", { refreshToken: tokens.refreshToken });
    } catch {
      // best-effort
    }
    setStoredTokens(null);
    setUser(null);
  }, []);

  const hasRole = useCallback((...roles: Role[]) => !!user && roles.includes(user.role), [user]);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        logout,
        hasRole,
        isLaunchDirector: !!user && (user.role === "ADMIN" || user.role === "LAUNCH_DIRECTOR"),
        isAdmin: !!user && user.role === "ADMIN",
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
