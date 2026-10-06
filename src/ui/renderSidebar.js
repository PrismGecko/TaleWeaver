import { buildBranchTree, compareBranches } from "../services/branchService.js";
import { setText } from "../utils/sanitize.js";

export function renderProjectPicker(select, projects, activeProjectId) {
  select.replaceChildren();
  for (const project of projects) {
    const option = document.createElement("option");
    option.value = project.project_id;
    option.selected = project.project_id === activeProjectId;
    setText(option, project.title);
    select.append(option);
  }
}

export function renderBranchTree({
  container,
  branches,
  activeBranchId,
  onSelect,
}) {
  container.replaceChildren();
  const tree = buildBranchTree(branches);
  for (const root of tree) {
    container.append(renderNode(root, activeBranchId, onSelect, 0));
  }
}

export function renderBranchDiff({
  leftSelect,
  rightSelect,
  output,
  branches,
  leftId,
  rightId,
}) {
  for (const select of [leftSelect, rightSelect]) {
    select.replaceChildren();
    for (const branch of branches) {
      const option = document.createElement("option");
      option.value = branch.branch_id;
      option.textContent = branch.title;
      select.append(option);
    }
  }
  leftSelect.value = leftId || branches[0]?.branch_id || "";
  rightSelect.value = rightId || branches[1]?.branch_id || branches[0]?.branch_id || "";

  const left = branches.find((branch) => branch.branch_id === leftSelect.value);
  const right = branches.find((branch) => branch.branch_id === rightSelect.value);
  output.replaceChildren();
  if (!left || !right) return;

  const diff = compareBranches(left, right);
  const summary = document.createElement("p");
  summary.className = "diff-summary";
  summary.textContent = `${diff.shared_prefix_count} shared · ${diff.left_divergent_messages.length} left · ${diff.right_divergent_messages.length} right`;
  output.append(summary);
  if (diff.left_divergent_messages.length || diff.right_divergent_messages.length) {
    const details = document.createElement("div");
    details.className = "diff-details";
    details.append(
      diffColumn(left.title, diff.left_divergent_messages),
      diffColumn(right.title, diff.right_divergent_messages),
    );
    output.append(details);
  }
}

function renderNode(node, activeBranchId, onSelect, depth) {
  const wrapper = document.createElement("div");
  wrapper.className = "branch-node";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "branch-button";
  button.classList.toggle(
    "is-active",
    node.branch.branch_id === activeBranchId,
  );
  button.style.setProperty("--branch-depth", depth);
  button.addEventListener("click", () => onSelect(node.branch.branch_id));

  const title = document.createElement("span");
  title.textContent = node.branch.title;
  const count = document.createElement("span");
  count.className = "branch-count";
  count.textContent = String(node.branch.messages.length);
  button.append(title, count);
  wrapper.append(button);

  for (const child of node.children) {
    wrapper.append(renderNode(child, activeBranchId, onSelect, depth + 1));
  }
  return wrapper;
}

function diffColumn(title, messages) {
  const column = document.createElement("div");
  const heading = document.createElement("strong");
  heading.textContent = title;
  column.append(heading);
  if (!messages.length) {
    const empty = document.createElement("span");
    empty.textContent = "No divergent messages";
    column.append(empty);
    return column;
  }
  for (const message of messages.slice(0, 3)) {
    const excerpt = document.createElement("span");
    const text = message.content.replace(/\s+/g, " ").trim();
    excerpt.textContent = text.length > 70 ? `${text.slice(0, 67)}…` : text;
    column.append(excerpt);
  }
  return column;
}
