import { createId, nowIso } from "../utils/id.js";
import { safeNumber, toPlainText, toStringArray } from "../utils/sanitize.js";

export const MODEL_PRESETS = [
  "openai/gpt-4o-mini",
  "openai/gpt-4.1",
  "anthropic/claude-3.5-sonnet",
  "anthropic/claude-3.7-sonnet",
  "google/gemini-2.0-flash-001",
  "meta-llama/llama-3.1-70b-instruct",
  "mistralai/mistral-large",
];

const COLLECTIONS = [
  "branches",
  "canon_entries",
  "characters",
  "locations",
];

// The world browser shows one flat list of four kinds. Characters and
// locations have their own collections; objects and facts are both canon
// entries, split on `type` so the user never meets the word "canon".
export const ENTRY_KINDS = ["character", "location", "object", "fact"];

export const ENTRY_KIND_LABELS = {
  character: "Character",
  location: "Location",
  object: "Object",
  fact: "Fact",
};

export function createMessage(overrides = {}) {
  return {
    message_id: toPlainText(overrides.message_id) || createId("msg"),
    role: ["user", "assistant", "system", "narrator", "character"].includes(
      overrides.role,
    )
      ? overrides.role
      : "user",
    speaker_name: toPlainText(overrides.speaker_name),
    content: toPlainText(overrides.content),
    created_at: toPlainText(overrides.created_at) || nowIso(),
    metadata: isRecord(overrides.metadata) ? { ...overrides.metadata } : {},
  };
}

export function createBranch(overrides = {}) {
  const timestamp = nowIso();
  return {
    branch_id: toPlainText(overrides.branch_id) || createId("branch"),
    parent_branch_id: toPlainText(overrides.parent_branch_id) || null,
    title: toPlainText(overrides.title, "Main thread") || "Main thread",
    created_at: toPlainText(overrides.created_at) || timestamp,
    updated_at: toPlainText(overrides.updated_at) || timestamp,
    messages: Array.isArray(overrides.messages)
      ? overrides.messages.map(createMessage)
      : [],
    summary: toPlainText(overrides.summary),
    // Scene-level steering placed just before the newest message, where it
    // outweighs the long system prompt; see contextAssembler.
    author_note: toPlainText(overrides.author_note),
    summary_message_count: safeNumber(overrides.summary_message_count, 0, {
      min: 0,
    }),
    tags: toStringArray(overrides.tags),
    fork_source_message_id:
      toPlainText(overrides.fork_source_message_id) || null,
  };
}

export function createStoryProject(overrides = {}) {
  const timestamp = nowIso();
  const mainBranch = createBranch({ title: "Main thread" });
  const project = {
    project_id: toPlainText(overrides.project_id) || createId("project"),
    title: toPlainText(overrides.title, "Untitled story") || "Untitled story",
    created_at: toPlainText(overrides.created_at) || timestamp,
    updated_at: toPlainText(overrides.updated_at) || timestamp,
    active_branch_id:
      toPlainText(overrides.active_branch_id) || mainBranch.branch_id,
    settings: normalizeSettings(overrides.settings),
    branches: Array.isArray(overrides.branches)
      ? overrides.branches.map(createBranch)
      : [mainBranch],
    canon_entries: migrateLegacyCollections(
      overrides,
      normalizeCanonEntries(overrides.canon_entries),
    ),
    characters: normalizeCharacters(overrides.characters),
    locations: normalizeLocations(overrides.locations),
    metadata: isRecord(overrides.metadata) ? { ...overrides.metadata } : {},
  };
  migrateLegacyPersonas(overrides, project);

  const branchIds = new Set();
  project.branches = project.branches.filter((branch) => {
    if (branchIds.has(branch.branch_id)) return false;
    branchIds.add(branch.branch_id);
    return true;
  });
  if (!project.branches.length) {
    project.branches = [mainBranch];
    branchIds.add(mainBranch.branch_id);
  }
  for (const branch of project.branches) {
    if (
      branch.parent_branch_id === branch.branch_id ||
      (branch.parent_branch_id && !branchIds.has(branch.parent_branch_id))
    ) {
      branch.parent_branch_id = null;
    }
  }
  if (!project.branches.some((branch) => branch.branch_id === project.active_branch_id)) {
    project.active_branch_id = project.branches[0].branch_id;
  }

  return project;
}

export function normalizeProject(input) {
  if (!isRecord(input)) {
    throw new Error("Project JSON must contain an object.");
  }
  return createStoryProject(input);
}

export function createDemoProject() {
  const project = createStoryProject({ title: "The Glass Archive" });
  const branch = project.branches[0];
  const character = normalizeCharacter({
    name: "Mara Venn",
    role: "Disgraced royal cartographer",
    description: "Maps places that have been erased from public memory.",
    personality: "Watchful, dryly funny, loyal once trust is earned.",
    speech_style: "Precise language, short observations, avoids direct promises.",
    goals: "Find the vanished district of Bellweather.",
    secrets: "Her oldest map changes whenever she sleeps.",
    current_emotional_state: "Guardedly hopeful",
  });
  const location = normalizeLocation({
    name: "The Glass Archive",
    description:
      "A moonlit library whose shelves preserve memories inside glass folios.",
    mood: "Hushed, luminous, faintly dangerous",
  });
  const canon = normalizeCanonEntry({
    title: "Memory has weight",
    type: "rule",
    importance: "essential",
    content:
      "Removing a memory from the Archive makes its glass folio physically heavier.",
    related_character_ids: [character.character_id],
    related_location_ids: [location.location_id],
  });
  character.knowledge_ids = [canon.canon_id];
  location.associated_character_ids = [character.character_id];
  location.canon_ids = [canon.canon_id];
  branch.messages = [
    createMessage({
      role: "assistant",
      speaker_name: "Narrator",
      content:
        "Rain ticked against the Archive's glass roof as Mara Venn found a map bearing tomorrow's date.",
    }),
  ];
  project.characters.push(character);
  project.locations.push(location);
  project.canon_entries.push(canon);
  project.canon_entries.push(
    normalizeCanonEntry({
      title: "Unresolved thread: The impossible map",
      type: "other",
      importance: "essential",
      content:
        "Discover who drew the map and why Bellweather appears on it.",
      related_character_ids: [character.character_id],
      related_location_ids: [location.location_id],
    }),
  );
  project.settings.selected_character_ids = [character.character_id];
  project.settings.selected_location_id = location.location_id;
  return project;
}

export function touchProject(project) {
  project.updated_at = nowIso();
  return project;
}

export function getActiveBranch(project) {
  return (
    project.branches.find(
      (branch) => branch.branch_id === project.active_branch_id,
    ) || project.branches[0]
  );
}

export function normalizeSettings(input = {}) {
  const settings = isRecord(input) ? input : {};
  return {
    model: toPlainText(settings.model, MODEL_PRESETS[0]) || MODEL_PRESETS[0],
    image_provider: ["openrouter", "fal"].includes(settings.image_provider)
      ? settings.image_provider
      : "openrouter",
    image_model:
      toPlainText(settings.image_model, "google/gemini-2.5-flash-image") ||
      "google/gemini-2.5-flash-image",
    fal_image_model: toPlainText(
      settings.fal_image_model,
      "stabilityai/stable-diffusion-xl-base-1.0",
    ),
    temperature: safeNumber(settings.temperature, 0.8, { min: 0, max: 2 }),
    max_tokens: safeNumber(settings.max_tokens, 1200, { min: 64, max: 32000 }),
    recent_message_count: safeNumber(settings.recent_message_count, 30, {
      min: 1,
      max: 200,
    }),
    include_hidden_knowledge: Boolean(settings.include_hidden_knowledge),
    auto_summarize:
      settings.auto_summarize === undefined
        ? true
        : Boolean(settings.auto_summarize),
    auto_track_emotions:
      settings.auto_track_emotions === undefined
        ? true
        : Boolean(settings.auto_track_emotions),
    selected_character_ids: toStringArray(settings.selected_character_ids),
    selected_location_id: toPlainText(settings.selected_location_id) || null,
    you: normalizeYou(settings.you),
    user_instructions: toPlainText(settings.user_instructions),
  };
}

// "You" replaces the old persona collection: the model needs to know who the
// user plays so it never puppets them, but that is two fields about one
// person, not a CRUD collection with its own picker.
function normalizeYou(input) {
  const you = isRecord(input) ? input : {};
  return {
    name: toPlainText(you.name),
    description: toPlainText(you.description),
  };
}

export function createEntity(kind, overrides = {}) {
  if (kind === "character") return normalizeCharacter(overrides);
  if (kind === "location") return normalizeLocation(overrides);
  if (kind === "object") return normalizeCanonEntry({ ...overrides, type: "object" });
  if (kind === "fact") {
    // Facts cover every non-object canon type, so an existing type on a
    // legacy entry is preserved instead of being flattened to "fact".
    const type = overrides.type && overrides.type !== "object" ? overrides.type : "fact";
    return normalizeCanonEntry({ ...overrides, type });
  }
  throw new Error(`Unknown entity kind: ${kind}`);
}

export function getCollectionName(kind) {
  const names = {
    character: "characters",
    location: "locations",
    object: "canon_entries",
    fact: "canon_entries",
  };
  return names[kind];
}

export function getEntityId(kind, entity) {
  const fields = {
    character: "character_id",
    location: "location_id",
    object: "canon_id",
    fact: "canon_id",
  };
  return entity?.[fields[kind]];
}

export function getEntityTitle(kind, entity) {
  return kind === "character" || kind === "location" ? entity.name : entity.title;
}

/** Which of the four world kinds an entity in a given collection belongs to. */
export function getEntityKind(collectionName, entity) {
  if (collectionName === "characters") return "character";
  if (collectionName === "locations") return "location";
  return entity?.type === "object" ? "object" : "fact";
}

/**
 * Every world entity as one flat, sorted list — the shape the world browser
 * renders. Characters and locations keep their collections; objects and facts
 * are drawn out of canon_entries by type.
 */
export function listWorldEntries(project) {
  const entries = [
    ...project.characters.map((entity) => ({ kind: "character", entity })),
    ...project.locations.map((entity) => ({ kind: "location", entity })),
    ...project.canon_entries.map((entity) => ({
      kind: entity.type === "object" ? "object" : "fact",
      entity,
    })),
  ];
  for (const entry of entries) {
    entry.id = getEntityId(entry.kind, entry.entity);
    entry.title = getEntityTitle(entry.kind, entry.entity);
  }
  return entries.sort((left, right) => left.title.localeCompare(right.title));
}

function normalizeCanonEntries(items) {
  return Array.isArray(items) ? items.map(normalizeCanonEntry) : [];
}

function normalizeCanonEntry(input = {}) {
  const timestamp = nowIso();
  return {
    canon_id: toPlainText(input.canon_id) || createId("canon"),
    title: toPlainText(input.title, "Untitled canon") || "Untitled canon",
    type: [
      "fact",
      "rule",
      "lore",
      "object",
      "faction",
      "relationship",
      "other",
    ].includes(input.type)
      ? input.type
      : "fact",
    content: toPlainText(input.content),
    importance: ["essential", "important", "optional"].includes(input.importance)
      ? input.importance
      : "important",
    keywords: toStringArray(input.keywords),
    related_character_ids: toStringArray(input.related_character_ids),
    related_location_ids: toStringArray(input.related_location_ids),
    created_at: toPlainText(input.created_at) || timestamp,
    updated_at: toPlainText(input.updated_at) || timestamp,
    metadata: isRecord(input.metadata) ? { ...input.metadata } : {},
  };
}

function normalizeCharacters(items) {
  return Array.isArray(items) ? items.map(normalizeCharacter) : [];
}

function normalizeCharacter(input = {}) {
  const timestamp = nowIso();
  return {
    character_id: toPlainText(input.character_id) || createId("character"),
    name: toPlainText(input.name, "Unnamed character") || "Unnamed character",
    aliases: toStringArray(input.aliases),
    role: toPlainText(input.role),
    description: toPlainText(input.description),
    personality: toPlainText(input.personality),
    speech_style: toPlainText(input.speech_style),
    example_dialogue: toPlainText(input.example_dialogue),
    goals: toPlainText(input.goals),
    secrets: toPlainText(input.secrets),
    relationships: toPlainText(input.relationships),
    current_emotional_state: toPlainText(input.current_emotional_state),
    knowledge_ids: toStringArray(input.knowledge_ids),
    visibility: ["public", "private_to_user", "hidden_from_user"].includes(
      input.visibility,
    )
      ? input.visibility
      : "public",
    created_at: toPlainText(input.created_at) || timestamp,
    updated_at: toPlainText(input.updated_at) || timestamp,
  };
}

function normalizeLocations(items) {
  return Array.isArray(items) ? items.map(normalizeLocation) : [];
}

function normalizeLocation(input = {}) {
  const timestamp = nowIso();
  return {
    location_id: toPlainText(input.location_id) || createId("location"),
    name: toPlainText(input.name, "Unnamed location") || "Unnamed location",
    description: toPlainText(input.description),
    mood: toPlainText(input.mood),
    associated_character_ids: toStringArray(input.associated_character_ids),
    canon_ids: toStringArray(input.canon_ids),
    created_at: toPlainText(input.created_at) || timestamp,
    updated_at: toPlainText(input.updated_at) || timestamp,
  };
}

// Legacy projects stored timeline events, story arcs, and scene cards as
// separate collections. Those collections are gone; on load/import their
// still-useful data is folded into canon entries so no story facts are lost.
function migrateLegacyCollections(input, canonEntries) {
  if (!isRecord(input)) return canonEntries;
  const existingIds = new Set(canonEntries.map((entry) => entry.canon_id));
  const add = (entry) => {
    if (existingIds.has(entry.canon_id)) return;
    existingIds.add(entry.canon_id);
    canonEntries.push(entry);
  };

  if (Array.isArray(input.timeline_events)) {
    for (const event of input.timeline_events) {
      if (!isRecord(event)) continue;
      const when =
        toPlainText(event.chronology_label) ||
        toPlainText(event.absolute_datetime);
      const legacyId = toPlainText(event.event_id);
      add(
        normalizeCanonEntry({
          canon_id: legacyId ? `canon_migrated_${legacyId}` : undefined,
          title: toPlainText(event.title, "Untitled event"),
          type: "fact",
          importance: "important",
          content:
            [when, toPlainText(event.description)]
              .filter(Boolean)
              .join(": ") || toPlainText(event.title, "Untitled event"),
          related_character_ids: toStringArray(event.related_character_ids),
          related_location_ids: toStringArray(event.related_location_ids),
          created_at: toPlainText(event.created_at),
          metadata: { migrated_from: "timeline_event" },
        }),
      );
    }
  }

  if (Array.isArray(input.story_arcs)) {
    for (const arc of input.story_arcs) {
      if (!isRecord(arc)) continue;
      // Resolved and abandoned arcs are finished business; only live threads
      // carry forward into canon.
      if (["resolved", "abandoned"].includes(arc.status)) continue;
      const legacyId = toPlainText(arc.arc_id);
      add(
        normalizeCanonEntry({
          canon_id: legacyId ? `canon_migrated_${legacyId}` : undefined,
          title: `Unresolved thread: ${toPlainText(arc.title, "Untitled arc")}`,
          type: "other",
          importance: "essential",
          content:
            [
              toPlainText(arc.description),
              toPlainText(arc.payoff_notes) &&
                `Payoff notes: ${toPlainText(arc.payoff_notes)}`,
            ]
              .filter(Boolean)
              .join("\n") || toPlainText(arc.title, "Untitled arc"),
          related_character_ids: toStringArray(arc.related_character_ids),
          related_location_ids: toStringArray(arc.related_location_ids),
          created_at: toPlainText(arc.created_at),
          metadata: { migrated_from: "story_arc" },
        }),
      );
    }
  }

  // Scene cards are dropped: "current scene" is covered by the selected
  // location and the branch summary.
  return canonEntries;
}

// Legacy projects kept a `personas` collection plus a `settings.active_persona_id`
// pointer. The persona the user was actually playing becomes `settings.you`;
// any spares become characters rather than being thrown away.
function migrateLegacyPersonas(input, project) {
  if (!isRecord(input) || !Array.isArray(input.personas)) return;
  const personas = input.personas.filter(isRecord);
  if (!personas.length) return;

  const activeId = toPlainText(input.settings?.active_persona_id);
  const activeIndex = personas.findIndex(
    (persona) => toPlainText(persona.persona_id) === activeId,
  );
  const [primary] = personas.splice(activeIndex >= 0 ? activeIndex : 0, 1);

  if (!project.settings.you.name && primary) {
    project.settings.you = {
      name: toPlainText(primary.name),
      description: toPlainText(primary.description),
    };
  }

  const existingNames = new Set(
    project.characters.map((character) => character.name.toLowerCase()),
  );
  for (const persona of personas) {
    const name = toPlainText(persona.name);
    if (!name || existingNames.has(name.toLowerCase())) continue;
    existingNames.add(name.toLowerCase());
    project.characters.push(
      normalizeCharacter({
        name,
        description: toPlainText(persona.description),
        created_at: toPlainText(persona.created_at),
      }),
    );
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export { COLLECTIONS };
