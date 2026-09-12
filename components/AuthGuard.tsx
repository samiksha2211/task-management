"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getOfflineUser,
  getRole,
  getToken,
} from "@/lib/api";

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
    const token = getToken();
    const offlineUser = getOfflineUser();
    const offline = !navigator.onLine;

    // Normal online session OR previously approved offline session
    if (!token && !(offline && offlineUser)) {
      router.replace(fallback);
      return;
    }

    const role =
      getRole() ??
      offlineUser?.role ??
      "OFFICER";

    if (
      roles &&
      roles.length > 0 &&
      !roles.includes(role)
    ) {
      router.replace("/tasks");
      return;
    }

    setReady(true);
  }, [router, roles, fallback]);

  if (!ready) return null;

  return <>{children}</>;
}