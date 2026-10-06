import {
  getActiveVersionIndex,
  getMessageVersions,
} from "../services/branchService.js";
import { renderRichText } from "../utils/richText.js";
import { setText } from "../utils/sanitize.js";

/**
 * The transcript. Every message used to carry six 10px text buttons; now it
 * carries one "⋯" with a proper touch target, and the actions you actually
 * reach for mid-scene — flip between takes, retry, illustrate — sit as a
 * footer on the newest reply where your thumb already is.
 */
export function renderChat({
  container,
  branch,
  pendingText = "",
  busy = false,
  editingMessageId = null,
  imageUrls = new Map(),
  onAction,
}) {
  const wasNearBottom =
    container.scrollHeight - container.scrollTop - container.clientHeight < 160;
  container.replaceChildren();

  if (!branch.messages.length && !pendingText) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    const heading = document.createElement("h2");
    heading.textContent = "The page is waiting";
    const text = document.createElement("p");
    text.textContent =
      "Write the first line and the story starts from there.";
    empty.append(heading, text);
    container.append(empty);
    return;
  }

  const lastAssistantId = [...branch.messages]
    .reverse()
    .find((message) => message.role === "assistant")?.message_id;

  for (const message of branch.messages) {
    const article = document.createElement("article");
    article.className = `message message-${message.role}`;
    if (message.metadata?.ooc) article.classList.add("message-ooc");
    article.dataset.messageId = message.message_id;

    const header = document.createElement("header");
    header.className = "message-header";
    const who = document.createElement("span");
    who.className = "message-role";
    setText(
      who,
      message.metadata?.ooc
        ? "Aside"
        : message.speaker_name || roleLabel(message.role),
    );
    const time = document.createElement("time");
    time.dateTime = message.created_at;
    setText(time, formatTime(message.created_at));
    header.append(who, time);

    const usage = message.metadata?.usage;
    if (usage) {
      const badge = document.createElement("span");
      badge.className = "usage-badge";
      badge.textContent = formatUsage(usage);
      header.append(badge);
    }

    const more = document.createElement("button");
    more.type = "button";
    more.className = "message-more";
    more.textContent = "⋯";
    more.dataset.messageAction = "menu";
    more.dataset.messageId = message.message_id;
    more.setAttribute("aria-label", "Message options");
    header.append(more);
    article.append(header);

    if (message.message_id === editingMessageId && !busy) {
      article.append(editArea(message, onAction));
    } else {
      const content = document.createElement("div");
      content.className = "message-content";
      renderRichText(content, message.content);
      article.append(content);
    }

    if (message.metadata?.has_image) {
      article.append(imageFigure(message, imageUrls.get(message.message_id)));
    }

    if (
      message.message_id === lastAssistantId &&
      message.message_id !== editingMessageId &&
      !busy
    ) {
      article.append(replyFooter(message, onAction));
    }

    container.append(article);
  }

  if (busy || pendingText) {
    const pending = document.createElement("article");
    pending.className = "message message-assistant message-pending";
    const label = document.createElement("span");
    label.className = "message-role";
    label.textContent = "Narrator";
    const content = document.createElement("div");
    content.className = "message-content";
    if (pendingText) {
      renderRichText(content, pendingText);
    } else {
      content.append(thinkingDots());
    }
    pending.append(label, content);
    container.append(pending);
  }

  container.onclick = (event) => {
    const button = event.target.closest("[data-message-action]");
    if (!button) return;
    onAction(
      button.dataset.messageAction,
      button.dataset.messageId,
      button.dataset.messagePayload,
    );
  };

  if (wasNearBottom || busy) {
    container.scrollTop = container.scrollHeight;
  }
}

/** The always-visible actions on the newest reply. */
function replyFooter(message, onAction) {
  const footer = document.createElement("div");
  footer.className = "reply-footer";

  const versions = getMessageVersions(message);
  if (versions.length > 1) {
    const index = getActiveVersionIndex(message);
    const previous = footerButton("‹", "Previous take");
    previous.disabled = index === 0;
    previous.addEventListener("click", () =>
      onAction("swipe", message.message_id, -1),
    );
    const counter = document.createElement("span");
    counter.className = "swipe-counter";
    counter.textContent = `${index + 1}/${versions.length}`;
    const next = footerButton("›", "Next take");
    next.disabled = index === versions.length - 1;
    next.addEventListener("click", () =>
      onAction("swipe", message.message_id, 1),
    );
    footer.append(previous, counter, next);
  }

  const retry = footerButton("↻ Retry", "Write this reply again");
  retry.classList.add("has-label");
  retry.addEventListener("click", () =>
    onAction("regenerate", message.message_id),
  );

  const illustrate = footerButton("✦ Illustrate", "Turn this moment into a picture");
  illustrate.classList.add("has-label", "is-accent");
  illustrate.addEventListener("click", () =>
    onAction("illustrate", message.message_id),
  );

  footer.append(retry, illustrate);
  return footer;
}

function footerButton(label, title) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "reply-action";
  button.textContent = label;
  button.title = title;
  return button;
}

function thinkingDots() {
  const wrapper = document.createElement("span");
  wrapper.className = "thinking";
  for (let index = 0; index < 3; index += 1) {
    wrapper.append(document.createElement("i"));
  }
  return wrapper;
}

function imageFigure(message, dataUrl) {
  const figure = document.createElement("figure");
  figure.className = "message-image";
  if (dataUrl) {
    const img = document.createElement("img");
    img.src = dataUrl;
    img.alt = message.metadata?.image_prompt || "Generated scene image";
    img.loading = "lazy";
    figure.append(img);
  } else {
    const placeholder = document.createElement("div");
    placeholder.className = "message-image-loading";
    placeholder.textContent = "Loading image…";
    figure.append(placeholder);
  }
  return figure;
}

function editArea(message, onAction) {
  const wrapper = document.createElement("div");
  wrapper.className = "message-edit";
  const textarea = document.createElement("textarea");
  textarea.value = message.content;
  textarea.rows = Math.min(
    16,
    Math.max(4, message.content.split("\n").length + 1),
  );
  const actions = document.createElement("div");
  actions.className = "message-edit-actions";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "ghost-button";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () =>
    onAction("edit-cancel", message.message_id),
  );
  const save = document.createElement("button");
  save.type = "button";
  save.className = "primary-button";
  save.textContent = "Save";
  save.addEventListener("click", () =>
    onAction("edit-save", message.message_id, textarea.value),
  );
  textarea.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      onAction("edit-save", message.message_id, textarea.value);
    }
    if (event.key === "Escape") {
      onAction("edit-cancel", message.message_id);
    }
  });
  actions.append(cancel, save);
  wrapper.append(textarea, actions);
  queueMicrotask(() => textarea.focus());
  return wrapper;
}

function roleLabel(role) {
  const labels = {
    user: "You",
    assistant: "Narrator",
    system: "Note",
    narrator: "Narrator",
    character: "Character",
  };
  return labels[role] || role;
}

function formatUsage(usage) {
  const parts = [];
  if (Number.isFinite(usage.completion_tokens)) {
    parts.push(`${usage.completion_tokens} tok`);
  }
  if (Number.isFinite(usage.cost) && usage.cost > 0) {
    parts.push(`$${usage.cost.toFixed(usage.cost < 0.01 ? 4 : 2)}`);
  }
  return parts.join(" · ");
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}
