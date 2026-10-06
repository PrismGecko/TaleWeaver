import { MODEL_PRESETS } from "../models/storyProject.js";
import { IMAGE_MODEL_PRESETS } from "../services/imageService.js";
import {
  disclosure,
  readFields,
  section,
  selectField,
  switchField,
  textField,
  textareaField,
} from "./formFields.js";
import { youScreen } from "./renderWorld.js";

/**
 * Settings, ordered by how often anyone touches it: how the story should read,
 * then the model, then images, then the key, and everything else folded away
 * under a disclosure. The old dialog put fifteen controls on one flat list.
 *
 * @param {{
 *   project: object,
 *   apiKey: string,
 *   rememberApiKey: boolean,
 *   falApiKey: string,
 *   usage: string,
 *   storageNote: string,
 *   onSave: (values: object) => void,
 *   onChange: (message?: string) => void,
 *   onExport: () => void,
 *   onImport: () => void,
 *   onClear: () => void,
 *   onInspect: () => object,
 *   onSummarize: () => void,
 * }} deps
 */
export function settingsScreen(deps) {
  const { project } = deps;

  return {
    title: "Settings",
    action: { label: "Save", variant: "is-primary", onClick: () => {} },
    render(body, sheet) {
      const form = document.createElement("div");
      form.className = "sheet-form";

      form.append(
        section("This story", (block) => {
          block.append(
            textareaField({
              label: "How the story should read",
              name: "user_instructions",
              rows: 4,
              value: project.settings.user_instructions,
              placeholder:
                "Second person, present tense. Keep replies to two paragraphs. Let scenes breathe.",
              hint: "Tone, point of view, pacing, boundaries — anything you'd otherwise repeat every message.",
            }),
          );
          const you = document.createElement("button");
          you.type = "button";
          you.className = "link-row";
          const label = document.createElement("span");
          label.textContent = "Who you play";
          const value = document.createElement("strong");
          value.textContent = project.settings.you.name || "Not set";
          you.append(label, value);
          you.addEventListener("click", () =>
            sheet.push(youScreen({ project, onChange: deps.onChange })),
          );
          block.append(you);
        }),

        section("The AI", (block) => {
          block.append(
            datalistField({
              label: "Model",
              name: "model",
              value: project.settings.model,
              options: MODEL_PRESETS,
              listId: "model-presets",
              hint: "Any OpenRouter model ID.",
            }),
            textField({
              label: "Reply length limit",
              name: "max_tokens",
              type: "number",
              inputMode: "numeric",
              min: 64,
              max: 32000,
              value: project.settings.max_tokens,
              hint: "In tokens. Roughly 750 words per 1000.",
            }),
            textField({
              label: "Creativity",
              name: "temperature",
              type: "number",
              inputMode: "decimal",
              min: 0,
              max: 2,
              step: 0.1,
              value: project.settings.temperature,
              hint: "0 is repetitive and safe, 1 is lively, above 1.3 gets strange.",
            }),
          );
        }),

        section("Images", (block) => {
          const provider = selectField({
            label: "Where images come from",
            name: "image_provider",
            value: project.settings.image_provider,
            options: [
              ["openrouter", "OpenRouter — Gemini, FLUX, GPT-image"],
              ["fal", "fal.ai — Stable Diffusion, community models"],
            ],
            onChange: (value) => syncProvider(value),
          });
          const openrouterModel = datalistField({
            label: "Image model",
            name: "image_model",
            value: project.settings.image_model,
            options: IMAGE_MODEL_PRESETS,
            listId: "image-model-presets",
          });
          const falModel = textField({
            label: "fal.ai checkpoint",
            name: "fal_image_model",
            value: project.settings.fal_image_model,
            placeholder: "stabilityai/stable-diffusion-xl-base-1.0",
            hint: "A Hugging Face ID or a CivitAI download URL.",
          });
          const falKey = textField({
            label: "fal.ai API key",
            name: "fal_api_key",
            type: "password",
            autocomplete: "off",
            value: deps.falApiKey,
            placeholder: "key-id:key-secret",
          });

          function syncProvider(value) {
            openrouterModel.classList.toggle("hidden", value !== "openrouter");
            falModel.classList.toggle("hidden", value !== "fal");
            falKey.classList.toggle("hidden", value !== "fal");
          }
          syncProvider(project.settings.image_provider);
          block.append(provider, openrouterModel, falModel, falKey);
        }),

        section("Your OpenRouter key", (block) => {
          block.append(
            textField({
              label: "API key",
              name: "api_key",
              type: "password",
              autocomplete: "off",
              value: deps.apiKey,
              placeholder: "sk-or-v1-…",
            }),
            switchField({
              label: "Remember it on this device",
              name: "remember_api_key",
              checked: deps.rememberApiKey,
              hint: "Stored in this browser only, and never included in exports.",
            }),
          );
        }),
      );

      form.append(
        disclosure("Memory & advanced", (inner) => {
          inner.append(
            textField({
              label: "Messages kept in full",
              name: "recent_message_count",
              type: "number",
              inputMode: "numeric",
              min: 1,
              max: 200,
              value: project.settings.recent_message_count,
              hint: "Older ones are folded into a running summary instead.",
            }),
            switchField({
              label: "Summarize older messages automatically",
              name: "auto_summarize",
              checked: project.settings.auto_summarize,
            }),
            switchField({
              label: "Track how characters are feeling",
              name: "auto_track_emotions",
              checked: project.settings.auto_track_emotions,
              hint: "Updates each character's mood after replies.",
            }),
            switchField({
              label: "Let the AI see secrets and hidden characters",
              name: "include_hidden_knowledge",
              checked: project.settings.include_hidden_knowledge,
            }),
            actionRow("Summarize the story so far now", () => {
              sheet.close();
              queueMicrotask(deps.onSummarize);
            }),
            actionRow("Inspect exactly what the AI is sent", () =>
              sheet.push(inspectScreen(deps.onInspect)),
            ),
          );
        }),
      );

      form.append(
        section("Your data", (block) => {
          const usage = document.createElement("p");
          usage.className = "form-note";
          usage.textContent = deps.usage;
          block.append(usage);
          block.append(
            actionRow("Export this story", deps.onExport),
            actionRow("Import a story file", () => {
              sheet.close();
              queueMicrotask(deps.onImport);
            }),
          );
          const clear = document.createElement("button");
          clear.type = "button";
          clear.className = "danger-button";
          clear.textContent = "Erase everything on this device";
          clear.addEventListener("click", () => {
            sheet.close();
            queueMicrotask(deps.onClear);
          });
          block.append(clear);
          if (deps.storageNote) {
            const note = document.createElement("p");
            note.className = "form-note is-warning";
            note.textContent = deps.storageNote;
            block.append(note);
          }
        }),
      );

      body.append(form);

      this.action.onClick = () => {
        deps.onSave(readFields(form));
        sheet.close();
      };
    },
  };
}

function inspectScreen(build) {
  return {
    title: "What the AI sees",
    render(body) {
      const assembled = build();
      const summary = document.createElement("p");
      summary.className = "form-note";
      const diagnostics = assembled.diagnostics;
      summary.textContent = `About ${diagnostics.estimated_tokens.toLocaleString()} tokens · ${diagnostics.included_canon} world entries · ${diagnostics.included_characters} characters.`;
      const output = document.createElement("pre");
      output.className = "context-output";
      output.textContent = JSON.stringify(assembled.messages, null, 2);
      body.append(summary, output);
    },
  };
}

function actionRow(label, onSelect) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "link-row";
  const text = document.createElement("span");
  text.textContent = label;
  const chevron = document.createElement("strong");
  chevron.textContent = "›";
  button.append(text, chevron);
  button.addEventListener("click", onSelect);
  return button;
}

function datalistField({ label, name, value, options, listId, hint }) {
  const field = textField({ label, name, value, hint });
  const input = field.querySelector("input");
  input.setAttribute("list", listId);
  input.autocomplete = "off";
  const list = document.createElement("datalist");
  list.id = listId;
  for (const option of options) {
    const item = document.createElement("option");
    item.value = option;
    list.append(item);
  }
  field.append(list);
  return field;
}
