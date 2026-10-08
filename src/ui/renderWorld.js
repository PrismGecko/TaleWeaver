import {
  ENTRY_KIND_LABELS,
  createEntity,
  getCollectionName,
  getEntityId,
  getEntityTitle,
  listWorldEntries,
} from "../models/storyProject.js";
import { toStringArray } from "../utils/sanitize.js";
import {
  chipField,
  disclosure,
  readFields,
  readIds,
  selectField,
  textField,
  textareaField,
} from "./formFields.js";
import { openMenu } from "./sheet.js";

/**
 * The two fields that replaced the persona collection: who the user plays.
 * Reachable from both the world browser and settings, so it lives on its own.
 * @param {{project: object, onChange: (message?: string) => void}} deps
 */
export function youScreen({ project, onChange }) {
  return {
    title: "Who you play",
    action: { label: "Save", variant: "is-primary", onClick: () => {} },
    render(body, sheet) {
      const form = document.createElement("div");
      form.className = "sheet-form";
      form.append(
        textField({
          label: "Your character's name",
          name: "name",
          value: project.settings.you.name,
          placeholder: "Leave blank to play nobody in particular",
        }),
        textareaField({
          label: "About them",
          name: "description",
          rows: 4,
          value: project.settings.you.description,
          placeholder: "Who they are, how they carry themselves…",
        }),
      );
      const note = document.createElement("p");
      note.className = "form-note";
      note.textContent =
        "Naming your character tells the AI never to speak, act or decide for them. It is the single most useful thing on this screen.";
      form.append(note);
      body.append(form);

      this.action.onClick = () => {
        const values = readFields(form);
        project.settings.you = {
          name: String(values.name || "").trim(),
          description: String(values.description || "").trim(),
        };
        onChange("Saved.");
        sheet.pop();
      };
    },
  };
}

const KIND_FILTERS = [
  ["all", "All"],
  ["character", "Characters"],
  ["location", "Locations"],
  ["object", "Objects"],
  ["fact", "Facts"],
];

/**
 * The world browser: one searchable list of characters, locations, objects and
 * facts. Objects and facts are canon entries underneath, but the word "canon"
 * never appears — and no screen here asks the user to type an internal ID.
 *
 * @param {{project: object, onChange: (message?: string) => void, confirm: (config: object) => Promise<boolean>}} deps
 */
export function worldScreen({ project, onChange, confirm }) {
  const view = { query: "", kind: "all" };

  return {
    title: "World",
    action: {
      label: "New",
      onClick: () => {},
      variant: "is-primary",
    },
    render(body, sheet) {
      // The header action needs the sheet handle, which only exists here.
      this.action.onClick = () => promptNewEntry(sheet);

      body.append(youRow(sheet));

      const search = document.createElement("input");
      search.type = "search";
      search.className = "world-search";
      search.placeholder = "Search the world…";
      search.value = view.query;
      search.addEventListener("input", () => {
        view.query = search.value;
        drawList();
      });
      body.append(search);

      const filters = document.createElement("div");
      filters.className = "segmented";
      for (const [value, label] of KIND_FILTERS) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `segment${view.kind === value ? " is-on" : ""}`;
        button.textContent = label;
        button.addEventListener("click", () => {
          view.kind = value;
          for (const sibling of filters.children) {
            sibling.classList.toggle("is-on", sibling === button);
          }
          drawList();
        });
        filters.append(button);
      }
      body.append(filters);

      const list = document.createElement("div");
      list.className = "world-list";
      body.append(list);
      drawList();

      function drawList() {
        list.replaceChildren();
        const query = view.query.trim().toLowerCase();
        const entries = listWorldEntries(project).filter((entry) => {
          if (view.kind !== "all" && entry.kind !== view.kind) return false;
          if (!query) return true;
          return `${entry.title} ${searchableText(entry)}`
            .toLowerCase()
            .includes(query);
        });

        if (!entries.length) {
          const empty = document.createElement("p");
          empty.className = "empty-note";
          empty.textContent = query
            ? "Nothing matches that search."
            : "Nothing here yet. Tap New to add someone or something.";
          list.append(empty);
          return;
        }

        for (const entry of entries) {
          const row = document.createElement("button");
          row.type = "button";
          row.className = "world-row";
          const badge = document.createElement("span");
          badge.className = `kind-badge kind-${entry.kind}`;
          badge.textContent = ENTRY_KIND_LABELS[entry.kind][0];
          badge.title = ENTRY_KIND_LABELS[entry.kind];
          const text = document.createElement("span");
          text.className = "world-row-text";
          const name = document.createElement("strong");
          name.textContent = entry.title;
          const meta = document.createElement("small");
          meta.textContent = entryMeta(entry);
          text.append(name, meta);
          row.append(badge, text);
          row.addEventListener("click", () =>
            sheet.push(editorScreen(entry.kind, entry.entity)),
          );
          list.append(row);
        }
      }
    },
  };

  function youRow(sheet) {
    const you = project.settings.you;
    const row = document.createElement("button");
    row.type = "button";
    row.className = "you-row";
    const label = document.createElement("span");
    label.className = "you-label";
    label.textContent = "You play";
    const value = document.createElement("strong");
    value.textContent = you.name || "Nobody in particular — tap to set";
    row.append(label, value);
    row.addEventListener("click", () =>
      sheet.push(youScreen({ project, onChange })),
    );
    return row;
  }

  function promptNewEntry(sheet) {
    openMenu({
      title: "Add to the world",
      items: [
        {
          label: "Character",
          icon: "☺",
          hint: "Someone the story can bring on stage",
          onSelect: () => createAndEdit(sheet, "character"),
        },
        {
          label: "Location",
          icon: "◈",
          hint: "A place scenes happen in",
          onSelect: () => createAndEdit(sheet, "location"),
        },
        {
          label: "Object",
          icon: "✧",
          hint: "A thing that matters — an heirloom, a weapon, a letter",
          onSelect: () => createAndEdit(sheet, "object"),
        },
        {
          label: "Fact",
          icon: "✦",
          hint: "A rule, a piece of history, how the world works",
          onSelect: () => createAndEdit(sheet, "fact"),
        },
      ],
    });
  }

  function createAndEdit(sheet, kind) {
    const entity = createEntity(kind, {});
    project[getCollectionName(kind)].push(entity);
    // Move the filter to what was just created, so saving returns to a list
    // the new entry is actually in rather than appearing to lose it.
    if (view.kind !== "all") view.kind = kind;
    onChange();
    sheet.push(editorScreen(kind, entity, { isNew: true }));
  }

  function editorScreen(kind, entity, options = {}) {
    return {
      title: options.isNew
        ? `New ${ENTRY_KIND_LABELS[kind].toLowerCase()}`
        : getEntityTitle(kind, entity) || ENTRY_KIND_LABELS[kind],
      action: { label: "Save", variant: "is-primary", onClick: () => {} },
      render(body, sheet) {
        const form = document.createElement("div");
        form.className = "sheet-form";
        if (kind === "character") buildCharacterForm(form, entity);
        else if (kind === "location") buildLocationForm(form, entity);
        else buildCanonForm(form, kind, entity);

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "danger-button";
        remove.textContent = `Delete this ${ENTRY_KIND_LABELS[kind].toLowerCase()}`;
        remove.addEventListener("click", async () => {
          const confirmed = await confirm({
            message: `Delete ${getEntityTitle(kind, entity) || "this entry"}?`,
            confirmLabel: "Delete",
            danger: true,
          });
          if (!confirmed) return;
          const collection = getCollectionName(kind);
          project[collection] = project[collection].filter(
            (item) => getEntityId(kind, item) !== getEntityId(kind, entity),
          );
          detachReferences(getEntityId(kind, entity));
          onChange("Deleted.");
          sheet.pop();
        });
        form.append(remove);
        body.append(form);

        this.action.onClick = () => {
          applyValues(kind, entity, readFields(form));
          onChange("Saved.");
          sheet.pop();
        };
      },
    };
  }

  function buildCharacterForm(form, entity) {
    form.append(
      textField({
        label: "Name",
        name: "name",
        value: entity.name,
        required: true,
      }),
      textField({
        label: "Role",
        name: "role",
        value: entity.role,
        placeholder: "Disgraced royal cartographer",
      }),
      textareaField({
        label: "Description",
        name: "description",
        value: entity.description,
        rows: 3,
        placeholder: "How they look, what you notice first…",
      }),
      textareaField({
        label: "Personality",
        name: "personality",
        value: entity.personality,
        rows: 3,
      }),
      textareaField({
        label: "How they speak",
        name: "speech_style",
        value: entity.speech_style,
        rows: 2,
        placeholder: "Clipped sentences, never swears, calls everyone 'friend'…",
      }),
      textareaField({
        label: "Example dialogue",
        name: "example_dialogue",
        value: entity.example_dialogue,
        rows: 4,
        placeholder:
          "\"You're late.\" *She doesn't look up from the map.* \"Sit. Touch nothing.\"",
        hint: "A few lines in their voice. The AI copies examples far more closely than descriptions.",
      }),
      textareaField({
        label: "What they want",
        name: "goals",
        value: entity.goals,
        rows: 2,
      }),
      disclosure("More about this character", (inner) => {
        inner.append(
          textField({
            label: "Also known as",
            name: "aliases",
            value: entity.aliases.join(", "),
            hint: "Comma-separated.",
          }),
          textareaField({
            label: "Relationships",
            name: "relationships",
            value: entity.relationships,
            rows: 2,
          }),
          textareaField({
            label: "Secrets",
            name: "secrets",
            value: entity.secrets,
            rows: 2,
            placeholder: "Only reaches the AI if you turn on secrets in Settings.",
          }),
          textField({
            label: "Mood right now",
            name: "current_emotional_state",
            value: entity.current_emotional_state,
            hint: "Updated automatically after replies unless you turn that off.",
          }),
          chipField({
            label: "Knows about",
            name: "knowledge_ids",
            multiple: true,
            options: canonOptions(),
            selected: entity.knowledge_ids,
            emptyText: "Add objects or facts first, then tap them here.",
          }),
          selectField({
            label: "Who can see them",
            name: "visibility",
            value: entity.visibility,
            options: [
              ["public", "Everyone — normal character"],
              ["private_to_user", "Only you"],
              ["hidden_from_user", "Hidden from you"],
            ],
          }),
        );
      }),
    );
  }

  function buildLocationForm(form, entity) {
    form.append(
      textField({
        label: "Name",
        name: "name",
        value: entity.name,
        required: true,
      }),
      textareaField({
        label: "Description",
        name: "description",
        value: entity.description,
        rows: 4,
      }),
      textField({
        label: "Mood",
        name: "mood",
        value: entity.mood,
        placeholder: "Hushed, luminous, faintly dangerous",
      }),
      disclosure("Connections", (inner) => {
        inner.append(
          chipField({
            label: "Who is usually here",
            name: "associated_character_ids",
            multiple: true,
            options: characterOptions(),
            selected: entity.associated_character_ids,
            emptyText: "Add characters first, then tap them here.",
          }),
          chipField({
            label: "What is true here",
            name: "canon_ids",
            multiple: true,
            options: canonOptions(),
            selected: entity.canon_ids,
            emptyText: "Add objects or facts first, then tap them here.",
          }),
        );
      }),
    );
  }

  function buildCanonForm(form, kind, entity) {
    const always = entity.importance === "essential";
    form.append(
      textField({
        label: "Name",
        name: "title",
        value: entity.title,
        required: true,
        placeholder:
          kind === "object" ? "The salt-iron key" : "Memory has weight",
      }),
      textareaField({
        label: "What the AI should know",
        name: "content",
        value: entity.content,
        rows: 4,
      }),
    );

    const keywords = textField({
      label: "Bring it up when I mention",
      name: "keywords",
      value: entity.keywords.join(", "),
      placeholder: "Leave blank to use the name above",
      hint: "Comma-separated words. The entry joins the AI's memory whenever one of them appears in recent messages.",
    });

    const memory = selectField({
      label: "How the AI remembers it",
      name: "memory_rule",
      value: always ? "always" : "keyword",
      options: [
        ["keyword", "Only when it comes up"],
        ["always", "Always — it's core to the story"],
      ],
      hint: "Keep most entries on 'only when it comes up' so the AI's memory stays focused.",
      onChange: (value) => keywords.classList.toggle("hidden", value === "always"),
    });
    keywords.classList.toggle("hidden", always);
    form.append(memory, keywords);

    form.append(
      disclosure("Connections", (inner) => {
        inner.append(
          chipField({
            label: "Related characters",
            name: "related_character_ids",
            multiple: true,
            options: characterOptions(),
            selected: entity.related_character_ids,
            emptyText: "Add characters first, then tap them here.",
          }),
          chipField({
            label: "Related places",
            name: "related_location_ids",
            multiple: true,
            options: locationOptions(),
            selected: entity.related_location_ids,
            emptyText: "Add locations first, then tap them here.",
          }),
        );
      }),
    );
  }

  function applyValues(kind, entity, values) {
    if (kind === "character") {
      Object.assign(entity, {
        name: values.name.trim() || "Unnamed character",
        role: values.role,
        description: values.description,
        personality: values.personality,
        speech_style: values.speech_style,
        example_dialogue: values.example_dialogue,
        goals: values.goals,
        aliases: toStringArray(values.aliases),
        relationships: values.relationships,
        secrets: values.secrets,
        current_emotional_state: values.current_emotional_state,
        knowledge_ids: readIds(values.knowledge_ids),
        visibility: values.visibility,
      });
      return;
    }
    if (kind === "location") {
      Object.assign(entity, {
        name: values.name.trim() || "Unnamed location",
        description: values.description,
        mood: values.mood,
        associated_character_ids: readIds(values.associated_character_ids),
        canon_ids: readIds(values.canon_ids),
      });
      return;
    }

    const title = values.title.trim() || `Untitled ${kind}`;
    const always = values.memory_rule === "always";
    const keywords = toStringArray(values.keywords);
    Object.assign(entity, {
      title,
      content: values.content,
      // "Only when it comes up" with no keywords would silently behave as
      // always-on, so the name stands in as the trigger word.
      importance: always ? "essential" : "important",
      keywords: always ? [] : keywords.length ? keywords : [title.toLowerCase()],
      related_character_ids: readIds(values.related_character_ids),
      related_location_ids: readIds(values.related_location_ids),
    });
  }

  /** Drop a deleted entity's ID from every list that pointed at it. */
  function detachReferences(id) {
    if (!id) return;
    const without = (ids) => ids.filter((item) => item !== id);
    for (const character of project.characters) {
      character.knowledge_ids = without(character.knowledge_ids);
    }
    for (const location of project.locations) {
      location.associated_character_ids = without(location.associated_character_ids);
      location.canon_ids = without(location.canon_ids);
    }
    for (const entry of project.canon_entries) {
      entry.related_character_ids = without(entry.related_character_ids);
      entry.related_location_ids = without(entry.related_location_ids);
    }
    project.settings.selected_character_ids = without(
      project.settings.selected_character_ids,
    );
    if (project.settings.selected_location_id === id) {
      project.settings.selected_location_id = null;
    }
  }

  function characterOptions() {
    return project.characters.map((item) => ({
      id: item.character_id,
      label: item.name,
    }));
  }

  function locationOptions() {
    return project.locations.map((item) => ({
      id: item.location_id,
      label: item.name,
    }));
  }

  function canonOptions() {
    return project.canon_entries.map((item) => ({
      id: item.canon_id,
      label: item.title,
    }));
  }
}

function searchableText(entry) {
  if (entry.kind === "character") {
    return `${entry.entity.role} ${entry.entity.description}`;
  }
  if (entry.kind === "location") {
    return `${entry.entity.mood} ${entry.entity.description}`;
  }
  return `${entry.entity.content} ${entry.entity.keywords.join(" ")}`;
}

function entryMeta(entry) {
  if (entry.kind === "character") {
    return entry.entity.role || "Character";
  }
  if (entry.kind === "location") {
    return entry.entity.mood || "Location";
  }
  return entry.entity.importance === "essential"
    ? "Always remembered"
    : `When you mention: ${entry.entity.keywords.join(", ") || entry.title}`;
}
