import { buildBranchTree, compareBranches } from "../services/branchService.js";
import { openMenu, openSheet } from "./sheet.js";

/**
 * The branch picker. Forking is the reason this app exists, so it gets a
 * first-class screen instead of a tree crammed into a desktop sidebar: full
 * width rows, a tap to switch, and a per-branch menu for rename and compare.
 *
 * @param {{
 *   project: object,
 *   onSelect: (branchId: string) => void,
 *   onFork: () => void,
 *   onRename: (branchId: string) => void,
 * }} deps
 */
export function branchesScreen({ project, onSelect, onFork, onRename }) {
  return {
    title: "Branches",
    action: { label: "Fork", variant: "is-primary", onClick: () => {} },
    render(body, sheet) {
      this.action.onClick = () => {
        sheet.close();
        queueMicrotask(onFork);
      };

      const list = document.createElement("div");
      list.className = "branch-list";
      const walk = (nodes, depth) => {
        for (const node of nodes) {
          list.append(branchRow(node.branch, depth, sheet));
          walk(node.children, depth + 1);
        }
      };
      walk(buildBranchTree(project.branches), 0);
      body.append(list);

      const note = document.createElement("p");
      note.className = "form-note";
      note.textContent =
        "Forking copies the story up to a chosen message, then lets it run differently. Tap a message in the transcript and choose Fork from here to branch mid-scene.";
      body.append(note);
    },
  };

  function branchRow(branch, depth, sheet) {
    const row = document.createElement("div");
    row.className = "branch-row";
    row.classList.toggle("is-active", branch.branch_id === project.active_branch_id);
    row.style.setProperty("--depth", String(Math.min(depth, 4)));

    const open = document.createElement("button");
    open.type = "button";
    open.className = "branch-open";
    const title = document.createElement("strong");
    title.textContent = branch.title;
    const meta = document.createElement("small");
    meta.textContent = `${branch.messages.length} message${
      branch.messages.length === 1 ? "" : "s"
    }${branch.branch_id === project.active_branch_id ? " · reading now" : ""}`;
    open.append(title, meta);
    open.addEventListener("click", () => {
      sheet.close();
      queueMicrotask(() => onSelect(branch.branch_id));
    });

    const more = document.createElement("button");
    more.type = "button";
    more.className = "branch-more";
    more.textContent = "⋯";
    more.setAttribute("aria-label", `Options for ${branch.title}`);
    more.addEventListener("click", () => {
      openMenu({
        title: branch.title,
        items: [
          {
            label: "Rename",
            icon: "✎",
            onSelect: () => onRename(branch.branch_id),
          },
          {
            label: "Compare with the branch I'm reading",
            icon: "⇄",
            hint:
              branch.branch_id === project.active_branch_id
                ? "Pick a different branch to compare"
                : undefined,
            onSelect: () => {
              if (branch.branch_id === project.active_branch_id) return;
              openCompare(branch.branch_id);
            },
          },
        ],
      });
    });

    row.append(open, more);
    return row;
  }

  function openCompare(otherBranchId) {
    const left = project.branches.find(
      (branch) => branch.branch_id === project.active_branch_id,
    );
    const right = project.branches.find(
      (branch) => branch.branch_id === otherBranchId,
    );
    if (!left || !right) return;
    // Compare opens as its own sheet because the branch list was dismissed by
    // the menu that launched it.
    openSheet(compareScreen(left, right));
  }
}

function compareScreen(left, right) {
  return {
    title: "Compare",
    render(body) {
      const diff = compareBranches(left, right);
      const summary = document.createElement("p");
      summary.className = "compare-summary";
      summary.textContent = `${diff.shared_prefix_count} shared message${
        diff.shared_prefix_count === 1 ? "" : "s"
      }, then the two branches part ways.`;
      body.append(summary);

      const grid = document.createElement("div");
      grid.className = "compare-grid";
      grid.append(
        compareColumn(left.title, diff.left_divergent_messages),
        compareColumn(right.title, diff.right_divergent_messages),
      );
      body.append(grid);
    },
  };
}

function compareColumn(title, messages) {
  const column = document.createElement("section");
  column.className = "compare-column";
  const heading = document.createElement("h3");
  heading.textContent = title;
  column.append(heading);
  if (!messages.length) {
    const empty = document.createElement("p");
    empty.className = "empty-note";
    empty.textContent = "Nothing beyond the shared part.";
    column.append(empty);
    return column;
  }
  for (const message of messages) {
    const item = document.createElement("article");
    item.className = "compare-message";
    const who = document.createElement("small");
    who.textContent = message.speaker_name || message.role;
    const text = document.createElement("p");
    text.textContent = message.content;
    item.append(who, text);
    column.append(item);
  }
  return column;
}
