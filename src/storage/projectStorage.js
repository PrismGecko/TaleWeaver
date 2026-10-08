import { normalizeProject } from "../models/storyProject.js";
import { createId } from "../utils/id.js";
import {
  idbCompareAndSet,
  idbGet,
  idbGetMany,
  idbRemove,
  idbSet,
  isIdbAvailable,
} from "./db.js";

export const PROJECTS_KEY = "story-loom.projects.v1";
export const PROJECT_TOKENS_KEY = "story-loom.project-tokens.v1";
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
  const { projects, dataLoss, tokens } = await readStored(storage);
  recordSync(projects, tokens);
  return { projects, dataLoss };
}

async function readStored(storage) {
  if (durableBackend === "idb") {
    let raw;
    let tokens;
    try {
      [raw, tokens] = await idbGetMany([PROJECTS_KEY, PROJECT_TOKENS_KEY]);
    } catch {
      durableBackend = isStorageAvailable(storage) ? "local" : "none";
      return readStored(storage);
    }
    if (raw === undefined || raw === null) {
      return { projects: [], dataLoss: false, tokens: asTokens(tokens) };
    }
    if (!Array.isArray(raw)) {
      return { projects: [], dataLoss: true, tokens: asTokens(tokens) };
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
    return { projects, dataLoss: dropped, tokens: asTokens(tokens) };
  }
  return { ...loadProjects(storage), tokens: readLocalTokens(storage) };
}

/**
 * Save every project, unless another tab has saved since this one last
 * synced — then nothing is written and `conflict` is set, so the caller can
 * merge with mergeWithStored() and try again.
 */
export async function saveProjectsDurable(projects, storage) {
  const serialized = projects.map((project) => JSON.stringify(project));
  const tokens = Object.fromEntries(
    projects.map((project, index) => [
      project.project_id,
      hashString(serialized[index]),
    ]),
  );
  const payload = `[${serialized.join(",")}]`;

  if (durableBackend === "idb") {
    try {
      const wrote = await idbCompareAndSet(
        PROJECT_TOKENS_KEY,
        (stored) => sameTokens(asTokens(stored), seenTokens),
        // JSON round-trip guarantees a structured-cloneable plain snapshot.
        [
          [PROJECTS_KEY, JSON.parse(payload)],
          [PROJECT_TOKENS_KEY, tokens],
        ],
      );
      if (!wrote) return { ok: false, quotaExceeded: false, conflict: true };
    } catch (error) {
      return { ok: false, quotaExceeded: isQuotaError(error) };
    }
  } else {
    const target = resolveStorage(storage);
    if (!target) return { ok: false, quotaExceeded: false };
    if (!sameTokens(readLocalTokens(target), seenTokens)) {
      return { ok: false, quotaExceeded: false, conflict: true };
    }
    try {
      target.setItem(PROJECTS_KEY, payload);
      target.setItem(PROJECT_TOKENS_KEY, JSON.stringify(tokens));
    } catch (error) {
      return { ok: false, quotaExceeded: isQuotaError(error) };
    }
  }

  seenTokens = tokens;
  syncedHashes = new Map(Object.entries(tokens));
  return { ok: true, quotaExceeded: false };
}

export async function clearAllLocalDataDurable(storage) {
  clearAllLocalData(storage);
  if (durableBackend === "idb") {
    try {
      await idbRemove(PROJECTS_KEY);
      await idbRemove(PROJECT_TOKENS_KEY);
    } catch {
      // Best effort, matching clearAllLocalData.
    }
  }
  seenTokens = {};
  syncedHashes = new Map();
}

// --- Several tabs, one story list --------------------------------------
// Every save rewrites the whole project list, so a tab holding stale data
// (a phone tab left open since yesterday) would silently overwrite work done
// in another. Each save therefore also stores a token per project — a hash of
// what was written — and only goes through while the stored tokens are still
// the ones this tab last saw. Otherwise the two copies are merged first.

// project id -> token in storage when this tab last loaded or saved.
let seenTokens = {};
// project id -> hash of this tab's own copy at that moment.
let syncedHashes = new Map();

function recordSync(projects, tokens) {
  seenTokens = { ...tokens };
  syncedHashes = new Map(
    projects.map((project) => [
      project.project_id,
      hashString(JSON.stringify(project)),
    ]),
  );
}

/** Whether another tab has saved since this one last loaded or saved. */
export async function hasExternalChanges(storage) {
  let stored;
  if (durableBackend === "idb") {
    try {
      stored = asTokens(await idbGet(PROJECT_TOKENS_KEY));
    } catch {
      return false;
    }
  } else {
    stored = readLocalTokens(storage);
  }
  return !sameTokens(stored, seenTokens);
}

/**
 * Fold whatever other tabs saved into this tab's projects. Projects only one
 * side touched take that side's copy; a project both sides changed is kept
 * twice — this tab's under its own id, the other's as a copy — so nothing is
 * lost. Leaves this tab synced with storage except for its own unsaved work.
 */
export async function mergeWithStored(projects, storage) {
  const stored = await readStored(storage);
  const theirTokens = stored.tokens;
  const result = mergeProjectSets({
    ours: projects,
    theirs: stored.projects,
    wasSynced: (id) => syncedHashes.has(id),
    oursChanged: (project) =>
      hashString(JSON.stringify(project)) !==
      syncedHashes.get(project.project_id),
    theirsChanged: (id) => theirTokens[id] !== seenTokens[id],
  });

  seenTokens = { ...theirTokens };
  // Copies this tab kept retain their old baseline, so unsaved changes still
  // count as changed and the next save writes them. Deletions made here keep
  // theirs too, so a second merge before that save doesn't resurrect them.
  const fromStorage = new Set(stored.projects);
  const live = new Set([
    ...stored.projects.map((project) => project.project_id),
    ...result.projects.map((project) => project.project_id),
  ]);
  const nextHashes = new Map(
    [...syncedHashes].filter(([id]) => live.has(id)),
  );
  for (const project of result.projects) {
    if (fromStorage.has(project)) {
      nextHashes.set(project.project_id, hashString(JSON.stringify(project)));
    }
  }
  syncedHashes = nextHashes;
  return result;
}

/** Pure three-way merge at project granularity; see mergeWithStored. */
export function mergeProjectSets({
  ours,
  theirs,
  wasSynced,
  oursChanged,
  theirsChanged,
}) {
  const theirsById = new Map(theirs.map((project) => [project.project_id, project]));
  const ourIds = new Set(ours.map((project) => project.project_id));
  const projects = [];
  const conflicts = [];
  let adopted = false;
  let localChanges = false;

  const keepOurs = (project) => {
    projects.push(project);
    localChanges = true;
  };

  for (const project of ours) {
    const id = project.project_id;
    const other = theirsById.get(id);
    const changedHere = oursChanged(project);
    if (!other) {
      // New in this tab, or deleted in another. A deletion wins only over a
      // copy nobody touched here.
      if (!wasSynced(id) || changedHere) keepOurs(project);
      else adopted = true;
      continue;
    }
    if (!theirsChanged(id)) {
      if (changedHere) keepOurs(project);
      else projects.push(project);
      continue;
    }
    adopted = true;
    if (!changedHere) {
      projects.push(other);
      continue;
    }
    keepOurs(project);
    const copy = {
      ...other,
      project_id: createId("project"),
      title: `${other.title} (from another tab)`,
    };
    projects.push(copy);
    conflicts.push(project.title);
  }

  for (const project of theirs) {
    const id = project.project_id;
    if (ourIds.has(id)) continue;
    if (wasSynced(id) && !theirsChanged(id)) {
      // Deleted in this tab and untouched elsewhere: stays deleted, which
      // still needs saving.
      localChanges = true;
      continue;
    }
    projects.push(project);
    adopted = true;
  }

  return { projects, conflicts, adopted, localChanges };
}

function readLocalTokens(storage) {
  const target = resolveStorage(storage);
  if (!target) return {};
  try {
    return asTokens(JSON.parse(target.getItem(PROJECT_TOKENS_KEY) || "{}"));
  } catch {
    return {};
  }
}

function asTokens(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function sameTokens(left, right) {
  const leftKeys = Object.keys(left);
  return (
    leftKeys.length === Object.keys(right).length &&
    leftKeys.every((key) => left[key] === right[key])
  );
}

// cyrb53: a fast 53-bit string hash. Only used to notice that a project
// changed, never for anything security-sensitive.
function hashString(text) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export function clearAllLocalData(storage) {
  const target = resolveStorage(storage);
  if (!target) return;
  for (const key of [
    PROJECTS_KEY,
    PROJECT_TOKENS_KEY,
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
