import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "./api";

export type User = { id: number; displayName: string; email: string; role: "reader" | "editor" | "admin"; createdAt: string };

type AuthContextValue = {
  user: User | null;
  counts: { bookmarks: number; notes: number; collections: number };
  loading: boolean;
  refresh: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (displayName: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [counts, setCounts] = useState({ bookmarks: 0, notes: 0, collections: 0 });
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api<{ user: User | null; counts?: typeof counts }>("/api/auth/me");
      setUser(data.user);
      if (data.counts) setCounts(data.counts);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const data = await api<{ user: User }>("/api/auth/login", { method: "POST", body: { email, password } });
    setUser(data.user);
    await refresh();
  }, [refresh]);

  const register = useCallback(async (displayName: string, email: string, password: string) => {
    const data = await api<{ user: User }>("/api/auth/register", { method: "POST", body: { displayName, email, password } });
    setUser(data.user);
    await refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    await api("/api/auth/logout", { method: "POST", body: {} });
    setUser(null);
    setCounts({ bookmarks: 0, notes: 0, collections: 0 });
  }, []);

  const value = useMemo(
    () => ({ user, counts, loading, refresh, login, register, logout }),
    [user, counts, loading, refresh, login, register, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
