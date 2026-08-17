"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getRole, getToken } from "@/lib/api";

export default function AuthGuard({
  children,
  roles,
  fallback = "/",
}: {
  children: React.ReactNode;
  roles?: ("ADMIN" | "OFFICER")[];
  fallback?: string;
}) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace(fallback);
      return;
    }
    if (roles && roles.length > 0 && !roles.includes(getRole() ?? "OFFICER")) {
      router.replace("/tasks");
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReady(true);
  }, [router, roles, fallback]);

  if (!ready) return null;
  return <>{children}</>;
}
