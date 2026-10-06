import {
  getCollectionName,
  getEntityId,
  getEntityTitle,
} from "../models/storyProject.js";
import { toStringArray } from "../utils/sanitize.js";

export const TOOL_DEFINITIONS = {
  canon: {
    label: "Canon",
    singular: "canon entry",
    fields: [
      field("title", "Title", "text", true),
      field("type", "Type", "select", true, [
        "fact",
        "rule",
        "lore",
        "object",
        "faction",
        "relationship",
        "other",
      ]),
      field("importance", "Importance", "select", true, [
        "essential",
        "important",
        "optional",
      ]),
      field("content", "Content", "textarea", true),
      field("keywords", "Trigger keywords (blank = always)", "list"),
      field("related_character_ids", "Related character IDs", "list"),
      field("related_location_ids", "Related location IDs", "list"),
    ],
  },
  characters: {
    label: "Characters",
    singular: "character",
    fields: [
      field("name", "Name", "text", true),
      field("aliases", "Aliases", "list"),
      field("role", "Role", "text"),
      field("description", "Description", "textarea"),
      field("personality", "Personality", "textarea"),
      field("speech_style", "Speech style", "textarea"),
      field("goals", "Goals", "textarea"),
      field("secrets", "Secrets", "textarea"),
      field("relationships", "Relationships", "textarea"),
      field("current_emotional_state", "Emotional state", "text"),
      field("knowledge_ids", "Known canon IDs", "list"),
      field("visibility", "Visibility", "select", true, [
        "public",
        "private_to_user",
        "hidden_from_user",
      ]),
    ],
  },
  locations: {
    label: "Locations",
    singular: "location",
    fields: [
      field("name", "Name", "text", true),
      field("description", "Description", "textarea"),
      field("mood", "Mood", "text"),
      field("associated_character_ids", "Character IDs", "list"),
      field("canon_ids", "Canon IDs", "list"),
    ],
  },
  personas: {
    label: "Personas",
    singular: "persona",
    fields: [
      field("name", "Name", "text", true),
      field("description", "Description", "textarea"),
    ],
  },
};

export function renderToolEditor({
  project,
  kind,
  selectedId,
  filters = {},
  listContainer,
  formContainer,
  onSelect,
  onCreate,
  onSave,
  onDelete,
  onFilter,
}) {
  const definition = TOOL_DEFINITIONS[kind];
  const collectionName = getCollectionName(kind);
  const allItems = project[collectionName];
  const items = filterItems(kind, allItems, filters);
  listContainer.replaceChildren();

  const header = document.createElement("div");
  header.className = "editor-list-header";
  const title = document.createElement("div");
  const titleLabel = document.createElement("strong");
  titleLabel.textContent = definition.label;
  const titleCount = document.createElement("span");
  titleCount.textContent = String(items.length);
  title.append(titleLabel, titleCount);
  const add = document.createElement("button");
  add.type = "button";
  add.className = "primary compact";
  add.textContent = "New";
  add.addEventListener("click", onCreate);
  header.append(title, add);
  listContainer.append(header);

  const filterRow = createFilterRow(kind, filters, onFilter);
  if (filterRow) listContainer.append(filterRow);

  const list = document.createElement("div");
  list.className = "record-list";
  for (const item of items) {
    const id = getEntityId(kind, item);
    const row = document.createElement("div");
    row.className = "record-row";
    row.classList.toggle("is-active", id === selectedId);

    const select = document.createElement("button");
    select.type = "button";
    select.className = "record-select";
    const itemTitle = document.createElement("strong");
    itemTitle.textContent = getEntityTitle(kind, item);
    const meta = document.createElement("span");
    meta.textContent = itemMeta(kind, item);
    select.append(itemTitle, meta);
    select.addEventListener("click", () => onSelect(id));
    row.append(select);
    list.append(row);
  }
  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "muted padded";
    empty.textContent = `No ${definition.label.toLowerCase()} yet.`;
    list.append(empty);
  }
  listContainer.append(list);

  const selected = allItems.find((item) => getEntityId(kind, item) === selectedId);
  renderForm({
    project,
    kind,
    definition,
    entity: selected,
    container: formContainer,
    onSave,
    onDelete,
  });
}

export function readEntityForm(form, definition) {
  const values = {};
  for (const definitionField of definition.fields) {
    const input = form.elements.namedItem(definitionField.name);
    if (!input) continue;
    if (definitionField.type === "list") {
      values[definitionField.name] = toStringArray(input.value);
    } else if (definitionField.type === "number") {
      values[definitionField.name] = Number(input.value || 0);
    } else {
      values[definitionField.name] = input.value;
    }
  }
  return values;
}

function renderForm({
  project,
  kind,
  definition,
  entity,
  container,
  onSave,
  onDelete,
}) {
  container.replaceChildren();
  if (!entity) {
    const empty = document.createElement("div");
    empty.className = "empty-state small";
    empty.append(
      textElement("h3", `Select a ${definition.singular}`),
      textElement("p", "Choose an item from the list, or create a new one."),
    );
    container.append(empty);
    return;
  }

  const form = document.createElement("form");
  form.className = "record-form";
  const heading = textElement("h3", getEntityTitle(kind, entity));
  form.append(heading);

  for (const definitionField of definition.fields) {
    form.append(createInput(definitionField, entity[definitionField.name]));
  }

  const actions = document.createElement("div");
  actions.className = "form-actions";
  const save = document.createElement("button");
  save.type = "submit";
  save.className = "primary";
  save.textContent = "Save changes";
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "danger";
  remove.textContent = "Delete";
  remove.addEventListener("click", () => onDelete(getEntityId(kind, entity)));
  actions.append(save, remove);
  form.append(actions);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    onSave(getEntityId(kind, entity), readEntityForm(form, definition));
  });
  container.append(form);
}

function createInput(definitionField, value) {
  const label = document.createElement("label");
  label.className = "field";
  const caption = document.createElement("span");
  caption.textContent = definitionField.label;
  let input;

  if (definitionField.type === "textarea") {
    input = document.createElement("textarea");
    input.rows = 4;
  } else if (definitionField.type === "select") {
    input = document.createElement("select");
    const options = definitionField.options.map((option) => ({
      value: option,
      label: humanize(option),
    }));
    for (const optionData of options) {
      const option = document.createElement("option");
      option.value = optionData.value;
      option.textContent = optionData.label;
      input.append(option);
    }
  } else {
    input = document.createElement("input");
    input.type =
      definitionField.type === "list" ? "text" : definitionField.type;
  }

  input.name = definitionField.name;
  input.required = definitionField.required;
  input.value = Array.isArray(value) ? value.join(", ") : value || "";
  if (definitionField.type === "list") {
    input.placeholder = "Comma-separated IDs";
  }
  label.append(caption, input);
  return label;
}

function createFilterRow(kind, filters, onFilter) {
  const options =
    kind === "canon"
      ? [
          ["type", ["all", "fact", "rule", "lore", "object", "faction", "relationship", "other"]],
          ["importance", ["all", "essential", "important", "optional"]],
        ]
      : null;
  if (!options) return null;

  const row = document.createElement("div");
  row.className = "filter-row";
  for (const [name, values] of options) {
    const select = document.createElement("select");
    select.setAttribute("aria-label", `Filter by ${name}`);
    for (const optionValue of values) {
      const option = document.createElement("option");
      option.value = optionValue;
      option.textContent = humanize(optionValue);
      select.append(option);
    }
    select.value = filters[name] || "all";
    select.addEventListener("change", () => onFilter(name, select.value));
    row.append(select);
  }
  return row;
}

function filterItems(kind, items, filters) {
  return items
    .filter((item) => {
      if (kind === "canon") {
        return (
          (!filters.type || filters.type === "all" || item.type === filters.type) &&
          (!filters.importance ||
            filters.importance === "all" ||
            item.importance === filters.importance)
        );
      }
      return true;
    })
    .sort((left, right) =>
      getEntityTitle(kind, left).localeCompare(getEntityTitle(kind, right)),
    );
}

function itemMeta(kind, item) {
  if (kind === "canon") return `${humanize(item.type)} · ${humanize(item.importance)}`;
  if (kind === "characters") return item.role || humanize(item.visibility);
  if (kind === "locations") return item.mood || "Location";
  if (kind === "personas") return item.description ? item.description.slice(0, 40) : "Persona";
  return "";
}

function textElement(tag, text) {
  const element = document.createElement(tag);
  element.textContent = text;
  return element;
}

function humanize(value) {
  return String(value).replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function field(name, label, type, required = false, options = []) {
  return { name, label, type, required, options };
}
