import { apiFetch, getToken } from "@/lib/api";
import {
  listPendingTasks,
  markTaskFailed,
  markTaskSyncing,
  onOfflineQueueChange,
  removePendingTask,
} from "./queue";
import {
  isBrowserOffline,
  isNetworkError,
  onConnectivityChange,
} from "./network";

export type SyncResult = {
  synced: number;
  failed: number;
  skipped: boolean;
};

let syncing = false;
let syncStarted = false;
let stopSync: (() => void) | null = null;

const syncListeners = new Set<(result: SyncResult | null) => void>();

export function onSyncStateChange(
  listener: (result: SyncResult | null) => void
): () => void {
  syncListeners.add(listener);
  return () => syncListeners.delete(listener);
}

function emitSyncState(result: SyncResult | null): void {
  for (const listener of syncListeners) {
    try {
      listener(result);
    } catch {
      // keep other listeners alive
    }
  }
}

export async function syncPendingTasks(): Promise<SyncResult> {
  if (syncing) {
    return {
      synced: 0,
      failed: 0,
      skipped: true,
    };
  }

  if (isBrowserOffline() || !getToken()) {
    return {
      synced: 0,
      failed: 0,
      skipped: true,
    };
  }

  const pending = await listPendingTasks();

  if (pending.length === 0) {
    return {
      synced: 0,
      failed: 0,
      skipped: true,
    };
  }

  syncing = true;
  emitSyncState(null);

  let synced = 0;
  let failed = 0;

  try {
    for (const item of pending) {
      await markTaskSyncing(item.clientRequestId);

      
  try {
  // 1. Resolve primary officer
    const officerData = await apiFetch<{
    user: {
      id: string;
      };
    }>("/api/users/ensure-by-designation", {
    method: "POST",
    body: JSON.stringify({
      designation: item.designation,
    }),
    });

    // 2. Resolve all additional officers
    const additionalOfficerData = await Promise.all(
      (item.additionalDesignations ?? [])
        .filter(
          (designation) =>
          designation !== item.designation
        )
        .map((designation) =>
          apiFetch<{
            user: {
            id: string;
          };
          }>("/api/users/ensure-by-designation", {
            method: "POST",
            body: JSON.stringify({
            designation,
          }),
        })
      )
  );

      // 3. Get their database IDs
      const additionalOfficerIds =
      additionalOfficerData.map(
      (result) => result.user.id
      );

      // 4. Create task in server database
      await apiFetch("/api/tasks", {
      method: "POST",
      body: JSON.stringify({
      title: item.title,
      description: item.description,
      date: item.date,
      dueDate: item.dueDate,
      remarks: null,

      officerId: officerData.user.id,
      additionalOfficerIds,

      status: item.status,
      clientRequestId: item.clientRequestId,
      }),
    });

    // 5. Successfully synced - remove local copy
    await removePendingTask(
    item.clientRequestId
    );

  synced += 1;
}
         catch (error) {
          const message =
          error instanceof Error
            ? error.message
            : "Failed to sync task";

        console.error(
          "Offline task sync failed:",
          item.title,
          message
        );

        await markTaskFailed(
          item.clientRequestId,
          message
        );

        failed += 1;

        // Stop trying if internet disappeared again
        if (isNetworkError(error)) {
          break;
        }
      }
    }
  } finally {
    syncing = false;

    const result = {
      synced,
      failed,
      skipped: false,
    };

    emitSyncState(result);
  }

  return {
    synced,
    failed,
    skipped: false,
  };
}

export function startOfflineSync(): () => void {
  if (syncStarted && stopSync) {
    void syncPendingTasks();
    return stopSync;
  }

  syncStarted = true;

  const run = () => {
    void syncPendingTasks();
  };

  // Try once when app starts
  run();

  const stopConnectivity =
    onConnectivityChange(run);

  const stopQueue =
    onOfflineQueueChange(run);

  if (typeof window !== "undefined") {
    window.addEventListener("online", run);
  }

  const interval = window.setInterval(() => {
    void listPendingTasks().then((rows) => {
      if (
        rows.length > 0 &&
        !isBrowserOffline()
      ) {
        void syncPendingTasks();
      }
    });
  }, 30000);

  stopSync = () => {
    syncStarted = false;

    stopConnectivity();
    stopQueue();

    if (typeof window !== "undefined") {
      window.removeEventListener(
        "online",
        run
      );
    }

    window.clearInterval(interval);

    stopSync = null;
  };

  return stopSync;
}

export function isSyncInProgress(): boolean {
  return syncing;
}