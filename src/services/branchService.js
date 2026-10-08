import { createBranch, createMessage } from "../models/storyProject.js";
import { nowIso } from "../utils/id.js";

export function addMessage(branch, messageInput) {
  const message = createMessage(messageInput);
  branch.messages.push(message);
  branch.updated_at = nowIso();
  return message;
}

export function editMessage(branch, messageId, updates) {
  const message = branch.messages.find((item) => item.message_id === messageId);
  if (!message) {
    throw new Error("Message not found.");
  }
  if (updates.content !== undefined) {
    message.content = String(updates.content);
    if (Array.isArray(message.metadata?.versions)) {
      const versions = getMessageVersions(message);
      versions[getActiveVersionIndex(message)] = message.content;
      message.metadata = { ...message.metadata, versions };
    }
  }
  if (updates.speaker_name !== undefined) {
    message.speaker_name = String(updates.speaker_name);
  }
  if (updates.role !== undefined) {
    message.role = updates.role;
  }
  message.metadata = { ...message.metadata, edited_at: nowIso() };
  branch.updated_at = nowIso();
  return message;
}

export function deleteMessage(branch, messageId) {
  const index = branch.messages.findIndex(
    (message) => message.message_id === messageId,
  );
  if (index < 0) {
    return false;
  }
  branch.messages.splice(index, 1);
  branch.updated_at = nowIso();
  return true;
}

export function forkBranch(project, sourceBranchId, sourceMessageId, title) {
  const source = project.branches.find(
    (branch) => branch.branch_id === sourceBranchId,
  );
  if (!source) {
    throw new Error("Source branch not found.");
  }
  const messageIndex = source.messages.findIndex(
    (message) => message.message_id === sourceMessageId,
  );
  if (messageIndex < 0) {
    throw new Error("Fork source message not found.");
  }

  // The summary describes the first summary_message_count messages. Forking
  // before that point would hand the new branch a memory of events it never
  // reached, so it starts without one and auto-summarize rebuilds it.
  const keptCount = messageIndex + 1;
  const summaryFits = (source.summary_message_count || 0) <= keptCount;

  const fork = createBranch({
    parent_branch_id: source.branch_id,
    title: title || `Fork of ${source.title}`,
    messages: source.messages.slice(0, keptCount),
    summary: summaryFits ? source.summary : "",
    author_note: source.author_note,
    summary_message_count: summaryFits ? source.summary_message_count : 0,
    tags: source.tags,
    fork_source_message_id: sourceMessageId,
  });
  project.branches.push(fork);
  project.active_branch_id = fork.branch_id;
  project.updated_at = nowIso();
  return fork;
}

// Illustrations live in IndexedDB under image:<key>. Forked branches copy
// messages with their ids, so keying pixels by message id let one branch's
// delete or re-illustrate clobber another's; new images get their own id.
// Older images were stored under the message id and still resolve.
export function imageKeyFor(message) {
  return message.metadata?.image_id || message.message_id;
}

export function isImageReferenced(projects, key) {
  return projects.some((project) =>
    project.branches.some((branch) =>
      branch.messages.some(
        (message) =>
          message.metadata?.has_image && imageKeyFor(message) === key,
      ),
    ),
  );
}

// Regeneration "swipes": every take of a message is kept in
// metadata.versions with metadata.version_index marking the active one;
// message.content always mirrors the active version.
export function getMessageVersions(message) {
  const stored = message.metadata?.versions;
  return Array.isArray(stored) && stored.length
    ? [...stored]
    : [message.content];
}

export function getActiveVersionIndex(message) {
  const versions = getMessageVersions(message);
  const index = Number(message.metadata?.version_index);
  return Number.isInteger(index) && index >= 0 && index < versions.length
    ? index
    : versions.length - 1;
}

export function addMessageVersion(message, content) {
  const versions = [...getMessageVersions(message), content];
  message.metadata = {
    ...message.metadata,
    versions,
    version_index: versions.length - 1,
  };
  message.content = content;
  return message;
}

/** Extend a message in place (Continue), keeping its active take in step. */
export function appendToMessage(message, text) {
  const before = message.content.trimEnd();
  const addition = text.trimStart();
  // A reply cut off mid-sentence picks up on the same line; one that ended
  // cleanly carries on in a new paragraph.
  const joiner = !before
    ? ""
    : /[.!?…"”*)\]~—-]$/.test(before)
      ? "\n\n"
      : " ";
  message.content = `${before}${joiner}${addition}`;
  if (Array.isArray(message.metadata?.versions)) {
    const versions = getMessageVersions(message);
    versions[getActiveVersionIndex(message)] = message.content;
    message.metadata = { ...message.metadata, versions };
  }
  return message;
}

export function setActiveMessageVersion(message, index) {
  const versions = getMessageVersions(message);
  if (!Number.isInteger(index) || index < 0 || index >= versions.length) {
    return false;
  }
  message.metadata = { ...message.metadata, versions, version_index: index };
  message.content = versions[index];
  return true;
}

export function compareBranches(left, right) {
  const maxShared = Math.min(left.messages.length, right.messages.length);
  let sharedCount = 0;
  while (
    sharedCount < maxShared &&
    left.messages[sharedCount].message_id === right.messages[sharedCount].message_id
  ) {
    sharedCount += 1;
  }

  return {
    shared_prefix_count: sharedCount,
    shared_messages: left.messages.slice(0, sharedCount),
    left_divergent_messages: left.messages.slice(sharedCount),
    right_divergent_messages: right.messages.slice(sharedCount),
  };
}

export function buildBranchTree(branches) {
  const nodes = new Map(
    branches.map((branch) => [
      branch.branch_id,
      { branch, children: [] },
    ]),
  );
  const roots = [];
  for (const node of nodes.values()) {
    const parent = nodes.get(node.branch.parent_branch_id);
    // Corrupt imports can contain self-parented or cyclic branches; treating
    // cycle members as roots keeps rendering finite.
    if (parent && parent !== node && !isInParentCycle(nodes, node)) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

function isInParentCycle(nodes, start) {
  const seen = new Set([start]);
  let current = nodes.get(start.branch.parent_branch_id);
  while (current) {
    if (current === start) return true;
    // A cycle deeper in the ancestry doesn't include start; its members
    // become roots themselves, so start can still attach to its parent.
    if (seen.has(current)) return false;
    seen.add(current);
    current = nodes.get(current.branch.parent_branch_id);
  }
  return false;
}
