import { nowIso } from "../utils/id.js";
import { chipField, textareaField } from "./formFields.js";

/**
 * "Who is in this scene, and where are we." This used to be buried in a
 * right-hand tab called Context inspector next to a wall of raw JSON; it is
 * the one part of that panel worth touching mid-scene, so it gets its own
 * screen one tap from the transcript.
 *
 * @param {{project: object, branch: object, onChange: () => void}} deps
 */
export function sceneScreen({ project, branch, onChange }) {
  return {
    title: "The scene",
    render(body) {
      const form = document.createElement("div");
      form.className = "sheet-form";

      form.append(
        chipField({
          label: "Where are we?",
          name: "location",
          noneLabel: "Nowhere in particular",
          options: project.locations.map((location) => ({
            id: location.location_id,
            label: location.name,
          })),
          selected: project.settings.selected_location_id
            ? [project.settings.selected_location_id]
            : [],
          emptyText: "No locations yet — add one in the World.",
          onChange: (ids) => {
            project.settings.selected_location_id = ids[0] || null;
            onChange();
          },
        }),
        chipField({
          label: "Who is here?",
          name: "characters",
          multiple: true,
          options: project.characters.map((character) => ({
            id: character.character_id,
            label: character.name,
          })),
          selected: project.settings.selected_character_ids,
          emptyText: "No characters yet — add one in the World.",
          hint: "Leave everyone off to keep the whole cast available to the AI. Choosing a few keeps its attention on them.",
          onChange: (ids) => {
            project.settings.selected_character_ids = ids;
            onChange();
          },
        }),
      );

      const note = textareaField({
        label: "Author's note",
        name: "author_note",
        value: branch.author_note,
        rows: 3,
        placeholder: "Keep it tense. Mara is hiding something and lies badly.",
        hint: "Direction for the scene right now. It sits just before your latest message, so it outweighs the story instructions — keep it short. This branch only.",
      });
      // Saved as you type: closing the sheet doesn't reliably blur the field,
      // so waiting for a change event could drop the last edit.
      let saveTimer;
      note.querySelector("textarea").addEventListener("input", (event) => {
        branch.author_note = event.target.value.trim();
        branch.updated_at = nowIso();
        clearTimeout(saveTimer);
        saveTimer = setTimeout(onChange, 400);
      });
      form.append(note);

      body.append(form);
    },
  };
}

/** One-line summary of the scene, shown on the chip in the transcript header. */
export function describeScene(project) {
  const location = project.locations.find(
    (item) => item.location_id === project.settings.selected_location_id,
  );
  const names = project.settings.selected_character_ids
    .map(
      (id) =>
        project.characters.find((item) => item.character_id === id)?.name,
    )
    .filter(Boolean);

  const cast =
    names.length === 0
      ? ""
      : names.length <= 2
        ? names.join(" & ")
        : `${names[0]} +${names.length - 1}`;

  if (location && cast) return `${location.name} · ${cast}`;
  if (location) return location.name;
  if (cast) return cast;
  return "Set the scene";
}
