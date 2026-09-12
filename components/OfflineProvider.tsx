"use client";

import { useEffect } from "react";
import { getToken } from "@/lib/api";
import { startOfflineSync } from "@/lib/offline";

export default function OfflineProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (!getToken()) return;
    return startOfflineSync();
  }, []);

  return <>{children}</>;
}
