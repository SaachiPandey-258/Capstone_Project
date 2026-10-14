"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { api, getToken, clearToken } from "@/lib/api";
import type { User } from "@/lib/types";

type AuthContextType = {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName?: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchMe() {
      const token = getToken();
      if (!token) {
        setLoading(false);
        return;
      }
      try {
        const me = await api.me();
        setUser(me);
      } catch (_) {
        // token may be invalid – clear it
        clearToken();
      } finally {
        setLoading(false);
      }
    }
    fetchMe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const me = await api.login(email, password);
    setUser(me);
  };

  const register = async (email: string, password: string, displayName?: string) => {
    const me = await api.register(email, password);
    // displayName handling is backend‑side; we just set returned user
    setUser(me);
  };

  const signOut = async () => {
    try {
      await api.logout();
    } finally {
      clearToken();
      setUser(null);
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, signIn, register, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
