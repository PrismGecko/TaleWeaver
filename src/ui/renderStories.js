import { openMenu } from "./sheet.js";

/**
 * The story switcher. Replaces the `<select>` that used to fight the model
 * field for room in the top bar.
 *
 * @param {{
 *   projects: object[],
 *   activeProjectId: string,
 *   onSelect: (projectId: string) => void,
 *   onCreate: () => void,
 *   onRename: (projectId: string) => void,
 *   onExport: (projectId: string) => void,
 *   onDelete: (projectId: string) => void,
 * }} deps
 */
export function storiesScreen(deps) {
  return {
    title: "Your stories",
    action: { label: "New", variant: "is-primary", onClick: () => {} },
    render(body, sheet) {
      this.action.onClick = () => {
        sheet.close();
        queueMicrotask(deps.onCreate);
      };

      const list = document.createElement("div");
      list.className = "story-list";
      const sorted = [...deps.projects].sort((left, right) =>
        String(right.updated_at).localeCompare(String(left.updated_at)),
      );

      for (const project of sorted) {
        const row = document.createElement("div");
        row.className = "story-row";
        row.classList.toggle(
          "is-active",
          project.project_id === deps.activeProjectId,
        );

        const open = document.createElement("button");
        open.type = "button";
        open.className = "story-open";
        const title = document.createElement("strong");
        title.textContent = project.title;
        const meta = document.createElement("small");
        meta.textContent = storyMeta(project, project.project_id === deps.activeProjectId);
        open.append(title, meta);
        open.addEventListener("click", () => {
          sheet.close();
          queueMicrotask(() => deps.onSelect(project.project_id));
        });

        const more = document.createElement("button");
        more.type = "button";
        more.className = "branch-more";
        more.textContent = "⋯";
        more.setAttribute("aria-label", `Options for ${project.title}`);
        more.addEventListener("click", () => {
          openMenu({
            title: project.title,
            items: [
              {
                label: "Rename",
                icon: "✎",
                onSelect: () => deps.onRename(project.project_id),
              },
              {
                label: "Export as a file",
                icon: "↓",
                hint: "A JSON backup you can import anywhere",
                onSelect: () => deps.onExport(project.project_id),
              },
              {
                label: "Delete this story",
                icon: "🗑",
                danger: true,
                onSelect: () => deps.onDelete(project.project_id),
              },
            ],
          });
        });

        row.append(open, more);
        list.append(row);
      }
      body.append(list);
    },
  };
}

function storyMeta(project, isActive) {
  const messages = project.branches.reduce(
    (total, branch) => total + branch.messages.length,
    0,
  );
  const parts = [
    `${messages} message${messages === 1 ? "" : "s"}`,
    `${project.branches.length} branch${project.branches.length === 1 ? "" : "es"}`,
  ];
  if (isActive) parts.push("reading now");
  return parts.join(" · ");
}
