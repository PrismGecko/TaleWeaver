import { normalizeProject } from "../models/storyProject.js";
import { idbGet, idbRemove, idbSet, isIdbAvailable } from "./db.js";

export const PROJECTS_KEY = "story-loom.projects.v1";
const ACTIVE_PROJECT_KEY = "story-loom.active-project.v1";
const API_KEY_STORAGE_KEY = "story-loom.openrouter-key.v1";
const FAL_KEY_STORAGE_KEY = "story-loom.fal-key.v1";
const BACKUP_KEY = "story-loom.projects.backup.v1";
const SNIPPETS_KEY = "story-loom.snippets.v1";
const PROBE_KEY = "story-loom.storage-probe";

function resolveStorage(storage) {
  if (storage) return storage;
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // Accessing localStorage itself throws when cookies/storage are blocked.
    return null;
  }
}

function isQuotaError(error) {
  return (
    error?.name === "QuotaExceededError" ||
    error?.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    error?.code === 22
  );
}

export function isStorageAvailable(storage) {
  const target = resolveStorage(storage);
  if (!target) return false;
  try {
    target.setItem(PROBE_KEY, "1");
    target.removeItem(PROBE_KEY);
    return true;
  } catch {
    return false;
  }
}

export function loadProjects(storage) {
  const target = resolveStorage(storage);
  if (!target) return { projects: [], dataLoss: false };

  let raw = null;
  try {
    raw = target.getItem(PROJECTS_KEY);
  } catch {
    return { projects: [], dataLoss: false };
  }
  if (!raw) return { projects: [], dataLoss: false };

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    backupRawProjects(target, raw);
    return { projects: [], dataLoss: true };
  }
  if (!Array.isArray(parsed)) {
    backupRawProjects(target, raw);
    return { projects: [], dataLoss: true };
  }

  const projects = [];
  let dropped = false;
  for (const item of parsed) {
    try {
      projects.push(normalizeProject(item));
    } catch {
      dropped = true;
    }
  }
  if (dropped) {
    backupRawProjects(target, raw);
  }
  return { projects, dataLoss: dropped };
}

function backupRawProjects(target, raw) {
  try {
    target.setItem(BACKUP_KEY, raw);
  } catch {
    // Best effort: if the backup itself cannot be written, the caller still
    // reports the data loss to the user.
  }
}

export function saveProjects(projects, storage) {
  const target = resolveStorage(storage);
  if (!target) return { ok: false, quotaExceeded: false };
  try {
    target.setItem(PROJECTS_KEY, JSON.stringify(projects));
    return { ok: true, quotaExceeded: false };
  } catch (error) {
    return { ok: false, quotaExceeded: isQuotaError(error) };
  }
}

export function getStoredActiveProjectId(storage) {
  const target = resolveStorage(storage);
  if (!target) return null;
  try {
    return target.getItem(ACTIVE_PROJECT_KEY);
  } catch {
    return null;
  }
}

export function setStoredActiveProjectId(projectId, storage) {
  const target = resolveStorage(storage);
  if (!target) return false;
  try {
    target.setItem(ACTIVE_PROJECT_KEY, projectId);
    return true;
  } catch {
    return false;
  }
}

export function loadRememberedApiKey(storage) {
  const target = resolveStorage(storage);
  if (!target) return "";
  try {
    return target.getItem(API_KEY_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

export function saveRememberedApiKey(apiKey, storage) {
  const target = resolveStorage(storage);
  if (!target) return false;
  try {
    if (apiKey) {
      target.setItem(API_KEY_STORAGE_KEY, apiKey);
    } else {
      target.removeItem(API_KEY_STORAGE_KEY);
    }
    return true;
  } catch {
    return false;
  }
}

export function loadRememberedFalKey(storage) {
  const target = resolveStorage(storage);
  if (!target) return "";
  try {
    return target.getItem(FAL_KEY_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

export function saveRememberedFalKey(apiKey, storage) {
  const target = resolveStorage(storage);
  if (!target) return false;
  try {
    if (apiKey) {
      target.setItem(FAL_KEY_STORAGE_KEY, apiKey);
    } else {
      target.removeItem(FAL_KEY_STORAGE_KEY);
    }
    return true;
  } catch {
    return false;
  }
}

// Quick-response snippets are a typing aid, not story data: they are global
// across projects and intentionally excluded from project exports.
export function loadSnippets(storage) {
  const target = resolveStorage(storage);
  if (!target) return [];
  try {
    const parsed = JSON.parse(target.getItem(SNIPPETS_KEY) || "[]");
    return Array.isArray(parsed)
      ? parsed.filter((item) => typeof item === "string" && item.trim())
      : [];
  } catch {
    return [];
  }
}

export function saveSnippets(snippets, storage) {
  const target = resolveStorage(storage);
  if (!target) return false;
  try {
    target.setItem(SNIPPETS_KEY, JSON.stringify(snippets));
    return true;
  } catch {
    return false;
  }
}

// --- Durable storage (IndexedDB with localStorage fallback) ---------------
// Safari's ITP evicts localStorage after seven days without a visit, so
// projects live in IndexedDB when it is available. The API key and active
// project id intentionally stay in localStorage (small, synchronous reads).

let durableBackend = "local";

export function getDurableBackend() {
  return durableBackend;
}

export async function initDurableStorage(storage) {
  if (await isIdbAvailable()) {
    durableBackend = "idb";
    try {
      const existing = await idbGet(PROJECTS_KEY);
      if (existing === undefined || existing === null) {
        // One-time migration: adopt any legacy localStorage projects. The
        // localStorage copy is left in place as a backup.
        const legacy = loadProjects(storage);
        if (legacy.projects.length) {
          await idbSet(PROJECTS_KEY, legacy.projects);
        }
      }
    } catch {
      durableBackend = isStorageAvailable(storage) ? "local" : "none";
    }
  } else {
    durableBackend = isStorageAvailable(storage) ? "local" : "none";
  }
  try {
    await globalThis.navigator?.storage?.persist?.();
  } catch {
    // Persistence is best effort; eviction protection just stays default.
  }
  return durableBackend;
}

export async function loadProjectsDurable(storage) {
  if (durableBackend === "idb") {
    let raw;
    try {
      raw = await idbGet(PROJECTS_KEY);
    } catch {
      durableBackend = isStorageAvailable(storage) ? "local" : "none";
      return loadProjects(storage);
    }
    if (raw === undefined || raw === null) {
      return { projects: [], dataLoss: false };
    }
    if (!Array.isArray(raw)) {
      return { projects: [], dataLoss: true };
    }
    const projects = [];
    let dropped = false;
    for (const item of raw) {
      try {
        projects.push(normalizeProject(item));
      } catch {
        dropped = true;
      }
    }
    return { projects, dataLoss: dropped };
  }
  return loadProjects(storage);
}

export async function saveProjectsDurable(projects, storage) {
  if (durableBackend === "idb") {
    try {
      // JSON round-trip guarantees a structured-cloneable plain snapshot.
      await idbSet(PROJECTS_KEY, JSON.parse(JSON.stringify(projects)));
      return { ok: true, quotaExceeded: false };
    } catch (error) {
      return { ok: false, quotaExceeded: isQuotaError(error) };
    }
  }
  return saveProjects(projects, storage);
}

export async function clearAllLocalDataDurable(storage) {
  clearAllLocalData(storage);
  if (durableBackend === "idb") {
    try {
      await idbRemove(PROJECTS_KEY);
    } catch {
      // Best effort, matching clearAllLocalData.
    }
  }
}

export function clearAllLocalData(storage) {
  const target = resolveStorage(storage);
  if (!target) return;
  for (const key of [
    PROJECTS_KEY,
    ACTIVE_PROJECT_KEY,
    API_KEY_STORAGE_KEY,
    FAL_KEY_STORAGE_KEY,
    BACKUP_KEY,
    SNIPPETS_KEY,
  ]) {
    try {
      target.removeItem(key);
    } catch {
      // Ignore: clearing is best effort when storage is misbehaving.
    }
  }
}
