import test from "node:test";
import assert from "node:assert/strict";

import { createMessage, createStoryProject } from "../src/models/storyProject.js";
import {
  PROJECTS_KEY,
  PROJECT_TOKENS_KEY,
  isStorageAvailable,
  loadProjects,
  loadProjectsDurable,
  loadSnippets,
  mergeProjectSets,
  mergeWithStored,
  saveProjects,
  saveProjectsDurable,
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

// Stands in for a second tab: it writes the project list plus a fresh token
// for each project, the way that tab's own save would.
function saveFromOtherTab(storage, projects) {
  storage.setItem(PROJECTS_KEY, JSON.stringify(projects));
  storage.setItem(
    PROJECT_TOKENS_KEY,
    JSON.stringify(
      Object.fromEntries(
        projects.map((project) => [project.project_id, `other-${Math.random()}`]),
      ),
    ),
  );
}

function withLine(project, text) {
  const copy = JSON.parse(JSON.stringify(project));
  copy.branches[0].messages.push(createMessage({ content: text }));
  return copy;
}

test("a stale tab cannot overwrite another tab's newer save", async () => {
  const storage = memoryStorage();
  const story = createStoryProject({ title: "Shared" });
  await loadProjectsDurable(storage);
  assert.equal((await saveProjectsDurable([story], storage)).ok, true);

  saveFromOtherTab(storage, [withLine(story, "written in the other tab")]);
  const fresh = createStoryProject({ title: "New here" });
  const result = await saveProjectsDurable([story, fresh], storage);

  assert.equal(result.ok, false);
  assert.equal(result.conflict, true);
  const stored = JSON.parse(storage.getItem(PROJECTS_KEY));
  assert.equal(stored[0].branches[0].messages.length, 1);
});

test("merging adopts the other tab's edits and keeps this tab's new work", async () => {
  const storage = memoryStorage();
  const story = createStoryProject({ title: "Shared" });
  await loadProjectsDurable(storage);
  await saveProjectsDurable([story], storage);

  saveFromOtherTab(storage, [withLine(story, "written in the other tab")]);
  const fresh = createStoryProject({ title: "New here" });
  const merge = await mergeWithStored([story, fresh], storage);

  assert.deepEqual(
    merge.projects.map((project) => project.title),
    ["Shared", "New here"],
  );
  assert.equal(merge.projects[0].branches[0].messages.length, 1);
  assert.equal(merge.adopted, true);
  assert.equal(merge.localChanges, true);
  assert.equal((await saveProjectsDurable(merge.projects, storage)).ok, true);
  assert.equal(JSON.parse(storage.getItem(PROJECTS_KEY)).length, 2);
});

test("a story both tabs changed is kept twice rather than lost", async () => {
  const storage = memoryStorage();
  const story = createStoryProject({ title: "Shared" });
  await loadProjectsDurable(storage);
  await saveProjectsDurable([story], storage);

  saveFromOtherTab(storage, [withLine(story, "theirs")]);
  const ours = withLine(story, "ours");
  const merge = await mergeWithStored([ours], storage);

  assert.deepEqual(merge.conflicts, ["Shared"]);
  assert.equal(merge.projects.length, 2);
  assert.equal(merge.projects[0], ours);
  assert.equal(merge.projects[1].title, "Shared (from another tab)");
  assert.notEqual(merge.projects[1].project_id, story.project_id);
  assert.equal(merge.projects[1].branches[0].messages[0].content, "theirs");
});

test("deletions only win over copies nobody touched", () => {
  const kept = createStoryProject({ title: "Kept" });
  const deletedThere = createStoryProject({ title: "Deleted there" });
  const deletedHere = createStoryProject({ title: "Deleted here" });
  const synced = new Set([kept, deletedThere, deletedHere].map((p) => p.project_id));

  const merge = mergeProjectSets({
    ours: [kept, deletedThere],
    theirs: [kept, deletedHere],
    wasSynced: (id) => synced.has(id),
    oursChanged: () => false,
    theirsChanged: () => false,
  });

  assert.deepEqual(merge.projects, [kept]);
  assert.equal(merge.localChanges, true);
});
