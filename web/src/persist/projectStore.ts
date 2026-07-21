const DB_NAME = "aseprite-web";
const STORE = "projects";
const KEY = "autosave";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveProject(bytes: Uint8Array, meta?: Record<string, unknown>): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(
      {
        bytes,
        meta: meta ?? {},
        savedAt: Date.now(),
      },
      KEY,
    );
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadProject(): Promise<{ bytes: Uint8Array; savedAt: number } | null> {
  const db = await openDb();
  const result = await new Promise<{ bytes: Uint8Array; savedAt: number } | null>(
    (resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => {
        const value = req.result as
          | { bytes: Uint8Array; savedAt: number }
          | undefined;
        resolve(value ?? null);
      };
      req.onerror = () => reject(req.error);
    },
  );
  db.close();
  return result;
}

export async function clearProject(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function downloadBytes(bytes: Uint8Array, filename: string): Promise<void> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy.buffer], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function pickAsepriteFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".aseprite,.ase,application/octet-stream";
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}
