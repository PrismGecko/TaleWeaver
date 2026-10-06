import {
  createDemoProject,
  createEntity,
  createStoryProject,
  getActiveBranch,
  normalizeProject,
  normalizeSettings,
  touchProject,
} from "./models/storyProject.js";
import {
  addMessage,
  addMessageVersion,
  deleteMessage,
  editMessage,
  forkBranch,
  getActiveVersionIndex,
  getMessageVersions,
  setActiveMessageVersion,
} from "./services/branchService.js";
import { assembleContext } from "./services/contextAssembler.js";
import {
  sendChatCompletion,
  streamChatCompletion,
} from "./services/openRouterService.js";
import { generateFalImage, generateImage } from "./services/imageService.js";
import { idbGet, idbRemove, idbSet } from "./storage/db.js";
import {
  PROJECTS_KEY,
  clearAllLocalDataDurable,
  getStoredActiveProjectId,
  initDurableStorage,
  loadProjects,
  loadProjectsDurable,
  loadRememberedApiKey,
  loadRememberedFalKey,
  loadSnippets,
  saveProjectsDurable,
  saveRememberedApiKey,
  saveRememberedFalKey,
  saveSnippets,
  setStoredActiveProjectId,
} from "./storage/projectStorage.js";
import { confirmDialog, promptDialog } from "./ui/dialogs.js";
import { renderChat } from "./ui/renderChat.js";
import { branchesScreen } from "./ui/renderBranches.js";
import { describeScene, sceneScreen } from "./ui/renderScene.js";
import { settingsScreen } from "./ui/renderSettings.js";
import { storiesScreen } from "./ui/renderStories.js";
import { worldScreen } from "./ui/renderWorld.js";
import { closeAllSheets, openMenu, openSheet } from "./ui/sheet.js";
import { nowIso } from "./utils/id.js";

const elements = {
  storyButton: document.querySelector("#story-button"),
  storyTitle: document.querySelector("#story-title"),
  settingsButton: document.querySelector("#settings-button"),
  saveStatus: document.querySelector("#save-status"),
  branchChip: document.querySelector("#branch-chip"),
  branchChipLabel: document.querySelector("#branch-chip-label"),
  sceneChip: document.querySelector("#scene-chip"),
  sceneChipLabel: document.querySelector("#scene-chip-label"),
  worldChip: document.querySelector("#world-chip"),
  transcript: document.querySelector("#transcript"),
  composer: document.querySelector("#composer"),
  composerInput: document.querySelector("#composer-input"),
  composerMore: document.querySelector("#composer-more"),
  composerMode: document.querySelector("#composer-mode"),
  composerModeLabel: document.querySelector("#composer-mode-label"),
  composerModeClear: document.querySelector("#composer-mode-clear"),
  composerError: document.querySelector("#composer-error"),
  sendButton: document.querySelector("#send-button"),
  stopButton: document.querySelector("#stop-button"),
  importFile: document.querySelector("#import-file"),
  toastRegion: document.querySelector("#toast-region"),
};

const DEFAULT_COMPOSE = { role: "user", speaker: "", ooc: false, label: "" };

let storageAvailable = false;
let state = null;

init();

async function init() {
  const backend = await initDurableStorage();
  storageAvailable = backend !== "none";
  const loadResult = await loadProjectsDurable();
  const initialProjects = loadResult.projects.length
    ? loadResult.projects
    : [createDemoProject()];
  const storedActiveId = getStoredActiveProjectId();

  state = {
    projects: initialProjects,
    activeProjectId: initialProjects.some(
      (project) => project.project_id === storedActiveId,
    )
      ? storedActiveId
      : initialProjects[0].project_id,
    apiKey: loadRememberedApiKey(),
    rememberApiKey: Boolean(loadRememberedApiKey()),
    falApiKey: loadRememberedFalKey(),
    compose: { ...DEFAULT_COMPOSE },
    pendingText: "",
    busy: false,
    abortController: null,
    saveFailed: false,
    generation: null,
    editingMessageId: null,
    snippets: loadSnippets(),
    imageCache: new Map(),
    imageLoadsPending: new Set(),
  };

  bindEvents();
  persist();
  renderAll();
  if (!storageAvailable) {
    toast(
      "Browser storage is unavailable — changes will be lost when you close this tab. Export your story to keep it.",
      "error",
    );
  }
  if (loadResult.dataLoss) {
    toast(
      "Some saved story data could not be read. A backup copy was kept in browser storage.",
      "error",
    );
  }
  registerServiceWorker();
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("./sw.js").catch(() => {
    // Offline support is progressive enhancement; the app works without it.
  });
}

function getProject() {
  let project =
    state.projects.find((item) => item.project_id === state.activeProjectId) ||
    state.projects[0];
  if (!project) {
    project = createStoryProject({ title: "Untitled story" });
    state.projects.push(project);
    state.activeProjectId = project.project_id;
    persist();
  }
  return project;
}

/* ---------------------------------------------------------------- events */

function bindEvents() {
  elements.storyButton.addEventListener("click", openStories);
  elements.settingsButton.addEventListener("click", openSettings);
  elements.branchChip.addEventListener("click", openBranches);
  elements.sceneChip.addEventListener("click", openScene);
  elements.worldChip.addEventListener("click", openWorld);

  elements.composer.addEventListener("submit", handleSend);
  elements.composerMore.addEventListener("click", openComposerMenu);
  elements.composerModeClear.addEventListener("click", () => {
    state.compose = { ...DEFAULT_COMPOSE };
    renderComposerMode();
    elements.composerInput.focus();
  });
  elements.composerInput.addEventListener("input", autoGrowComposer);
  elements.composerInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      elements.composer.requestSubmit();
    }
  });
  elements.stopButton.addEventListener("click", () =>
    state.abortController?.abort(),
  );
  elements.importFile.addEventListener("change", importProject);

  window.addEventListener("storage", (event) => {
    if (event.key !== PROJECTS_KEY || event.newValue === null) return;
    if (state.busy) {
      toast(
        "Stories changed in another tab. Reload after this reply finishes to sync.",
        "error",
      );
      return;
    }
    const { projects } = loadProjects();
    if (!projects.length) return;
    state.projects = projects;
    if (
      !projects.some((project) => project.project_id === state.activeProjectId)
    ) {
      state.activeProjectId = projects[0].project_id;
    }
    renderAll();
    toast("Stories updated from another tab.");
  });

  window.addEventListener("beforeunload", (event) => {
    if (!state.busy) return;
    event.preventDefault();
    event.returnValue = "";
  });

  window.addEventListener("error", (event) => {
    toast(`Something went wrong: ${event.message || "unknown error"}`, "error");
  });
  window.addEventListener("unhandledrejection", (event) => {
    const message =
      event.reason?.message || String(event.reason ?? "unknown error");
    toast(`Something went wrong: ${message}`, "error");
  });
}

/* ----------------------------------------------------------------- views */

function renderAll() {
  const project = getProject();
  const branch = getActiveBranch(project);

  elements.storyTitle.textContent = project.title;
  elements.branchChipLabel.textContent = branch.title;
  elements.branchChip.classList.toggle("is-muted", project.branches.length === 1);
  elements.sceneChipLabel.textContent = describeScene(project);
  elements.sendButton.disabled = state.busy;
  elements.stopButton.classList.toggle("hidden", !state.busy);
  elements.sendButton.classList.toggle("hidden", state.busy);
  renderSaveStatus();
  renderComposerMode();

  const generatingHere = isGeneratingBranchVisible();
  loadBranchImages(branch);
  renderChat({
    container: elements.transcript,
    branch,
    pendingText: generatingHere ? state.pendingText : "",
    busy: generatingHere,
    editingMessageId: state.editingMessageId,
    imageUrls: state.imageCache,
    onAction: handleMessageAction,
  });
}

function renderComposerMode() {
  const active = state.compose.label !== "";
  elements.composerMode.classList.toggle("hidden", !active);
  elements.composerModeLabel.textContent = state.compose.label;
  elements.composerInput.placeholder = "Continue the story…";
}

function renderSaveStatus() {
  if (state.busy) {
    elements.saveStatus.textContent = "Writing…";
    elements.saveStatus.className = "save-status is-busy";
    return;
  }
  if (!storageAvailable) {
    elements.saveStatus.textContent = "Not saved";
    elements.saveStatus.className = "save-status is-warning";
    return;
  }
  elements.saveStatus.textContent = state.saveFailed ? "Save failed" : "";
  elements.saveStatus.className = `save-status${state.saveFailed ? " is-warning" : ""}`;
}

function autoGrowComposer() {
  const input = elements.composerInput;
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
}

/* ---------------------------------------------------------------- sheets */

function openStories() {
  openSheet(
    storiesScreen({
      projects: state.projects,
      activeProjectId: state.activeProjectId,
      onSelect: (projectId) => {
        state.activeProjectId = projectId;
        setStoredActiveProjectId(projectId);
        state.compose = { ...DEFAULT_COMPOSE };
        renderAll();
      },
      onCreate: createStory,
      onRename: renameStory,
      onExport: exportProject,
      onDelete: deleteStory,
    }),
  );
}

function openBranches() {
  const project = getProject();
  openSheet(
    branchesScreen({
      project,
      onSelect: (branchId) => {
        project.active_branch_id = branchId;
        touchProject(project);
        persist();
        renderAll();
      },
      onFork: forkFromEnd,
      onRename: renameBranch,
    }),
  );
}

function openScene() {
  openSheet(
    sceneScreen({
      project: getProject(),
      onChange: () => {
        touchProject(getProject());
        persist();
        renderAll();
      },
    }),
  );
}

function openWorld() {
  openSheet(
    worldScreen({
      project: getProject(),
      confirm: confirmDialog,
      onChange: (message) => {
        touchProject(getProject());
        persist();
        renderAll();
        if (message) toast(message);
      },
    }),
  );
}

function openSettings() {
  const project = getProject();
  openSheet(
    settingsScreen({
      project,
      apiKey: state.apiKey,
      rememberApiKey: state.rememberApiKey,
      falApiKey: state.falApiKey,
      usage: describeUsage(project),
      storageNote: storageAvailable
        ? ""
        : "This browser is not letting the app save. Export often.",
      onSave: applySettings,
      onChange: (message) => {
        touchProject(project);
        persist();
        renderAll();
        if (message) toast(message);
      },
      onExport: () => exportProject(project.project_id),
      onImport: () => elements.importFile.click(),
      onClear: clearData,
      onInspect: buildCurrentContext,
      onSummarize: summarizeOlderMessages,
    }),
  );
}

function openComposerMenu() {
  const project = getProject();
  const you = project.settings.you.name;
  openMenu({
    title: "Write something else",
    items: [
      {
        label: "Quick responses",
        icon: "⚡",
        hint: state.snippets.length
          ? `${state.snippets.length} saved`
          : "Save lines you type often",
        onSelect: openSnippets,
      },
      {
        label: "Write as the narrator",
        icon: "✎",
        hint: "Set a scene yourself instead of asking the AI to",
        onSelect: () =>
          setComposeMode({
            role: "narrator",
            speaker: "Narrator",
            ooc: false,
            label: "Writing as the narrator",
          }),
      },
      {
        label: "Speak as a character",
        icon: "☺",
        hint: project.characters.length
          ? "Put words in someone else's mouth"
          : "Add characters in the World first",
        onSelect: () => chooseSpeaker(project),
      },
      {
        label: "Aside to the AI",
        icon: "💬",
        hint: "Steer the writing without it becoming part of the story",
        onSelect: () =>
          setComposeMode({
            role: "user",
            speaker: "",
            ooc: true,
            label: "Aside — stays out of the story",
          }),
      },
      {
        label: "Note for the AI to remember",
        icon: "📌",
        hint: "A standing instruction inside the transcript",
        onSelect: () =>
          setComposeMode({
            role: "system",
            speaker: "",
            ooc: false,
            label: "Writing a note to the AI",
          }),
      },
      {
        label: you ? `Back to writing as ${you}` : "Back to writing as yourself",
        icon: "↩",
        onSelect: () => setComposeMode({ ...DEFAULT_COMPOSE }),
      },
    ],
  });
}

function setComposeMode(compose) {
  state.compose = compose;
  renderComposerMode();
  elements.composerInput.focus();
}

function chooseSpeaker(project) {
  const speakAs = (name) =>
    setComposeMode({
      role: "character",
      speaker: name,
      ooc: false,
      label: `Speaking as ${name}`,
    });

  openMenu({
    title: "Speak as",
    items: [
      ...project.characters.map((character) => ({
        label: character.name,
        hint: character.role || undefined,
        onSelect: () => speakAs(character.name),
      })),
      {
        // The old composer had a free-text speaker field; keep a way to voice
        // a walk-on who does not warrant a character entry.
        label: "Someone else…",
        icon: "✎",
        hint: "A passer-by who needs no entry in the World",
        onSelect: async () => {
          const name = (
            await promptDialog({
              title: "Who is speaking?",
              value: "",
              confirmLabel: "Use this name",
            })
          )?.trim();
          if (name) speakAs(name);
        },
      },
    ],
  });
}

function openSnippets() {
  openSheet({
    title: "Quick responses",
    action: {
      label: "Save draft",
      variant: "is-primary",
      onClick: () => {},
    },
    render(body, sheet) {
      this.action.onClick = async () => {
        await saveCurrentDraftAsSnippet();
        sheet.refresh();
      };
      if (!state.snippets.length) {
        const empty = document.createElement("p");
        empty.className = "empty-note";
        empty.textContent =
          "Type something in the composer, then tap Save draft to keep it here for next time.";
        body.append(empty);
        return;
      }
      const list = document.createElement("div");
      list.className = "world-list";
      for (const [index, snippet] of state.snippets.entries()) {
        const row = document.createElement("div");
        row.className = "snippet-row";
        const insert = document.createElement("button");
        insert.type = "button";
        insert.className = "snippet-insert";
        insert.textContent = snippet;
        insert.addEventListener("click", () => {
          insertSnippet(snippet);
          sheet.close();
        });
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "branch-more";
        remove.textContent = "×";
        remove.setAttribute("aria-label", "Delete this quick response");
        remove.addEventListener("click", () => {
          state.snippets.splice(index, 1);
          saveSnippets(state.snippets);
          sheet.refresh();
        });
        row.append(insert, remove);
        list.append(row);
      }
      body.append(list);
    },
  });
}

async function saveCurrentDraftAsSnippet() {
  let text = elements.composerInput.value.trim();
  if (!text) {
    text = (
      await promptDialog({
        title: "New quick response",
        value: "",
        multiline: true,
        confirmLabel: "Save",
      })
    )?.trim();
  }
  if (!text) return;
  if (state.snippets.includes(text)) {
    toast("That quick response is already saved.");
    return;
  }
  state.snippets.push(text);
  saveSnippets(state.snippets);
  toast("Quick response saved.");
}

function insertSnippet(snippet) {
  const textarea = elements.composerInput;
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? textarea.value.length;
  const before = textarea.value.slice(0, start);
  const after = textarea.value.slice(end);
  const needsSpace = before && !/\s$/.test(before) ? " " : "";
  textarea.value = `${before}${needsSpace}${snippet}${after}`;
  const cursor = before.length + needsSpace.length + snippet.length;
  textarea.setSelectionRange(cursor, cursor);
  autoGrowComposer();
  textarea.focus();
}

/* -------------------------------------------------------------- stories */

async function createStory() {
  const title = (
    await promptDialog({
      title: "New story",
      value: "Untitled story",
      confirmLabel: "Create",
    })
  )?.trim();
  if (!title) return;
  const project = createStoryProject({ title });
  state.projects.push(project);
  state.activeProjectId = project.project_id;
  state.compose = { ...DEFAULT_COMPOSE };
  persist();
  renderAll();
  toast("Story created.");
}

async function renameStory(projectId) {
  const project = state.projects.find((item) => item.project_id === projectId);
  if (!project) return;
  const title = (
    await promptDialog({
      title: "Rename story",
      value: project.title,
      confirmLabel: "Rename",
    })
  )?.trim();
  if (!title) return;
  project.title = title;
  touchProject(project);
  closeAllSheets();
  persist();
  renderAll();
}

async function deleteStory(projectId) {
  const project = state.projects.find((item) => item.project_id === projectId);
  if (!project) return;
  const confirmed = await confirmDialog({
    message: `Delete "${project.title}" and everything in it? This cannot be undone.`,
    confirmLabel: "Delete",
    danger: true,
  });
  if (!confirmed) return;
  state.projects = state.projects.filter(
    (item) => item.project_id !== projectId,
  );
  if (!state.projects.length) {
    state.projects = [createStoryProject({ title: "Untitled story" })];
  }
  if (state.activeProjectId === projectId) {
    state.activeProjectId = state.projects[0].project_id;
  }
  closeAllSheets();
  persist();
  renderAll();
  toast("Story deleted.");
}

/* -------------------------------------------------------------- branches */

async function renameBranch(branchId) {
  const project = getProject();
  const branch = project.branches.find((item) => item.branch_id === branchId);
  if (!branch) return;
  const title = (
    await promptDialog({
      title: "Rename branch",
      value: branch.title,
      confirmLabel: "Rename",
    })
  )?.trim();
  if (!title) return;
  branch.title = title;
  branch.updated_at = nowIso();
  touchProject(project);
  closeAllSheets();
  persist();
  renderAll();
}

async function forkFromEnd() {
  const project = getProject();
  const branch = getActiveBranch(project);
  const last = branch.messages.at(-1);
  if (!last) {
    toast("Write something first — there is nothing to fork from yet.");
    return;
  }
  await forkAtMessage(project, branch, last.message_id);
}

async function forkAtMessage(project, branch, messageId) {
  const title = (
    await promptDialog({
      title: "Name this branch",
      value: `${branch.title} — what if`,
      confirmLabel: "Fork",
    })
  )?.trim();
  if (!title) return;
  forkBranch(project, branch.branch_id, messageId, title);
  touchProject(project);
  persist();
  renderAll();
  toast(`Now writing in "${title}".`);
}

/* ------------------------------------------------------------- composing */

async function handleSend(event) {
  event.preventDefault();
  if (state.busy) return;
  const raw = elements.composerInput.value.trim();
  if (!raw) return;
  if (!state.apiKey) {
    showComposerError("Add an OpenRouter API key in Settings before sending.");
    openSettings();
    return;
  }

  const project = getProject();
  const branch = getActiveBranch(project);
  // A leading "//" still marks an aside, alongside the composer's aside mode:
  // it reaches the model as [OOC: ...] but stays out of summaries and the
  // keyword scan that pulls world entries into context.
  const slashOoc = raw.startsWith("//");
  const ooc = state.compose.ooc || slashOoc;
  const content = slashOoc ? raw.slice(2).trim() : raw;
  if (!content) return;

  addMessage(branch, {
    role: ooc ? "user" : state.compose.role,
    speaker_name: ooc
      ? ""
      : state.compose.speaker ||
        (state.compose.role === "user" ? project.settings.you.name : ""),
    content,
    metadata: ooc ? { ooc: true } : {},
  });
  elements.composerInput.value = "";
  autoGrowComposer();
  showComposerError("");
  touchProject(project);
  persist();
  renderAll();
  await requestAssistant();
}

function showComposerError(message) {
  elements.composerError.textContent = message;
  elements.composerError.classList.toggle("hidden", !message);
}

async function requestAssistant() {
  const project = getProject();
  const branch = getActiveBranch(project);
  const assembled = buildCurrentContext();
  state.busy = true;
  state.pendingText = "";
  state.abortController = new AbortController();
  state.generation = {
    projectId: project.project_id,
    branchId: branch.branch_id,
  };
  renderAll();
  let succeeded = false;

  const announceReply = () => {
    if (!isGeneratingBranchVisible()) {
      toast(`Reply saved to "${branch.title}".`);
    }
  };

  let scheduled = false;
  const updatePending = (_token, completeText) => {
    state.pendingText = completeText;
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      if (!isGeneratingBranchVisible()) return;
      renderChat({
        container: elements.transcript,
        branch,
        pendingText: state.pendingText,
        busy: state.busy,
        imageUrls: state.imageCache,
        onAction: handleMessageAction,
      });
    });
  };

  try {
    const response = await streamChatCompletion({
      apiKey: state.apiKey,
      model: project.settings.model,
      messages: assembled.messages,
      temperature: project.settings.temperature,
      maxTokens: project.settings.max_tokens,
      onToken: updatePending,
      signal: state.abortController.signal,
    });
    const truncated = response.finishReason === "length";
    addMessage(branch, {
      role: "assistant",
      speaker_name: "Narrator",
      content: response.text,
      metadata: {
        ...(truncated ? { truncated: true } : {}),
        ...(response.usage ? { usage: response.usage } : {}),
      },
    });
    succeeded = true;
    touchProject(project);
    persist();
    if (truncated) {
      toast(
        "The reply hit the length limit. Raise it in Settings if that keeps happening.",
      );
    }
    announceReply();
  } catch (error) {
    if (error.name === "AbortError" || error.name === "StallError") {
      if (state.pendingText.trim()) {
        addMessage(branch, {
          role: "assistant",
          speaker_name: "Narrator",
          content: state.pendingText,
          metadata:
            error.name === "StallError" ? { stalled: true } : { stopped: true },
        });
        succeeded = true;
        touchProject(project);
        persist();
        announceReply();
      }
      toast(
        error.name === "AbortError"
          ? "Stopped."
          : succeeded
            ? "The reply stalled — the part that arrived was kept."
            : "The reply stalled — check your connection and try again.",
      );
    } else {
      showComposerError(error.message);
      toast(error.message, "error");
    }
  } finally {
    state.busy = false;
    state.pendingText = "";
    state.abortController = null;
    state.generation = null;
    renderAll();
  }
  if (succeeded) {
    void runPostResponseTasks();
  }
  return succeeded;
}

/* ------------------------------------------------------- message actions */

async function handleMessageAction(action, messageId, payload) {
  if (state.busy) return;
  const project = getProject();
  const branch = getActiveBranch(project);
  const message = branch.messages.find((item) => item.message_id === messageId);
  if (!message) return;

  if (action === "menu") {
    openMessageMenu(project, branch, message);
    return;
  }

  if (action === "edit") {
    state.editingMessageId = messageId;
    renderAll();
    return;
  }

  if (action === "edit-cancel") {
    state.editingMessageId = null;
    renderAll();
    return;
  }

  if (action === "remember") {
    await rememberMessage(project, branch, message);
    return;
  }

  if (action === "illustrate") {
    await illustrateMessage(project, branch, message);
    return;
  }

  if (action === "fork") {
    await forkAtMessage(project, branch, messageId);
    return;
  }

  if (action === "regenerate") {
    await regenerateMessage(project, branch, messageId);
    return;
  }

  if (action === "edit-save") {
    if (typeof payload !== "string" || !payload.trim()) return;
    editMessage(branch, messageId, { content: payload });
    state.editingMessageId = null;
  }

  if (action === "delete") {
    const confirmed = await confirmDialog({
      message: "Delete this message?",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!confirmed) return;
    deleteMessage(branch, messageId);
    if (message.metadata?.has_image) {
      state.imageCache.delete(messageId);
      idbRemove(`image:${messageId}`).catch(() => {
        // Orphaned pixels are harmless; the record is already gone.
      });
    }
  }

  if (action === "swipe") {
    const target = getActiveVersionIndex(message) + Number(payload);
    if (!setActiveMessageVersion(message, target)) return;
    branch.updated_at = nowIso();
  }

  touchProject(project);
  persist();
  renderAll();
}

function openMessageMenu(project, branch, message) {
  const isLastAssistant =
    message.role === "assistant" &&
    [...branch.messages].reverse().find((item) => item.role === "assistant")
      ?.message_id === message.message_id;

  const items = [
    {
      label: "Edit",
      icon: "✎",
      onSelect: () => handleMessageAction("edit", message.message_id),
    },
    {
      label: "Fork from here",
      icon: "⑂",
      hint: "Copy the story up to this point and take it elsewhere",
      onSelect: () => handleMessageAction("fork", message.message_id),
    },
  ];

  if (!message.metadata?.ooc) {
    items.push(
      {
        label: "Illustrate this moment",
        icon: "✦",
        hint: "Draft an image prompt from the scene, then generate",
        onSelect: () => handleMessageAction("illustrate", message.message_id),
      },
      {
        label: "Remember this",
        icon: "📌",
        hint: "Distill it into a fact the AI keeps in mind",
        onSelect: () => handleMessageAction("remember", message.message_id),
      },
    );
  }

  if (isLastAssistant) {
    items.push({
      label: "Write it again",
      icon: "↻",
      hint: "Keeps the old take so you can flip between them",
      onSelect: () => handleMessageAction("regenerate", message.message_id),
    });
  }

  items.push({
    label: "Delete",
    icon: "🗑",
    danger: true,
    onSelect: () => handleMessageAction("delete", message.message_id),
  });

  openMenu({ title: message.speaker_name || "Message", items });
}

async function regenerateMessage(project, branch, messageId) {
  const index = branch.messages.findIndex(
    (item) => item.message_id === messageId,
  );
  if (index < 0) return;
  const [removed] = branch.messages.splice(index, 1);
  branch.updated_at = nowIso();
  touchProject(project);
  persist();
  renderAll();

  const succeeded = await requestAssistant();
  if (!succeeded) {
    branch.messages.splice(index, 0, removed);
    persist();
    renderAll();
    return;
  }
  // Keep the previous take(s) as flippable versions on the new message.
  const replacement = branch.messages.at(-1);
  if (replacement?.role === "assistant") {
    const newContent = replacement.content;
    replacement.metadata = {
      ...replacement.metadata,
      versions: getMessageVersions(removed),
    };
    addMessageVersion(replacement, newContent);
    persist();
    renderAll();
  }
}

/* ----------------------------------------------------------- AI chores */

// Background chores that run after a reply lands: folding older messages
// into branch memory and refreshing character emotional states. They must
// never block or break the conversation, so failures are silent.
let postTasksRunning = false;

async function runPostResponseTasks() {
  if (postTasksRunning || state.busy || !state.apiKey) return;
  postTasksRunning = true;
  try {
    const project = getProject();
    const branch = getActiveBranch(project);
    await autoSummarize(project, branch);
    await trackEmotionalStates(project, branch);
  } catch {
    // Best-effort automation; the user can always summarize manually.
  } finally {
    postTasksRunning = false;
  }
}

const AUTO_SUMMARY_BATCH = 10;

async function autoSummarize(project, branch) {
  if (!project.settings.auto_summarize) return;
  const olderCount = Math.max(
    0,
    branch.messages.length - project.settings.recent_message_count,
  );
  const covered = Math.min(branch.summary_message_count || 0, olderCount);
  if (olderCount - covered < AUTO_SUMMARY_BATCH) return;
  const fresh = branch.messages
    .slice(covered, olderCount)
    .filter((message) => !message.metadata?.ooc);
  if (!fresh.length) {
    branch.summary_message_count = olderCount;
    persist();
    return;
  }
  const response = await sendChatCompletion({
    apiKey: state.apiKey,
    model: project.settings.model,
    messages: summaryRequestMessages(branch.summary, toTranscript(fresh)),
    temperature: 0.3,
    maxTokens: 800,
  });
  const text = response.text.trim();
  if (!text) return;
  branch.summary = text;
  branch.summary_message_count = olderCount;
  branch.updated_at = nowIso();
  touchProject(project);
  persist();
  renderAll();
}

async function trackEmotionalStates(project, branch) {
  if (!project.settings.auto_track_emotions) return;
  const selectedIds = project.settings.selected_character_ids;
  const characters = project.characters
    .filter(
      (character) =>
        !selectedIds.length || selectedIds.includes(character.character_id),
    )
    .slice(0, 6);
  if (!characters.length) return;
  const recent = branch.messages
    .slice(-8)
    .filter((message) => !message.metadata?.ooc);
  if (!recent.length) return;

  const response = await sendChatCompletion({
    apiKey: state.apiKey,
    model: project.settings.model,
    messages: [
      {
        role: "system",
        content:
          "You track character emotional states in a roleplay. Given a transcript, return only a JSON object mapping character name to a short phrase (at most eight words) describing their current emotional state. Include only listed characters whose state is evident from the transcript.",
      },
      {
        role: "user",
        content: `Characters: ${characters
          .map((character) => character.name)
          .join(", ")}\n\nTranscript:\n${toTranscript(recent)}`,
      },
    ],
    temperature: 0.2,
    maxTokens: 300,
  });
  const parsed = parseJsonObject(response.text);
  if (!parsed) return;
  let changed = false;
  for (const character of characters) {
    const value = parsed[character.name];
    if (typeof value !== "string") continue;
    const stateText = value.trim().slice(0, 120);
    if (!stateText || stateText === character.current_emotional_state) continue;
    character.current_emotional_state = stateText;
    character.updated_at = nowIso();
    changed = true;
  }
  if (changed) {
    touchProject(project);
    persist();
    renderAll();
  }
}

async function rememberMessage(project, branch, message) {
  if (!requireApiKey("before saving memories")) return;
  state.busy = true;
  renderAll();
  try {
    const response = await sendChatCompletion({
      apiKey: state.apiKey,
      model: project.settings.model,
      messages: [
        {
          role: "system",
          content:
            'You distill roleplay moments into reusable story facts. Return only a JSON object with keys: "title" (short), "type" (either "object" if the moment is really about a physical thing, otherwise "fact"), "content" (one to three sentences, third person), "keywords" (array of one to five lowercase trigger words).',
        },
        {
          role: "user",
          content: `${message.speaker_name || roleForTranscript(message.role)}: ${message.content}`,
        },
      ],
      temperature: 0.2,
      maxTokens: 400,
    });
    const parsed = parseJsonObject(response.text) || {};
    const kind = parsed.type === "object" ? "object" : "fact";
    const title =
      typeof parsed.title === "string" && parsed.title.trim()
        ? parsed.title.trim()
        : "Remembered moment";
    const keywords = Array.isArray(parsed.keywords) ? parsed.keywords : [];
    const entry = createEntity(kind, {
      title,
      content:
        typeof parsed.content === "string" && parsed.content.trim()
          ? parsed.content.trim()
          : message.content,
      keywords: keywords.length ? keywords : [title.toLowerCase()],
      metadata: {
        source_message_id: message.message_id,
        source_branch_id: branch.branch_id,
      },
    });
    project.canon_entries.push(entry);
    touchProject(project);
    persist();
    toast(`Remembered: ${entry.title}`);
  } catch (error) {
    toast(`Could not save that: ${error.message}`, "error");
  } finally {
    state.busy = false;
    renderAll();
  }
}

// Illustrate: turn the scene around a message into a picture. Stage one asks
// the text model to write a visual prompt from the story context; the user can
// edit it before stage two sends it to the image model. Pixels live in
// IndexedDB under image:<message_id>; the project JSON only keeps the prompt.
async function illustrateMessage(project, branch, message) {
  if (!requireApiKey("before generating images")) return;
  state.busy = true;
  renderAll();
  let suggested = "";
  try {
    const location = project.locations.find(
      (item) => item.location_id === project.settings.selected_location_id,
    );
    const selectedIds = project.settings.selected_character_ids;
    const characters = project.characters
      .filter(
        (character) =>
          character.visibility === "public" &&
          (!selectedIds.length || selectedIds.includes(character.character_id)),
      )
      .slice(0, 4);
    const sceneNotes = [
      location &&
        `Location: ${location.name} — ${location.description}${location.mood ? ` (mood: ${location.mood})` : ""}`,
      characters.length &&
        `Characters present:\n${characters
          .map(
            (character) =>
              `- ${character.name}: ${character.description || character.role || "no description"}`,
          )
          .join("\n")}`,
      `Moment to illustrate:\n${toTranscript([message])}`,
    ]
      .filter(Boolean)
      .join("\n\n");
    const response = await sendChatCompletion({
      apiKey: state.apiKey,
      model: project.settings.model,
      messages: [
        {
          role: "system",
          content:
            "You write prompts for an image generator. Turn the scene into one vivid visual prompt: subjects, setting, lighting, mood, composition, art style. Under 80 words, plain text, no camera jargon lists, no quotation marks. Return only the prompt.",
        },
        { role: "user", content: sceneNotes },
      ],
      temperature: 0.6,
      maxTokens: 250,
    });
    suggested = response.text.trim();
  } catch (error) {
    state.busy = false;
    renderAll();
    toast(`Could not draft an image prompt: ${error.message}`, "error");
    return;
  }
  state.busy = false;
  renderAll();

  const prompt = (
    await promptDialog({
      title: "Illustrate this moment",
      value: suggested,
      multiline: true,
      confirmLabel: "Generate",
    })
  )?.trim();
  if (!prompt) return;

  const useFal = project.settings.image_provider === "fal";
  if (useFal && !state.falApiKey) {
    showComposerError(
      "Add a fal.ai API key in Settings, or switch images back to OpenRouter.",
    );
    openSettings();
    return;
  }
  state.busy = true;
  renderAll();
  try {
    const image = useFal
      ? await generateFalImage({
          apiKey: state.falApiKey,
          modelName: project.settings.fal_image_model,
          prompt,
        })
      : await generateImage({
          apiKey: state.apiKey,
          model: project.settings.image_model,
          prompt,
        });
    state.imageCache.set(message.message_id, image.dataUrl);
    try {
      await idbSet(`image:${message.message_id}`, image.dataUrl);
    } catch {
      toast(
        "The image could not be stored — it will disappear when you close this tab.",
        "error",
      );
    }
    message.metadata = {
      ...message.metadata,
      has_image: true,
      image_prompt: prompt,
    };
    branch.updated_at = nowIso();
    touchProject(project);
    persist();
  } catch (error) {
    toast(`Image generation failed: ${error.message}`, "error");
  } finally {
    state.busy = false;
    renderAll();
  }
}

async function summarizeOlderMessages() {
  if (state.busy) return;
  if (!requireApiKey("before summarizing")) return;
  const project = getProject();
  const branch = getActiveBranch(project);
  const older = branch.messages
    .slice(0, -project.settings.recent_message_count)
    .filter((message) => !message.metadata?.ooc);
  if (!older.length) {
    toast("There is nothing older than the recent window to summarize yet.");
    return;
  }

  state.busy = true;
  renderAll();
  try {
    const response = await sendChatCompletion({
      apiKey: state.apiKey,
      model: project.settings.model,
      messages: summaryRequestMessages(branch.summary, toTranscript(older)),
      temperature: 0.3,
      maxTokens: 800,
    });
    state.busy = false;
    renderAll();
    const edited = await promptDialog({
      title: "The story so far",
      value: response.text.trim(),
      multiline: true,
      confirmLabel: "Save",
    });
    if (edited === null || !edited.trim()) return;
    branch.summary = edited.trim();
    branch.summary_message_count = Math.max(
      0,
      branch.messages.length - project.settings.recent_message_count,
    );
    branch.updated_at = nowIso();
    touchProject(project);
    persist();
    renderAll();
    toast("Saved. The AI keeps this in mind from now on.");
  } catch (error) {
    toast(`Summarizing failed: ${error.message}`, "error");
  } finally {
    if (state.busy) {
      state.busy = false;
      renderAll();
    }
  }
}

function requireApiKey(context) {
  if (state.apiKey) return true;
  showComposerError(`Add an OpenRouter API key in Settings ${context}.`);
  openSettings();
  return false;
}

/* ------------------------------------------------------------- settings */

function applySettings(values) {
  const project = getProject();
  state.apiKey = String(values.api_key || "").trim();
  state.rememberApiKey = Boolean(values.remember_api_key);
  state.falApiKey = String(values.fal_api_key || "").trim();
  project.settings = normalizeSettings({
    ...project.settings,
    model: String(values.model || "").trim(),
    image_provider: values.image_provider,
    image_model: String(values.image_model || "").trim(),
    fal_image_model: String(values.fal_image_model || "").trim(),
    temperature: Number(values.temperature),
    max_tokens: Number(values.max_tokens),
    recent_message_count: Number(values.recent_message_count),
    include_hidden_knowledge: Boolean(values.include_hidden_knowledge),
    auto_summarize: Boolean(values.auto_summarize),
    auto_track_emotions: Boolean(values.auto_track_emotions),
    user_instructions: values.user_instructions,
  });
  if (state.rememberApiKey) {
    saveRememberedApiKey(state.apiKey);
    saveRememberedFalKey(state.falApiKey);
  } else {
    saveRememberedApiKey("");
    saveRememberedFalKey("");
  }
  touchProject(project);
  persist();
  showComposerError("");
  renderAll();
  toast("Settings saved.");
}

function describeUsage(project) {
  let totalCost = 0;
  let totalCompletionTokens = 0;
  let counted = 0;
  for (const branch of project.branches) {
    for (const message of branch.messages) {
      const usage = message.metadata?.usage;
      if (!usage) continue;
      counted += 1;
      if (Number.isFinite(usage.cost)) totalCost += usage.cost;
      if (Number.isFinite(usage.completion_tokens)) {
        totalCompletionTokens += usage.completion_tokens;
      }
    }
  }
  return counted
    ? `This story: ${counted} replies · ${totalCompletionTokens.toLocaleString()} generated tokens · $${totalCost.toFixed(totalCost < 0.01 && totalCost > 0 ? 4 : 2)}`
    : "No usage recorded for this story yet.";
}

/* ------------------------------------------------------------ data files */

function exportProject(projectId) {
  const project =
    state.projects.find((item) => item.project_id === projectId) || getProject();
  const blob = new Blob([JSON.stringify(project, exportReplacer, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${slugify(project.title)}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  toast("Story exported.");
}

const MAX_IMPORT_BYTES = 25 * 1024 * 1024;

async function importProject() {
  const file = elements.importFile.files?.[0];
  elements.importFile.value = "";
  if (!file) return;
  if (file.size > MAX_IMPORT_BYTES) {
    toast("Import failed: that file is larger than 25 MB.", "error");
    return;
  }
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    toast("Import failed: the file is not valid JSON.", "error");
    return;
  }
  try {
    const project = normalizeProject(parsed);
    const duplicate = state.projects.some(
      (item) => item.project_id === project.project_id,
    );
    if (duplicate) {
      project.project_id = createStoryProject().project_id;
      project.title = `${project.title} (Imported)`;
    }
    state.projects.push(project);
    state.activeProjectId = project.project_id;
    closeAllSheets();
    persist();
    renderAll();
    toast("Story imported.");
  } catch (error) {
    toast(`Import failed: ${error.message}`, "error");
  }
}

async function clearData() {
  const confirmed = await confirmDialog({
    message:
      "Erase every story on this device, along with any remembered API key? This cannot be undone.",
    confirmLabel: "Erase everything",
    danger: true,
  });
  if (!confirmed) return;
  await clearAllLocalDataDurable();
  const project = createStoryProject({ title: "Untitled story" });
  state.projects = [project];
  state.activeProjectId = project.project_id;
  state.apiKey = "";
  state.rememberApiKey = false;
  state.falApiKey = "";
  state.snippets = [];
  state.imageCache.clear();
  persist();
  renderAll();
  toast("Everything erased.");
}

/* ------------------------------------------------------------- plumbing */

function buildCurrentContext() {
  const project = getProject();
  return assembleContext({
    storyProject: project,
    activeBranchId: project.active_branch_id,
    selectedCharacterIds: project.settings.selected_character_ids,
    selectedLocationId: project.settings.selected_location_id,
    maxRecentMessages: project.settings.recent_message_count,
    includeHiddenKnowledge: project.settings.include_hidden_knowledge,
    userInstructions: project.settings.user_instructions,
    you: project.settings.you,
  });
}

// Images are loaded from IndexedDB on demand; a re-render is triggered as
// each one arrives so renderChat can stay synchronous.
function loadBranchImages(branch) {
  for (const message of branch.messages) {
    const id = message.message_id;
    if (
      !message.metadata?.has_image ||
      state.imageCache.has(id) ||
      state.imageLoadsPending.has(id)
    ) {
      continue;
    }
    state.imageLoadsPending.add(id);
    idbGet(`image:${id}`)
      .then((dataUrl) => {
        state.imageLoadsPending.delete(id);
        if (typeof dataUrl === "string" && dataUrl) {
          state.imageCache.set(id, dataUrl);
          renderAll();
        } else {
          // The pixels were never stored (cleared data, other device). Drop
          // the marker so the transcript doesn't show a stuck loader.
          message.metadata = { ...message.metadata, has_image: false };
          persist();
          renderAll();
        }
      })
      .catch(() => {
        state.imageLoadsPending.delete(id);
      });
  }
}

function isGeneratingBranchVisible() {
  if (!state.generation) return false;
  const project = getProject();
  if (project.project_id !== state.generation.projectId) return false;
  return getActiveBranch(project).branch_id === state.generation.branchId;
}

function toTranscript(messages) {
  return messages
    .map(
      (message) =>
        `${message.speaker_name || roleForTranscript(message.role)}: ${message.content}`,
    )
    .join("\n");
}

function roleForTranscript(role) {
  return role === "assistant" || role === "narrator" ? "Narrator" : "User";
}

function summaryRequestMessages(existingSummary, transcript) {
  return [
    {
      role: "system",
      content:
        "You summarize roleplay transcripts into story memory. Preserve plot events, character development, relationships, promises, secrets revealed, and unresolved threads. Write in third person, past tense, under 300 words. Return only the summary.",
    },
    {
      role: "user",
      content: existingSummary
        ? `Existing story summary:\n${existingSummary}\n\nFold in this newer transcript and return one combined summary:\n${transcript}`
        : `Summarize this transcript:\n${transcript}`,
    },
  ];
}

// Models often wrap JSON in prose or code fences; pull out the outermost
// object and parse it defensively.
function parseJsonObject(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

let lastSaveErrorToastAt = 0;

function persist() {
  setStoredActiveProjectId(state.activeProjectId);
  void saveProjectsDurable(state.projects).then((result) => {
    state.saveFailed = !result.ok;
    if (!result.ok && storageAvailable) {
      const now = Date.now();
      if (now - lastSaveErrorToastAt > 10000) {
        lastSaveErrorToastAt = now;
        toast(
          result.quotaExceeded
            ? "Save failed: browser storage is full. Export your story to avoid losing work."
            : "Save failed: could not write to browser storage.",
          "error",
        );
      }
    }
    renderSaveStatus();
  });
}

function toast(message, type = "") {
  const element = document.createElement("div");
  element.className = `toast ${type}`.trim();
  element.textContent = message;
  elements.toastRegion.append(element);
  setTimeout(() => element.remove(), 3600);
}

function slugify(value) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "story-project"
  );
}

function exportReplacer(key, value) {
  const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (
    ["apikey", "openrouterkey", "openrouterapikey", "authorization"].includes(
      normalizedKey,
    )
  ) {
    return undefined;
  }
  return value;
}
