/**
 * Form controls shared by the world editor, the scene picker and settings.
 *
 * The important one is `chipField`: every relationship in this app used to be
 * a text input where you typed comma-separated internal IDs. These are now
 * tappable name chips backed by a hidden input, so the surrounding form-reading
 * code stays uniform.
 */

/** @param {{label: string, name: string, value?: string, placeholder?: string, hint?: string, type?: string, required?: boolean, inputMode?: string}} config */
export function textField(config) {
  const input = document.createElement("input");
  input.type = config.type || "text";
  input.name = config.name;
  input.value = config.value ?? "";
  if (config.placeholder) input.placeholder = config.placeholder;
  if (config.required) input.required = true;
  if (config.inputMode) input.inputMode = config.inputMode;
  if (config.min !== undefined) input.min = String(config.min);
  if (config.max !== undefined) input.max = String(config.max);
  if (config.step !== undefined) input.step = String(config.step);
  if (config.autocomplete) input.autocomplete = config.autocomplete;
  return wrapField(config, input);
}

/** @param {{label: string, name: string, value?: string, placeholder?: string, hint?: string, rows?: number}} config */
export function textareaField(config) {
  const input = document.createElement("textarea");
  input.name = config.name;
  input.rows = config.rows || 3;
  input.value = config.value ?? "";
  if (config.placeholder) input.placeholder = config.placeholder;
  return wrapField(config, input);
}

/** @param {{label: string, name: string, value?: string, hint?: string, options: Array<[string, string]>}} config */
export function selectField(config) {
  const input = document.createElement("select");
  input.name = config.name;
  for (const [value, label] of config.options) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    input.append(option);
  }
  input.value = config.value ?? config.options[0]?.[0] ?? "";
  if (config.onChange) {
    input.addEventListener("change", () => config.onChange(input.value));
  }
  return wrapField(config, input);
}

/** A labelled on/off row. @param {{label: string, name: string, checked?: boolean, hint?: string}} config */
export function switchField(config) {
  const row = document.createElement("label");
  row.className = "switch-field";
  const text = document.createElement("span");
  text.className = "switch-text";
  const label = document.createElement("span");
  label.textContent = config.label;
  text.append(label);
  if (config.hint) {
    const hint = document.createElement("small");
    hint.textContent = config.hint;
    text.append(hint);
  }
  const input = document.createElement("input");
  input.type = "checkbox";
  input.className = "switch-input";
  input.name = config.name;
  input.checked = Boolean(config.checked);
  if (config.onChange) {
    input.addEventListener("change", () => config.onChange(input.checked));
  }
  const track = document.createElement("span");
  track.className = "switch-track";
  row.append(text, input, track);
  return row;
}

/**
 * Tap-to-toggle chips backed by a hidden input holding comma-separated IDs.
 * @param {{
 *   label: string,
 *   name: string,
 *   options: Array<{id: string, label: string}>,
 *   selected?: string[],
 *   multiple?: boolean,
 *   hint?: string,
 *   emptyText?: string,
 *   noneLabel?: string,
 *   onChange?: (selected: string[]) => void,
 * }} config
 */
export function chipField(config) {
  const wrapper = document.createElement("div");
  wrapper.className = "field";
  const caption = document.createElement("span");
  caption.className = "field-label";
  caption.textContent = config.label;
  wrapper.append(caption);

  const hidden = document.createElement("input");
  hidden.type = "hidden";
  hidden.name = config.name;
  const selected = new Set(config.selected || []);
  hidden.value = [...selected].join(",");
  wrapper.append(hidden);

  if (!config.options.length) {
    const empty = document.createElement("p");
    empty.className = "field-empty";
    empty.textContent = config.emptyText || "Nothing to choose from yet.";
    wrapper.append(empty);
    return wrapper;
  }

  const row = document.createElement("div");
  row.className = "chip-row";

  const commit = () => {
    hidden.value = [...selected].join(",");
    config.onChange?.([...selected]);
  };

  // Single-select pickers get an explicit "none" chip; without one there is no
  // way back to an unset value once something has been chosen.
  if (!config.multiple) {
    row.append(
      buildChip(config.noneLabel || "None", selected.size === 0, () => {
        selected.clear();
        commit();
        redraw();
      }),
    );
  }

  for (const option of config.options) {
    row.append(
      buildChip(option.label, selected.has(option.id), () => {
        if (config.multiple) {
          if (selected.has(option.id)) selected.delete(option.id);
          else selected.add(option.id);
        } else {
          selected.clear();
          selected.add(option.id);
        }
        commit();
        redraw();
      }),
    );
  }

  function redraw() {
    const chips = [...row.children];
    let index = 0;
    if (!config.multiple) {
      chips[index].classList.toggle("is-on", selected.size === 0);
      index += 1;
    }
    for (const option of config.options) {
      chips[index].classList.toggle("is-on", selected.has(option.id));
      index += 1;
    }
  }

  wrapper.append(row);
  if (config.hint) {
    const hint = document.createElement("small");
    hint.className = "field-hint";
    hint.textContent = config.hint;
    wrapper.append(hint);
  }
  return wrapper;
}

function buildChip(label, on, onSelect) {
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = `pick-chip${on ? " is-on" : ""}`;
  chip.textContent = label;
  chip.addEventListener("click", onSelect);
  return chip;
}

/** A collapsible group for the fields most sessions never touch. */
export function disclosure(label, build) {
  const details = document.createElement("details");
  details.className = "disclosure";
  const summary = document.createElement("summary");
  summary.textContent = label;
  details.append(summary);
  const inner = document.createElement("div");
  inner.className = "disclosure-body";
  build(inner);
  details.append(inner);
  return details;
}

/** A titled run of fields, used to break long sheets into scannable blocks. */
export function section(title, build) {
  const wrapper = document.createElement("section");
  wrapper.className = "form-section";
  if (title) {
    const heading = document.createElement("h3");
    heading.className = "form-section-title";
    heading.textContent = title;
    wrapper.append(heading);
  }
  build(wrapper);
  return wrapper;
}

function wrapField(config, input) {
  const label = document.createElement("label");
  label.className = "field";
  const caption = document.createElement("span");
  caption.className = "field-label";
  caption.textContent = config.label;
  label.append(caption, input);
  if (config.hint) {
    const hint = document.createElement("small");
    hint.className = "field-hint";
    hint.textContent = config.hint;
    label.append(hint);
  }
  return label;
}

/** Read `name -> string` pairs out of any container holding form controls. */
export function readFields(container) {
  const values = {};
  for (const input of container.querySelectorAll("[name]")) {
    values[input.name] =
      input.type === "checkbox" ? input.checked : input.value;
  }
  return values;
}

/** Split a chipField's hidden value back into an ID array. */
export function readIds(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
