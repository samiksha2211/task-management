export type PendingTaskCreate = {
  clientRequestId: string;
  title: string;
  description: string | null;
  date: string;
  dueDate: string;
  designation: string;
  status: "Pending" | "Completed";
  createdAt: string;
  syncState: "pending" | "syncing" | "failed";
  lastError?: string;
};

export type PendingTaskInput = Omit<
  PendingTaskCreate,
  "clientRequestId" | "createdAt" | "syncState"
> & {
  clientRequestId?: string;
};

const DB_NAME = "railwork-offline";
const DB_VERSION = 1;
const STORE = "pending-tasks";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available"));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "clientRequestId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open offline store"));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | Promise<T>
): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    const result = fn(store);

    if (result instanceof Promise) {
      result.then(resolve).catch(reject);
      tx.oncomplete = () => db.close();
      tx.onerror = () => {
        db.close();
        reject(tx.error ?? new Error("Offline store transaction failed"));
      };
      return;
    }

    result.onsuccess = () => resolve(result.result as T);
    result.onerror = () => reject(result.error ?? new Error("Offline store operation failed"));
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("Offline store transaction failed"));
    };
  });
}

const queueListeners = new Set<() => void>();

export function onOfflineQueueChange(listener: () => void): () => void {
  queueListeners.add(listener);
  return () => queueListeners.delete(listener);
}

function emitQueueChange(): void {
  for (const listener of queueListeners) {
    try {
      listener();
    } catch {
      // keep other listeners alive
    }
  }
}

export async function listPendingTasks(): Promise<PendingTaskCreate[]> {
  try {
    const rows = await withStore("readonly", (store) => store.getAll());
    return (rows as PendingTaskCreate[]).sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
  } catch {
    return [];
  }
}

export async function enqueueTaskCreate(
  input: PendingTaskInput
): Promise<PendingTaskCreate> {
  const item: PendingTaskCreate = {
    clientRequestId: input.clientRequestId ?? crypto.randomUUID(),
    title: input.title,
    description: input.description,
    date: input.date,
    dueDate: input.dueDate,
    designation: input.designation,
    status: input.status,
    createdAt: new Date().toISOString(),
    syncState: "pending",
  };

  await withStore("readwrite", (store) => store.put(item));
  emitQueueChange();
  return item;
}

export async function markTaskSyncing(clientRequestId: string): Promise<void> {
  const rows = await listPendingTasks();
  const item = rows.find((row) => row.clientRequestId === clientRequestId);
  if (!item) return;
  await withStore("readwrite", (store) =>
    store.put({ ...item, syncState: "syncing", lastError: undefined })
  );
  emitQueueChange();
}

export async function markTaskFailed(
  clientRequestId: string,
  message: string
): Promise<void> {
  const rows = await listPendingTasks();
  const item = rows.find((row) => row.clientRequestId === clientRequestId);
  if (!item) return;
  await withStore("readwrite", (store) =>
    store.put({ ...item, syncState: "failed", lastError: message })
  );
  emitQueueChange();
}

export async function removePendingTask(clientRequestId: string): Promise<void> {
  await withStore("readwrite", (store) => store.delete(clientRequestId));
  emitQueueChange();
}

export async function pendingTaskCount(): Promise<number> {
  const rows = await listPendingTasks();
  return rows.length;
}
