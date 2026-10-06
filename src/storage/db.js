const DB_NAME = "story-loom";
const DB_VERSION = 1;
const STORE_NAME = "kv";

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const factory = globalThis.indexedDB;
    if (!factory) {
      reject(new Error("IndexedDB is not available."));
      return;
    }
    const request = factory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // If another tab upgrades the schema, release the connection so the
      // next call reopens it instead of failing forever.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error || new Error("IndexedDB open failed."));
    request.onblocked = () => reject(new Error("IndexedDB open was blocked."));
  });
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed."));
  });
}

export async function isIdbAvailable() {
  try {
    await openDb();
    return true;
  } catch {
    return false;
  }
}

export async function idbGet(key) {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, "readonly");
  return requestToPromise(tx.objectStore(STORE_NAME).get(key));
}

export async function idbSet(key, value) {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, "readwrite");
  const done = new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error || new Error("IndexedDB write failed."));
    tx.onabort = () => reject(tx.error || new Error("IndexedDB write aborted."));
  });
  tx.objectStore(STORE_NAME).put(value, key);
  await done;
}

export async function idbRemove(key) {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, "readwrite");
  const done = new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error || new Error("IndexedDB delete failed."));
    tx.onabort = () => reject(tx.error || new Error("IndexedDB delete aborted."));
  });
  tx.objectStore(STORE_NAME).delete(key);
  await done;
}
