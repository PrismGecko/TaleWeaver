import { getActiveBranch } from "../models/storyProject.js";

const DEFAULT_BUDGET = 48000;

export function assembleContext({
  storyProject,
  activeBranchId,
  selectedCharacterIds = [],
  selectedLocationId = null,
  maxRecentMessages = 30,
  includeHiddenKnowledge = false,
  userInstructions = "",
  you = null,
  characterBudget = DEFAULT_BUDGET,
}) {
  const branch =
    storyProject.branches.find(
      (item) => item.branch_id === activeBranchId,
    ) || getActiveBranch(storyProject);
  const selectedIdSet = new Set(selectedCharacterIds);
  const visibleCharacters = storyProject.characters.filter((character) => {
    const selected =
      selectedIdSet.size === 0 || selectedIdSet.has(character.character_id);
    const visible =
      includeHiddenKnowledge || character.visibility === "public";
    return selected && visible;
  });
  const knownCanonIds = new Set(
    visibleCharacters.flatMap((character) => character.knowledge_ids),
  );
  const recentSlice = branch.messages.slice(-Math.max(1, maxRecentMessages));
  const recentText = recentSlice
    // OOC steering messages are not part of the story, so they must not
    // trigger keyworded lorebook entries.
    .filter((message) => !message.metadata?.ooc)
    .map((message) => `${message.speaker_name}\n${message.content}`)
    .join("\n")
    .toLowerCase();
  const canon = storyProject.canon_entries.filter((entry) => {
    if (
      entry.metadata?.visibility === "hidden" &&
      !includeHiddenKnowledge
    ) {
      return false;
    }
    // Lorebook behavior: a keyworded entry only enters context while one of
    // its keywords appears in the recent conversation window.
    if (
      entry.keywords?.length &&
      entry.importance !== "essential" &&
      !entry.keywords.some((keyword) =>
        recentText.includes(keyword.toLowerCase()),
      )
    ) {
      return false;
    }
    if (!selectedIdSet.size) {
      return true;
    }
    return (
      entry.importance === "essential" ||
      knownCanonIds.has(entry.canon_id) ||
      entry.related_character_ids.some((id) => selectedIdSet.has(id)) ||
      entry.related_location_ids.includes(selectedLocationId)
    );
  });
  const location = storyProject.locations.find(
    (item) => item.location_id === selectedLocationId,
  );
  const player = you && String(you.name || "").trim() ? you : null;
  const systemSections = [
    "You are a collaborative long-form roleplay and narrative writing partner. Preserve continuity, honor established canon, and advance the scene with vivid but controlled prose. Do not decide the user's character's private thoughts or choices unless explicitly invited.",
    "Messages wrapped in [OOC: ...] are out-of-character instructions from the user. Follow them when writing your next reply, but never mention them or respond to them inside the story itself.",
    "An [Author's note: ...] near the end of the conversation is the user's current direction for the scene. Let it shape your next reply without mentioning it.",
    userInstructions ? `USER INSTRUCTIONS\n${userInstructions}` : "",
    branch.summary ? `STORY SO FAR\n${branch.summary}` : "",
    player
      ? `USER PERSONA\nThe user plays ${player.name}.${
          player.description ? `\n${player.description}` : ""
        }\nNever speak, act, or decide for ${player.name}.`
      : "",
    formatCanon(canon),
    formatCharacters(visibleCharacters, canon, includeHiddenKnowledge),
    formatLocation(location),
  ].filter(Boolean);

  const systemMessage = {
    role: "system",
    content: systemSections.join("\n\n"),
  };
  const recentMessages = recentSlice.map(toApiMessage);
  const authorNote = branch.author_note?.trim()
    ? { role: "user", content: `[Author's note: ${branch.author_note.trim()}]` }
    : null;
  const messages = placeAuthorNote(
    fitToCharacterBudget(
      [systemMessage, ...recentMessages],
      characterBudget - (authorNote?.content.length ?? 0),
    ),
    authorNote,
  );

  return {
    messages,
    diagnostics: {
      estimated_characters: messages.reduce(
        (sum, message) => sum + message.content.length,
        0,
      ),
      estimated_tokens: Math.ceil(
        messages.reduce((sum, message) => sum + message.content.length, 0) / 4,
      ),
      included_canon: canon.length,
      included_characters: visibleCharacters.length,
      branch_id: branch.branch_id,
    },
  };
}

function formatCanon(entries) {
  if (!entries.length) return "";
  return `CANON\n${entries
    .map(
      (entry) =>
        `- [${entry.importance}/${entry.type}] ${entry.title}: ${entry.content}`,
    )
    .join("\n")}`;
}

function formatCharacters(characters, canon, includeHidden) {
  if (!characters.length) return "";
  const canonById = new Map(canon.map((entry) => [entry.canon_id, entry]));
  return `CHARACTERS\n${characters
    .map((character) => {
      const details = [
        `${character.name}${character.role ? ` (${character.role})` : ""}`,
        character.description && `Description: ${character.description}`,
        character.personality && `Personality: ${character.personality}`,
        character.speech_style && `Speech: ${character.speech_style}`,
        character.example_dialogue &&
          `Example dialogue:\n    ${character.example_dialogue
            .trim()
            .split("\n")
            .join("\n    ")}`,
        character.goals && `Goals: ${character.goals}`,
        character.relationships && `Relationships: ${character.relationships}`,
        character.current_emotional_state &&
          `Current emotional state: ${character.current_emotional_state}`,
        includeHidden && character.secrets && `Secrets: ${character.secrets}`,
        character.knowledge_ids.length &&
          `Known facts: ${character.knowledge_ids
            .map((id) => canonById.get(id)?.title)
            .filter(Boolean)
            .join(", ")}`,
      ].filter(Boolean);
      return `- ${details.join("\n  ")}`;
    })
    .join("\n")}`;
}

function formatLocation(location) {
  if (!location) return "";
  return `CURRENT LOCATION\n${location.name}\n${location.description}${
    location.mood ? `\nMood: ${location.mood}` : ""
  }`;
}

function toApiMessage(message) {
  if (message.metadata?.ooc) {
    return { role: "user", content: `[OOC: ${message.content}]` };
  }
  let role = message.role;
  if (role === "narrator") {
    role = "assistant";
  }
  if (role === "character") {
    role = "user";
  }
  if (role === "assistant") {
    // The model's own turns go back unlabelled. Prefixing them with
    // "Narrator: " taught the model to open replies that way, and each
    // labelled reply was then re-prefixed, compounding into
    // "Narrator: Narrator: ..." over a long chat.
    return { role, content: stripNarratorLabel(message.content) };
  }
  const prefix = message.speaker_name ? `${message.speaker_name}: ` : "";
  return {
    role: ["system", "user"].includes(role) ? role : "user",
    content: `${prefix}${message.content}`,
  };
}

/** Remove a leading "Name:" label (plain or bolded) for the given speaker. */
export function stripSpeakerLabel(text, name) {
  const value = String(text ?? "");
  const trimmed = String(name || "").trim();
  if (!trimmed) return value;
  const label = new RegExp(
    `^\\s*\\**${escapeRegExp(trimmed)}\\**\\s*:\\s*\\**\\s*`,
    "i",
  );
  const stripped = value.replace(label, "");
  return stripped.trim() ? stripped : value;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const NARRATOR_LABEL = /^(?:\s*\*{0,2}(?:narrator|assistant)\*{0,2}\s*:\s*\*{0,2})+\s*/i;

/**
 * Remove any run of leading "Narrator:" / "Assistant:" labels a model put at
 * the start of its reply. Text that is nothing but a label is left alone.
 */
export function stripNarratorLabel(text) {
  const value = String(text ?? "");
  const stripped = value.replace(NARRATOR_LABEL, "");
  return stripped.trim() ? stripped : value;
}

// Instructions at the top of a long prompt lose their pull as the chat grows;
// the author's note sits just before the newest message, where the model is
// paying the most attention.
function placeAuthorNote(messages, note) {
  if (!note) return messages;
  if (messages.length < 2) return [...messages, note];
  return [...messages.slice(0, -1), note, messages.at(-1)];
}

/**
 * Stop sequences that end a reply when the model starts writing the user's
 * own turn. Providers that ignore `stop` are covered by cutAtSpeaker.
 */
export function userStopSequences(name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) return [];
  return [`\n${trimmed}:`, `\n**${trimmed}:**`, `\n**${trimmed}**:`];
}

/** Drop everything from the first line where the model speaks as `name`. */
export function cutAtSpeaker(text, name) {
  const value = String(text ?? "");
  const trimmed = String(name || "").trim();
  if (!trimmed) return value;
  const match = new RegExp(
    `\\n\\s*\\**${escapeRegExp(trimmed)}\\**\\s*:`,
  ).exec(value);
  if (!match) return value;
  const kept = value.slice(0, match.index).trimEnd();
  return kept || value;
}

function fitToCharacterBudget(messages, budget) {
  const safeBudget = Math.max(4000, Number(budget) || DEFAULT_BUDGET);
  const system = messages[0];
  const conversation = messages.slice(1);
  let total = system.content.length;
  const kept = [];

  for (let index = conversation.length - 1; index >= 0; index -= 1) {
    const message = conversation[index];
    if (total + message.content.length > safeBudget) {
      // The newest message must always reach the model; truncate it to the
      // remaining budget rather than sending the system prompt alone.
      if (!kept.length) {
        const room = Math.max(200, safeBudget - total);
        kept.unshift({
          ...message,
          content: message.content.slice(0, room),
        });
      }
      break;
    }
    kept.unshift(message);
    total += message.content.length;
  }

  return [system, ...kept];
}
