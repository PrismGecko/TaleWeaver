import test from "node:test";
import assert from "node:assert/strict";

import {
  createBranch,
  createMessage,
  createStoryProject,
  normalizeProject,
} from "../src/models/storyProject.js";
import {
  addMessageVersion,
  appendToMessage,
  compareBranches,
  editMessage,
  forkBranch,
  getActiveVersionIndex,
  imageKeyFor,
  isImageReferenced,
  setActiveMessageVersion,
} from "../src/services/branchService.js";
import {
  assembleContext,
  cutAtSpeaker,
  stripNarratorLabel,
  stripSpeakerLabel,
  userStopSequences,
} from "../src/services/contextAssembler.js";

test("normalizeProject repairs missing collections and active branch", () => {
  const project = normalizeProject({
    title: "Imported",
    branches: [],
    settings: { temperature: 99, recent_message_count: 0 },
  });

  assert.equal(project.title, "Imported");
  assert.equal(project.branches.length, 1);
  assert.equal(project.active_branch_id, project.branches[0].branch_id);
  assert.equal(project.settings.temperature, 2);
  assert.equal(project.settings.recent_message_count, 1);
  assert.deepEqual(project.canon_entries, []);
});

test("legacy timeline events and story arcs migrate into canon entries", () => {
  const project = normalizeProject({
    title: "Legacy",
    timeline_events: [
      {
        event_id: "evt1",
        title: "The bridge fell",
        description: "The old bridge collapsed during the storm.",
        chronology_label: "Year 3",
        related_character_ids: ["c1"],
      },
    ],
    story_arcs: [
      {
        arc_id: "arc1",
        title: "Find the saboteur",
        status: "open",
        description: "Someone cut the bridge cables.",
        payoff_notes: "Reveal it was the ferryman.",
      },
      {
        arc_id: "arc2",
        title: "Old grudge",
        status: "resolved",
        description: "Settled last season.",
      },
    ],
    scene_cards: [{ scene_id: "s1", title: "Dropped scene" }],
  });

  assert.equal(project.timeline_events, undefined);
  assert.equal(project.story_arcs, undefined);
  assert.equal(project.scene_cards, undefined);
  assert.equal(project.canon_entries.length, 2);

  const event = project.canon_entries.find(
    (entry) => entry.metadata.migrated_from === "timeline_event",
  );
  assert.equal(event.title, "The bridge fell");
  assert.equal(event.type, "fact");
  assert.match(event.content, /Year 3: The old bridge collapsed/);
  assert.deepEqual(event.related_character_ids, ["c1"]);

  const arc = project.canon_entries.find(
    (entry) => entry.metadata.migrated_from === "story_arc",
  );
  assert.equal(arc.title, "Unresolved thread: Find the saboteur");
  assert.equal(arc.importance, "essential");
  assert.match(arc.content, /Payoff notes: Reveal it was the ferryman\./);
  assert.ok(
    !project.canon_entries.some((entry) => /Old grudge/.test(entry.title)),
    "resolved arcs are dropped",
  );
});

test("forkBranch copies messages through the source and records ancestry", () => {
  const messages = [
    createMessage({ content: "One" }),
    createMessage({ role: "assistant", content: "Two" }),
    createMessage({ content: "Three" }),
  ];
  const source = createBranch({ title: "Main", messages });
  const project = createStoryProject({
    active_branch_id: source.branch_id,
    branches: [source],
  });

  const fork = forkBranch(
    project,
    source.branch_id,
    messages[1].message_id,
    "Alternate",
  );

  assert.equal(fork.parent_branch_id, source.branch_id);
  assert.equal(fork.fork_source_message_id, messages[1].message_id);
  assert.equal(fork.messages.length, 2);
  assert.deepEqual(
    fork.messages.map((message) => message.message_id),
    messages.slice(0, 2).map((message) => message.message_id),
  );
  assert.equal(project.active_branch_id, fork.branch_id);
});

test("compareBranches identifies shared prefixes and divergence", () => {
  const shared = createMessage({ content: "Shared" });
  const left = createBranch({
    messages: [shared, createMessage({ content: "Left" })],
  });
  const right = createBranch({
    messages: [shared, createMessage({ content: "Right" })],
  });

  const diff = compareBranches(left, right);
  assert.equal(diff.shared_prefix_count, 1);
  assert.equal(diff.left_divergent_messages[0].content, "Left");
  assert.equal(diff.right_divergent_messages[0].content, "Right");
});

test("context assembly omits hidden characters and secrets by default", () => {
  const project = createStoryProject();
  project.characters = [
    {
      character_id: "visible",
      name: "Visible",
      role: "",
      description: "",
      personality: "",
      speech_style: "",
      goals: "",
      secrets: "Do not leak this",
      relationships: "",
      current_emotional_state: "",
      knowledge_ids: [],
      visibility: "public",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      character_id: "hidden",
      name: "Hidden Name",
      role: "",
      description: "",
      personality: "",
      speech_style: "",
      goals: "",
      secrets: "Hidden secret",
      relationships: "",
      current_emotional_state: "",
      knowledge_ids: [],
      visibility: "hidden_from_user",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];

  const result = assembleContext({
    storyProject: project,
    activeBranchId: project.active_branch_id,
    selectedCharacterIds: ["visible", "hidden"],
    includeHiddenKnowledge: false,
  });
  const system = result.messages[0].content;

  assert.match(system, /Visible/);
  assert.doesNotMatch(system, /Do not leak this/);
  assert.doesNotMatch(system, /Hidden Name/);
});

test("context assembly trims old messages to fit the character budget", () => {
  const project = createStoryProject();
  project.branches[0].messages = [
    createMessage({ content: `first ${"a".repeat(3000)}` }),
    createMessage({ role: "assistant", content: `middle ${"b".repeat(3000)}` }),
    createMessage({ content: `last ${"c".repeat(3000)}` }),
  ];

  const result = assembleContext({
    storyProject: project,
    activeBranchId: project.active_branch_id,
    characterBudget: 100, // clamps up to the 4000-character floor
  });

  assert.equal(result.messages.length, 2);
  assert.equal(result.messages[0].role, "system");
  assert.match(result.messages.at(-1).content, /^last /);
});

test("context assembly keeps every message under a generous budget", () => {
  const project = createStoryProject();
  project.branches[0].messages = [
    createMessage({ content: "one" }),
    createMessage({ role: "assistant", content: "two" }),
  ];

  const result = assembleContext({
    storyProject: project,
    activeBranchId: project.active_branch_id,
    characterBudget: 48000,
  });

  assert.equal(result.messages.length, 3);
});

test("context assembly maps narrative roles to OpenRouter roles", () => {
  const project = createStoryProject();
  project.branches[0].messages = [
    createMessage({
      role: "character",
      speaker_name: "Mara",
      content: "We should go.",
    }),
  ];

  const result = assembleContext({
    storyProject: project,
    activeBranchId: project.active_branch_id,
  });

  assert.deepEqual(result.messages.at(-1), {
    role: "user",
    content: "Mara: We should go.",
  });
});

test("assistant turns reach the model without a speaker label", () => {
  const project = createStoryProject();
  project.branches[0].messages = [
    createMessage({
      role: "assistant",
      speaker_name: "Narrator",
      content: "Narrator: Narrator: The lamps gutter.",
    }),
  ];

  const result = assembleContext({
    storyProject: project,
    activeBranchId: project.active_branch_id,
  });

  assert.deepEqual(result.messages.at(-1), {
    role: "assistant",
    content: "The lamps gutter.",
  });
});

test("stripNarratorLabel removes stacked leading labels only", () => {
  assert.equal(stripNarratorLabel("Narrator: Narrator: Rain."), "Rain.");
  assert.equal(stripNarratorLabel("**Narrator:** Rain."), "Rain.");
  assert.equal(stripNarratorLabel("assistant: Rain."), "Rain.");
  assert.equal(stripNarratorLabel("Mara: Rain."), "Mara: Rain.");
  assert.equal(
    stripNarratorLabel("The narrator: an unreliable one."),
    "The narrator: an unreliable one.",
  );
  assert.equal(stripNarratorLabel("Narrator:"), "Narrator:");
});

test("context assembly keeps a truncated newest message when it exceeds the budget", () => {
  const project = createStoryProject();
  project.branches[0].messages = [
    createMessage({ content: `huge ${"z".repeat(9000)}` }),
  ];

  const result = assembleContext({
    storyProject: project,
    activeBranchId: project.active_branch_id,
    characterBudget: 4000,
  });

  const last = result.messages.at(-1);
  assert.equal(result.messages.length, 2);
  assert.equal(last.role, "user");
  assert.match(last.content, /^huge /);
  assert.ok(last.content.length < 9000);
});

test("OOC messages reach the model bracketed but never trigger keywords", () => {
  const project = createStoryProject();
  project.canon_entries = normalizeProject({
    canon_entries: [
      {
        title: "Dragon pact",
        content: "The dragon owes the crown a debt.",
        keywords: ["dragon"],
      },
    ],
  }).canon_entries;
  project.branches[0].messages = [
    createMessage({ content: "The road was quiet." }),
    createMessage({
      content: "mention the dragon soon please",
      metadata: { ooc: true },
    }),
  ];

  const result = assembleContext({
    storyProject: project,
    activeBranchId: project.active_branch_id,
  });

  assert.doesNotMatch(result.messages[0].content, /Dragon pact/);
  assert.match(result.messages[0].content, /\[OOC: \.\.\.\]/);
  assert.deepEqual(result.messages.at(-1), {
    role: "user",
    content: "[OOC: mention the dragon soon please]",
  });
});

test("keyworded canon entries only appear when a keyword is in recent messages", () => {
  const project = createStoryProject();
  project.canon_entries = [
    normalizeProject({
      canon_entries: [
        {
          title: "Dragon pact",
          content: "The dragon owes the crown a debt.",
          keywords: ["dragon"],
        },
        {
          title: "Harvest law",
          content: "No reaping after dusk.",
          keywords: ["harvest"],
        },
        {
          title: "Always on",
          content: "Gravity works.",
        },
      ],
    }).canon_entries,
  ].flat();
  project.branches[0].messages = [
    createMessage({ content: "The DRAGON circled the tower." }),
  ];

  const result = assembleContext({
    storyProject: project,
    activeBranchId: project.active_branch_id,
  });
  const system = result.messages[0].content;

  assert.match(system, /Dragon pact/);
  assert.doesNotMatch(system, /Harvest law/);
  assert.match(system, /Always on/);
  assert.equal(result.diagnostics.included_canon, 2);
});

test("essential keyworded canon is always included", () => {
  const project = createStoryProject();
  project.canon_entries = normalizeProject({
    canon_entries: [
      {
        title: "Prophecy",
        content: "The third moon will crack.",
        importance: "essential",
        keywords: ["moon"],
      },
    ],
  }).canon_entries;
  project.branches[0].messages = [createMessage({ content: "Hello there." })];

  const result = assembleContext({
    storyProject: project,
    activeBranchId: project.active_branch_id,
  });

  assert.match(result.messages[0].content, /Prophecy/);
});

test("branch summary is injected as STORY SO FAR", () => {
  const project = createStoryProject();
  project.branches[0].summary = "Mara found the impossible map.";
  project.branches[0].messages = [createMessage({ content: "Onward." })];

  const result = assembleContext({
    storyProject: project,
    activeBranchId: project.active_branch_id,
  });

  assert.match(
    result.messages[0].content,
    /STORY SO FAR\nMara found the impossible map\./,
  );
});

test("message versions track alternates and flip content", () => {
  const message = createMessage({ role: "assistant", content: "Take one" });
  addMessageVersion(message, "Take two");

  assert.deepEqual(message.metadata.versions, ["Take one", "Take two"]);
  assert.equal(message.content, "Take two");
  assert.equal(getActiveVersionIndex(message), 1);

  assert.equal(setActiveMessageVersion(message, 0), true);
  assert.equal(message.content, "Take one");
  assert.equal(setActiveMessageVersion(message, 5), false);
  assert.equal(message.content, "Take one");
});

test("editing a versioned message updates the active version in place", () => {
  const branch = createBranch({
    messages: [{ role: "assistant", content: "Original" }],
  });
  const message = branch.messages[0];
  addMessageVersion(message, "Second");
  editMessage(branch, message.message_id, { content: "Second, edited" });

  assert.equal(message.content, "Second, edited");
  assert.deepEqual(message.metadata.versions, ["Original", "Second, edited"]);
  assert.equal(setActiveMessageVersion(message, 0), true);
  assert.equal(setActiveMessageVersion(message, 1), true);
  assert.equal(message.content, "Second, edited");
});

test("who the user plays is injected into the system prompt", () => {
  const project = createStoryProject();
  project.branches[0].messages = [createMessage({ content: "Set sail." })];

  const withYou = assembleContext({
    storyProject: project,
    activeBranchId: project.active_branch_id,
    you: {
      name: "Captain Iva",
      description: "A weathered airship captain with a code of honor.",
    },
  });
  const withoutYou = assembleContext({
    storyProject: project,
    activeBranchId: project.active_branch_id,
  });

  assert.match(withYou.messages[0].content, /USER PERSONA/);
  assert.match(withYou.messages[0].content, /Captain Iva/);
  assert.match(
    withYou.messages[0].content,
    /Never speak, act, or decide for Captain Iva/,
  );
  assert.doesNotMatch(withoutYou.messages[0].content, /USER PERSONA/);
});

test("a nameless player adds no persona section", () => {
  const project = createStoryProject();
  project.branches[0].messages = [createMessage({ content: "Set sail." })];

  const assembled = assembleContext({
    storyProject: project,
    activeBranchId: project.active_branch_id,
    you: { name: "   ", description: "Ignored without a name." },
  });

  assert.doesNotMatch(assembled.messages[0].content, /USER PERSONA/);
});

test("legacy personas migrate into settings.you and the cast", () => {
  const project = createStoryProject({
    settings: { active_persona_id: "p2" },
    personas: [
      { persona_id: "p1", name: "Understudy", description: "A spare." },
      { persona_id: "p2", name: "Captain Iva", description: "The one I play." },
    ],
  });

  assert.equal(project.settings.you.name, "Captain Iva");
  assert.equal(project.settings.you.description, "The one I play.");
  assert.equal(project.personas, undefined);
  // The persona the user was not playing survives as a character rather than
  // being discarded by the migration.
  assert.deepEqual(
    project.characters.map((character) => character.name),
    ["Understudy"],
  );
});

function branchWithSummary(messageCount, summarizedCount) {
  const project = createStoryProject();
  const branch = project.branches[0];
  branch.messages = Array.from({ length: messageCount }, (_, index) =>
    createMessage({ content: `line ${index}` }),
  );
  branch.summary = "Everything up to the duel.";
  branch.summary_message_count = summarizedCount;
  return { project, branch };
}

test("forking before the summarized point leaves the future out of memory", () => {
  const { project, branch } = branchWithSummary(40, 20);

  const fork = forkBranch(
    project,
    branch.branch_id,
    branch.messages[9].message_id,
    "Earlier",
  );

  assert.equal(fork.summary, "");
  assert.equal(fork.summary_message_count, 0);
});

test("forking after the summarized point keeps the summary and its coverage", () => {
  const { project, branch } = branchWithSummary(40, 20);

  const fork = forkBranch(
    project,
    branch.branch_id,
    branch.messages[29].message_id,
    "Later",
  );

  assert.equal(fork.summary, "Everything up to the duel.");
  assert.equal(fork.summary_message_count, 20);
});

test("a forked copy keeps an image alive after the original is deleted", () => {
  const project = createStoryProject();
  const branch = project.branches[0];
  branch.messages = [
    createMessage({
      role: "assistant",
      content: "The bridge burns.",
      metadata: { has_image: true, image_id: "img_1" },
    }),
  ];
  forkBranch(project, branch.branch_id, branch.messages[0].message_id, "Fork");
  const key = imageKeyFor(branch.messages[0]);
  branch.messages = [];

  assert.equal(key, "img_1");
  assert.equal(isImageReferenced([project], key), true);
  project.branches[1].messages = [];
  assert.equal(isImageReferenced([project], key), false);
});

test("images stored before image ids existed still resolve by message id", () => {
  const message = createMessage({ metadata: { has_image: true } });
  assert.equal(imageKeyFor(message), message.message_id);
});

test("the author's note sits just before the newest message", () => {
  const project = createStoryProject();
  const branch = project.branches[0];
  branch.author_note = "Keep it tense.";
  branch.messages = [
    createMessage({ role: "assistant", content: "The door creaks." }),
    createMessage({ role: "user", content: "I freeze." }),
  ];

  const { messages } = assembleContext({
    storyProject: project,
    activeBranchId: branch.branch_id,
  });

  assert.deepEqual(
    messages.slice(-3).map((message) => message.content),
    ["The door creaks.", "[Author's note: Keep it tense.]", "I freeze."],
  );
  assert.ok(!messages[0].content.includes("Keep it tense."));
});

test("example dialogue reaches the character sheet in context", () => {
  const project = createStoryProject({
    characters: [
      {
        name: "Mara",
        example_dialogue: '"You\'re late."\n*She taps the map.*',
      },
    ],
  });

  const { messages } = assembleContext({
    storyProject: project,
    activeBranchId: project.active_branch_id,
  });

  assert.match(
    messages[0].content,
    /Example dialogue:\n {4}"You're late\."\n {4}\*She taps the map\.\*/,
  );
});

test("replies are cut where the model starts writing the user's turn", () => {
  assert.deepEqual(userStopSequences("Corwin"), [
    "\nCorwin:",
    "\n**Corwin:**",
    "\n**Corwin**:",
  ]);
  assert.deepEqual(userStopSequences(""), []);
  assert.equal(
    cutAtSpeaker("Mara turns.\n\nCorwin: I nod.", "Corwin"),
    "Mara turns.",
  );
  assert.equal(
    cutAtSpeaker("Mara turns.\n**Corwin:** I nod.", "Corwin"),
    "Mara turns.",
  );
  assert.equal(
    cutAtSpeaker("Corwin: is what she calls you.", "Corwin"),
    "Corwin: is what she calls you.",
  );
  assert.equal(cutAtSpeaker("Mara turns.", ""), "Mara turns.");
});

test("stripSpeakerLabel drops the user's own name label from a draft", () => {
  assert.equal(stripSpeakerLabel("Corwin: I wait.", "Corwin"), "I wait.");
  assert.equal(stripSpeakerLabel("**Corwin:** I wait.", "corwin"), "I wait.");
  assert.equal(stripSpeakerLabel("I wait.", "Corwin"), "I wait.");
});

test("appendToMessage joins mid-sentence on the line, finished ones as a paragraph", () => {
  const cut = createMessage({ role: "assistant", content: "She reached for the" });
  appendToMessage(cut, " lantern.");
  assert.equal(cut.content, "She reached for the lantern.");

  const done = createMessage({ role: "assistant", content: "She left." });
  addMessageVersion(done, "She stayed.");
  appendToMessage(done, "Night fell.");
  assert.equal(done.content, "She stayed.\n\nNight fell.");
  assert.deepEqual(done.metadata.versions, ["She left.", "She stayed.\n\nNight fell."]);
});

test("forks inherit the branch's author's note", () => {
  const project = createStoryProject();
  const branch = project.branches[0];
  branch.author_note = "Slow burn.";
  branch.messages = [createMessage({ content: "one" })];

  const fork = forkBranch(project, branch.branch_id, branch.messages[0].message_id, "F");

  assert.equal(fork.author_note, "Slow burn.");
});
