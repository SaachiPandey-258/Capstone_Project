"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { LoadingState } from "@/components/ui";
import { useAuth } from "@/components/auth-provider";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace("/signin");
  }, [loading, router, user]);

  if (loading) return <LoadingState label="Checking your session…" />;
  if (!user) return null;
  return <>{children}</>;
}
