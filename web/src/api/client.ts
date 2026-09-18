import axios from "axios";

const TOKENS_KEY = "aat_lod_tokens";

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
}

export function getStoredTokens(): StoredTokens | null {
  const raw = localStorage.getItem(TOKENS_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function setStoredTokens(tokens: StoredTokens | null) {
  if (tokens) localStorage.setItem(TOKENS_KEY, JSON.stringify(tokens));
  else localStorage.removeItem(TOKENS_KEY);
}

export const api = axios.create({ baseURL: "/api" });

api.interceptors.request.use((config) => {
  const tokens = getStoredTokens();
  if (tokens?.accessToken) {
    config.headers.Authorization = `Bearer ${tokens.accessToken}`;
  }
  return config;
});

let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const tokens = getStoredTokens();
  if (!tokens?.refreshToken) return null;
  try {
    const res = await axios.post("/api/auth/refresh", { refreshToken: tokens.refreshToken });
    const next = { accessToken: res.data.accessToken, refreshToken: res.data.refreshToken };
    setStoredTokens(next);
    return next.accessToken;
  } catch {
    setStoredTokens(null);
    return null;
  }
}

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true;
      if (!refreshPromise) refreshPromise = refreshAccessToken().finally(() => (refreshPromise = null));
      const newToken = await refreshPromise;
      if (newToken) {
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original);
      }
      window.location.href = "/login";
    }
    return Promise.reject(error);
  }
);
