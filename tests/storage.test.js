import test from "node:test";
import assert from "node:assert/strict";

import { createStoryProject } from "../src/models/storyProject.js";
import {
  PROJECTS_KEY,
  isStorageAvailable,
  loadProjects,
  loadSnippets,
  saveProjects,
  saveSnippets,
} from "../src/storage/projectStorage.js";

const BACKUP_KEY = "story-loom.projects.backup.v1";

function memoryStorage(overrides = {}) {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      map.set(key, String(value));
    },
    removeItem: (key) => {
      map.delete(key);
    },
    map,
    ...overrides,
  };
}

function quotaError() {
  const error = new Error("quota exceeded");
  error.name = "QuotaExceededError";
  return error;
}

test("saveProjects reports success and writes serialized projects", () => {
  const storage = memoryStorage();
  const project = createStoryProject({ title: "Saved" });

  const result = saveProjects([project], storage);

  assert.deepEqual(result, { ok: true, quotaExceeded: false });
  const stored = JSON.parse(storage.getItem(PROJECTS_KEY));
  assert.equal(stored[0].title, "Saved");
});

test("saveProjects reports quota exhaustion instead of throwing", () => {
  const storage = memoryStorage({
    setItem: () => {
      throw quotaError();
    },
  });

  const result = saveProjects([createStoryProject()], storage);

  assert.deepEqual(result, { ok: false, quotaExceeded: true });
});

test("saveProjects reports generic write failures", () => {
  const storage = memoryStorage({
    setItem: () => {
      throw new Error("storage disabled");
    },
  });

  const result = saveProjects([createStoryProject()], storage);

  assert.deepEqual(result, { ok: false, quotaExceeded: false });
});

test("isStorageAvailable probes with a write and cleans up", () => {
  const storage = memoryStorage();
  assert.equal(isStorageAvailable(storage), true);
  assert.equal(storage.map.size, 0);

  const broken = memoryStorage({
    setItem: () => {
      throw quotaError();
    },
  });
  assert.equal(isStorageAvailable(broken), false);
});

test("loadProjects backs up unparseable data instead of dropping it", () => {
  const storage = memoryStorage();
  storage.setItem(PROJECTS_KEY, "{not json");

  const result = loadProjects(storage);

  assert.deepEqual(result.projects, []);
  assert.equal(result.dataLoss, true);
  assert.equal(storage.getItem(BACKUP_KEY), "{not json");
});

test("loadProjects keeps valid projects and flags dropped ones", () => {
  const storage = memoryStorage();
  const raw = JSON.stringify([createStoryProject({ title: "Good" }), 42]);
  storage.setItem(PROJECTS_KEY, raw);

  const result = loadProjects(storage);

  assert.equal(result.projects.length, 1);
  assert.equal(result.projects[0].title, "Good");
  assert.equal(result.dataLoss, true);
  assert.equal(storage.getItem(BACKUP_KEY), raw);
});

test("loadProjects returns cleanly when nothing is stored", () => {
  const result = loadProjects(memoryStorage());
  assert.deepEqual(result, { projects: [], dataLoss: false });
});

test("loadProjects treats non-array payloads as data loss", () => {
  const storage = memoryStorage();
  storage.setItem(PROJECTS_KEY, JSON.stringify({ nope: true }));

  const result = loadProjects(storage);

  assert.deepEqual(result.projects, []);
  assert.equal(result.dataLoss, true);
  assert.equal(storage.getItem(BACKUP_KEY), JSON.stringify({ nope: true }));
});

test("snippets round-trip and filter out junk entries", () => {
  const storage = memoryStorage();
  assert.deepEqual(loadSnippets(storage), []);

  assert.equal(saveSnippets(["*smiles*", "Draw your blade."], storage), true);
  assert.deepEqual(loadSnippets(storage), ["*smiles*", "Draw your blade."]);

  storage.setItem("story-loom.snippets.v1", JSON.stringify(["ok", 7, "", null]));
  assert.deepEqual(loadSnippets(storage), ["ok"]);

  storage.setItem("story-loom.snippets.v1", "not json");
  assert.deepEqual(loadSnippets(storage), []);
});
