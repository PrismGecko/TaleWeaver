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

export async function idbGetMany(keys) {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, "readonly");
  const store = tx.objectStore(STORE_NAME);
  return Promise.all(keys.map((key) => requestToPromise(store.get(key))));
}

/**
 * Read `checkKey` and, only if `isExpected(value)` holds, write every
 * [key, value] pair — all in one readwrite transaction, so no other tab can
 * write in between. Resolves to whether the writes happened.
 */
export async function idbCompareAndSet(checkKey, isExpected, entries) {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);
  let wrote = false;
  const done = new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(wrote);
    tx.onerror = () => reject(tx.error || new Error("IndexedDB write failed."));
    tx.onabort = () => reject(tx.error || new Error("IndexedDB write aborted."));
  });
  const read = store.get(checkKey);
  read.onsuccess = () => {
    if (!isExpected(read.result)) return;
    for (const [key, value] of entries) {
      store.put(value, key);
    }
    wrote = true;
  };
  return done;
}
