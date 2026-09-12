"use client";

import { useEffect, useState } from "react";
import {
  isBrowserOffline,
  isSyncInProgress,
  listPendingTasks,
  onConnectivityChange,
  onOfflineQueueChange,
  onSyncStateChange,
  syncPendingTasks,
} from "@/lib/offline";

export default function OfflineBanner() {
  const [offline, setOffline] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [lastMessage, setLastMessage] = useState<string | null>(null);

  useEffect(() => {
    const refresh = async () => {
      setOffline(isBrowserOffline());
      const rows = await listPendingTasks();
      setPendingCount(rows.length);
      setSyncing(isSyncInProgress());
    };

    void refresh();

    const stopConnectivity = onConnectivityChange(() => {
      void refresh();
    });
    const stopQueue = onOfflineQueueChange(() => {
      void refresh();
    });
    const stopSync = onSyncStateChange((result) => {
      void refresh();
      if (result && result.synced > 0) {
        setLastMessage(
          result.synced === 1
            ? "1 offline task synced."
            : `${result.synced} offline tasks synced.`
        );
      }
    });

    return () => {
      stopConnectivity();
      stopQueue();
      stopSync();
    };
  }, []);

  useEffect(() => {
    if (!lastMessage) return;
    const timer = window.setTimeout(() => setLastMessage(null), 5000);
    return () => window.clearTimeout(timer);
  }, [lastMessage]);

  if (!offline && pendingCount === 0 && !lastMessage) {
    return null;
  }

  const handleRetry = () => {
    void syncPendingTasks();
  };

  return (
    <div className={`offline-banner ${offline ? "is-offline" : "is-online"}`}>
      <div className="offline-banner-text">
        {offline ? (
          <span>You are offline. New tasks will be saved locally and synced when connection returns.</span>
        ) : syncing ? (
          <span>Syncing offline tasks…</span>
        ) : pendingCount > 0 ? (
          <span>
            {pendingCount} task{pendingCount === 1 ? "" : "s"} waiting to sync.
          </span>
        ) : (
          <span>{lastMessage}</span>
        )}
      </div>

      {!offline && pendingCount > 0 && !syncing && (
        <button type="button" className="offline-banner-btn" onClick={handleRetry}>
          Sync now
        </button>
      )}
    </div>
  );
}
