const DB_NAME = "ptf-offline";
const STORE = "pending";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "clientSyncId" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export type PendingCount = {
  clientSyncId: string;
  timestampLocal: string;
  action: string;
  farmId?: string | null;
  farmName?: string | null;
  sizeId: string;
  sizeName: string;
  gradeId: string;
  gradeName: string;
  quantity: 1;
  sessionId: string;
  sessionStartedAt: string;
};

export async function queueCount(count: PendingCount): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(count);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function allPending(): Promise<PendingCount[]> {
  const db = await openDb();
  const rows = await new Promise<PendingCount[]>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as PendingCount[]);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return rows;
}

export async function removePending(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    for (const id of ids) store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function pendingCount(): Promise<number> {
  return (await allPending()).length;
}

const CATALOG_KEY = "ptf-catalog-v1";

export function cacheCatalog(catalog: unknown): void {
  try {
    localStorage.setItem(CATALOG_KEY, JSON.stringify(catalog));
  } catch {
    /* private mode / quota */
  }
}

export function readCachedCatalog<T>(): T | null {
  try {
    const raw = localStorage.getItem(CATALOG_KEY);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
