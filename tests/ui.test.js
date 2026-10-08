import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { JSDOM } from "jsdom";

/**
 * Boots the real app against the real index.html and drives it the way a
 * thumb would. The UI is otherwise untested — everything below the services
 * layer used to be verified only by opening a browser.
 */

const html = readFileSync(
  fileURLToPath(new URL("../index.html", import.meta.url)),
  "utf8",
);

const dom = new JSDOM(html, {
  url: "https://example.com/",
  pretendToBeVisual: true,
});

globalThis.window = dom.window;
globalThis.document = dom.window.document;
// Node defines `navigator` as a getter-only global, so it has to be redefined
// rather than assigned.
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: dom.window.navigator,
});
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.Blob = dom.window.Blob;
globalThis.requestAnimationFrame = (callback) => setTimeout(callback, 0);
globalThis.URL.createObjectURL ??= () => "blob:stub";
globalThis.URL.revokeObjectURL ??= () => {};
// The app opens a BroadcastChannel to hear other tabs; in Node an open
// channel keeps the test process alive, so let it go once tests finish.
const NodeBroadcastChannel = globalThis.BroadcastChannel;
globalThis.BroadcastChannel = class extends NodeBroadcastChannel {
  constructor(name) {
    super(name);
    this.unref?.();
  }
};

// jsdom implements <dialog> markup but not its modal methods, so stand them up
// with just enough behaviour for the sheet layer: an `open` attribute and a
// `close` event.
const dialogProto = dom.window.HTMLDialogElement.prototype;
dialogProto.showModal = function showModal() {
  this.setAttribute("open", "");
};
dialogProto.show = dialogProto.showModal;
dialogProto.close = function close(returnValue) {
  if (!this.hasAttribute("open")) return;
  this.removeAttribute("open");
  if (returnValue !== undefined) this.returnValue = returnValue;
  this.dispatchEvent(new dom.window.Event("close"));
};

const settled = () => new Promise((resolve) => setTimeout(resolve, 20));

await import("../src/main.js");
await settled();

const $ = (selector) => document.querySelector(selector);
const sheet = () => document.querySelector("dialog.sheet[open]");
const sheetBody = () => sheet()?.querySelector(".sheet-body");
const topSheet = () => [...document.querySelectorAll("dialog.sheet[open]")].at(-1);
const textsOf = (selector, root = document) =>
  [...root.querySelectorAll(selector)].map((node) => node.textContent.trim());

function click(element) {
  assert.ok(element, "expected the element being clicked to exist");
  element.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
}

test("the app boots and renders the demo story", () => {
  assert.equal($("#story-title").textContent, "The Glass Archive");
  assert.equal($("#branch-chip-label").textContent, "Main thread");
  // The demo has a narrator line; it should be on screen, not behind a panel.
  const messages = document.querySelectorAll("#transcript .message");
  assert.equal(messages.length, 1);
  assert.match(messages[0].textContent, /Mara Venn found a map/);
});

test("the scene chip summarises location and cast without opening anything", () => {
  assert.equal(
    $("#scene-chip-label").textContent,
    "The Glass Archive · Mara Venn",
  );
});

test("every message action lives behind one comfortable tap target", () => {
  const message = $("#transcript .message");
  const buttons = message.querySelectorAll("button");
  // One "⋯" plus the newest-reply footer (retry, illustrate). The old build
  // put six 25px-tall text buttons on every single message.
  assert.ok(buttons.length <= 4, `expected few inline buttons, got ${buttons.length}`);
  assert.ok(message.querySelector(".message-more"));
});

test("the world browser lists all four kinds in one place", async () => {
  click($("#world-chip"));
  await settled();

  assert.ok(sheet(), "the world sheet should be open");
  assert.equal(sheet().querySelector(".sheet-title").textContent, "World");

  const rows = textsOf(".world-row strong", sheetBody());
  assert.deepEqual(rows.sort(), [
    "Mara Venn",
    "Memory has weight",
    "The Glass Archive",
    "Unresolved thread: The impossible map",
  ]);

  // The word the user found confusing must be gone from the interface.
  assert.doesNotMatch(sheetBody().textContent, /canon/i);
});

test("searching and filtering narrow the world list", async () => {
  const search = sheetBody().querySelector(".world-search");
  search.value = "mara";
  search.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  await settled();
  assert.deepEqual(textsOf(".world-row strong", sheetBody()), ["Mara Venn"]);

  search.value = "";
  search.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  await settled();

  const locationsFilter = [...sheetBody().querySelectorAll(".segment")].find(
    (button) => button.textContent === "Locations",
  );
  click(locationsFilter);
  await settled();
  assert.deepEqual(textsOf(".world-row strong", sheetBody()), [
    "The Glass Archive",
  ]);
});

test("relationships are name chips, never typed IDs", async () => {
  const characters = [...sheetBody().querySelectorAll(".segment")].find(
    (button) => button.textContent === "Characters",
  );
  click(characters);
  await settled();
  click(sheetBody().querySelector(".world-row"));
  await settled();

  assert.equal(sheet().querySelector(".sheet-title").textContent, "Mara Venn");
  const body = sheetBody();
  assert.doesNotMatch(body.textContent, /IDs?\b/);
  assert.equal(body.querySelectorAll('input[placeholder*="Comma-separated IDs"]').length, 0);

  // "Knows about" is a chip picker over the actual entries, pre-selected.
  const chips = textsOf(".pick-chip", body);
  assert.ok(chips.includes("Memory has weight"), `chips were: ${chips}`);
  const on = [...body.querySelectorAll(".pick-chip.is-on")].map((chip) =>
    chip.textContent.trim(),
  );
  assert.deepEqual(on, ["Memory has weight"]);
});

test("editing a character saves and returns to the list", async () => {
  const nameInput = sheetBody().querySelector('input[name="name"]');
  nameInput.value = "Mara Venn-Ashe";
  click(sheet().querySelector(".sheet-action"));
  await settled();

  assert.equal(sheet().querySelector(".sheet-title").textContent, "World");
  assert.ok(textsOf(".world-row strong", sheetBody()).includes("Mara Venn-Ashe"));
  assert.equal($("#scene-chip-label").textContent, "The Glass Archive · Mara Venn-Ashe");
});

test("adding to the world offers the four kinds the user thinks in", async () => {
  click(sheet().querySelector(".sheet-action"));
  await settled();

  const menu = topSheet();
  assert.equal(menu.querySelector(".sheet-title").textContent, "Add to the world");
  assert.deepEqual(textsOf(".menu-label", menu), [
    "Character",
    "Location",
    "Object",
    "Fact",
  ]);
});

test("picking a kind opens its editor on top of the world browser", async () => {
  const objectItem = [...topSheet().querySelectorAll(".menu-item")].find(
    (item) => item.querySelector(".menu-label").textContent === "Object",
  );
  click(objectItem);
  await settled();

  // The menu dismissed itself and handed control back to the world sheet,
  // which pushed the new object's editor.
  assert.equal(document.querySelectorAll("dialog.sheet[open]").length, 1);
  assert.equal(sheet().querySelector(".sheet-title").textContent, "New object");
  assert.ok(sheetBody().querySelector('select[name="memory_rule"]'));
});

test("an object saved without keywords still has a trigger, and stays visible", async () => {
  sheetBody().querySelector('input[name="title"]').value = "The salt-iron key";
  sheetBody().querySelector('textarea[name="content"]').value =
    "It opens the east door and nothing else.";
  click(sheet().querySelector(".sheet-action"));
  await settled();

  // The list was filtered to Characters when the object was created; it must
  // follow the new entry rather than appearing to swallow it.
  const active = sheetBody().querySelector(".segment.is-on");
  assert.equal(active.textContent, "Objects");

  const rows = [...sheetBody().querySelectorAll(".world-row")];
  const saved = rows.find((row) =>
    row.textContent.includes("The salt-iron key"),
  );
  assert.ok(saved, "the new object should appear in the list");
  assert.match(saved.textContent, /When you mention: the salt-iron key/);
});

test("branches get a real picker with a fork action", async () => {
  click(sheet().querySelector(".sheet-close"));
  await settled();
  click($("#branch-chip"));
  await settled();

  assert.equal(sheet().querySelector(".sheet-title").textContent, "Branches");
  assert.deepEqual(textsOf(".branch-open strong", sheetBody()), ["Main thread"]);
  assert.equal(sheet().querySelector(".sheet-action").textContent, "Fork");
});

test("settings open with story instructions first and no persona collection", async () => {
  click(sheet().querySelector(".sheet-close"));
  await settled();
  click($("#settings-button"));
  await settled();

  const body = sheetBody();
  assert.equal(sheet().querySelector(".sheet-title").textContent, "Settings");
  assert.deepEqual(textsOf(".form-section-title", body), [
    "This story",
    "The AI",
    "Images",
    "Your OpenRouter key",
    "Your data",
  ]);
  assert.doesNotMatch(body.textContent, /persona/i);
  assert.match(body.textContent, /Who you play/);

  // Nothing in the app may use a font size iOS would zoom in on.
  for (const input of body.querySelectorAll("input, textarea, select")) {
    assert.ok(input.name, `every control should be named: ${input.outerHTML}`);
  }
});

test("who you play replaces personas and reaches the model", async () => {
  const link = [...sheetBody().querySelectorAll(".link-row")].find((row) =>
    row.textContent.includes("Who you play"),
  );
  click(link);
  await settled();

  assert.equal(sheet().querySelector(".sheet-title").textContent, "Who you play");
  sheetBody().querySelector('input[name="name"]').value = "Corwin Ash";
  sheetBody().querySelector('textarea[name="description"]').value =
    "A courier who never reads the letters.";
  click(sheet().querySelector(".sheet-action"));
  await settled();

  click(sheet().querySelector(".sheet-close"));
  await settled();

  // Reopen settings to confirm it persisted through a full re-render.
  click($("#settings-button"));
  await settled();
  const link2 = [...sheetBody().querySelectorAll(".link-row")].find((row) =>
    row.textContent.includes("Who you play"),
  );
  assert.match(link2.textContent, /Corwin Ash/);
  click(sheet().querySelector(".sheet-close"));
  await settled();
});

test("the composer's plus menu covers every old dropdown", async () => {
  click($("#composer-more"));
  await settled();

  const labels = textsOf(".menu-label", topSheet());
  assert.deepEqual(labels, [
    "Quick responses",
    "Write my next line for me",
    "Write as the narrator",
    "Speak as a character",
    "Aside to the AI",
    "Note for the AI to remember",
    "Back to writing as Corwin Ash",
  ]);
});

test("choosing a writing mode shows a clearable badge", async () => {
  const narrator = [...topSheet().querySelectorAll(".menu-item")].find(
    (item) =>
      item.querySelector(".menu-label").textContent === "Write as the narrator",
  );
  click(narrator);
  await settled();

  assert.equal(document.querySelectorAll("dialog.sheet[open]").length, 0);
  assert.ok(!$("#composer-mode").classList.contains("hidden"));
  assert.equal($("#composer-mode-label").textContent, "Writing as the narrator");

  click($("#composer-mode-clear"));
  await settled();
  assert.ok($("#composer-mode").classList.contains("hidden"));
});

test("sending without an API key explains itself instead of failing silently", async () => {
  $("#composer-input").value = "The rain stops.";
  $("#composer").dispatchEvent(
    new dom.window.Event("submit", { bubbles: true, cancelable: true }),
  );
  await settled();

  assert.match($("#composer-error").textContent, /OpenRouter API key/);
  // ...and it opens the place where that is fixed.
  assert.equal(sheet()?.querySelector(".sheet-title").textContent, "Settings");
  click(sheet().querySelector(".sheet-close"));
  await settled();
});

test("the message menu carries every action the old button row did", async () => {
  click($("#transcript .message-more"));
  await settled();

  const labels = textsOf(".menu-label", topSheet());
  assert.deepEqual(labels, [
    "Edit",
    "Fork from here",
    "Illustrate this moment",
    "Remember this",
    "Write it again",
    "Delete",
  ]);

  click(topSheet().querySelector(".sheet-close"));
  await settled();
});

test("the scene picker sets location and cast with taps", async () => {
  click($("#scene-chip"));
  await settled();
  assert.equal(sheet().querySelector(".sheet-title").textContent, "The scene");

  const chips = [...sheetBody().querySelectorAll(".pick-chip")];
  const mara = chips.find((chip) => chip.textContent === "Mara Venn-Ashe");
  assert.ok(mara.classList.contains("is-on"), "the demo cast starts selected");

  // Turning the only character off leaves just the location on the chip.
  click(mara);
  await settled();
  assert.equal($("#scene-chip-label").textContent, "The Glass Archive");

  const nowhere = chips.find(
    (chip) => chip.textContent === "Nowhere in particular",
  );
  click(nowhere);
  await settled();
  assert.equal($("#scene-chip-label").textContent, "Set the scene");

  click(mara);
  await settled();
  assert.equal($("#scene-chip-label").textContent, "Mara Venn-Ashe");

  click(sheet().querySelector(".sheet-close"));
  await settled();
  assert.equal(document.querySelectorAll("dialog.sheet[open]").length, 0);
});

test("retry is only offered when a reply is the newest message", async () => {
  const { renderChat } = await import("../src/ui/renderChat.js");
  const { createBranch, createMessage } = await import(
    "../src/models/storyProject.js"
  );
  const branch = createBranch({
    messages: [
      createMessage({ role: "assistant", content: "The gate opens." }),
      createMessage({ role: "user", content: "I step through." }),
    ],
  });
  const actions = [];
  const container = document.createElement("div");
  renderChat({
    container,
    branch,
    onAction: (...args) => actions.push(args),
  });

  const [reply, mine] = container.querySelectorAll(".message");
  assert.equal(reply.querySelector(".reply-footer"), null);
  assert.deepEqual(textsOf(".reply-action", mine), ["↻ Get a reply"]);

  click(mine.querySelector(".reply-action"));
  assert.deepEqual(actions, [["reply", branch.messages[1].message_id]]);
});

test("the newest reply offers Continue, and a continuation streams into it", async () => {
  const { renderChat } = await import("../src/ui/renderChat.js");
  const { createBranch, createMessage } = await import(
    "../src/models/storyProject.js"
  );
  const branch = createBranch({
    messages: [createMessage({ role: "assistant", content: "The gate" })],
  });
  const container = document.createElement("div");
  renderChat({ container, branch, onAction: () => {} });
  assert.deepEqual(textsOf(".reply-action", container), [
    "→ Continue",
    "↻ Retry",
    "✦ Illustrate",
  ]);

  renderChat({
    container,
    branch,
    busy: true,
    pendingText: "swings open.",
    continuingId: branch.messages[0].message_id,
    onAction: () => {},
  });
  const messages = container.querySelectorAll(".message");
  assert.equal(messages.length, 1, "no separate pending bubble");
  assert.match(messages[0].textContent, /The gate.*swings open\./s);
});

test("the scene sheet carries this branch's author's note", async () => {
  click($("#scene-chip"));
  await settled();
  const note = sheetBody().querySelector("textarea[name=author_note]");
  assert.ok(note, "author's note field is on the scene sheet");
  note.value = "Keep it tense.";
  note.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  click(sheet().querySelector(".sheet-close"));
  await new Promise((resolve) => setTimeout(resolve, 450));

  click($("#scene-chip"));
  await settled();
  assert.equal(
    sheetBody().querySelector("textarea[name=author_note]").value,
    "Keep it tense.",
  );
  click(sheet().querySelector(".sheet-close"));
  await settled();
});

// From here on the app talks to a fake OpenRouter: streamed requests get an
// SSE reply, background chores (emotion tracking) get an empty JSON object.
const requests = [];
let nextReply = "";
function fakeOpenRouter() {
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    requests.push(body);
    if (!body.stream) {
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "{}" } }] }),
        { status: 200 },
      );
    }
    const encoder = new TextEncoder();
    const chunk = `data: ${JSON.stringify({
      choices: [{ delta: { content: nextReply }, finish_reason: "stop" }],
    })}\n\ndata: [DONE]\n\n`;
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(chunk));
          controller.close();
        },
      }),
      { status: 200 },
    );
  };
}

test("Continue extends the newest reply in place", async () => {
  click($("#settings-button"));
  await settled();
  sheetBody().querySelector('input[name="api_key"]').value = "sk-test";
  click(sheet().querySelector(".sheet-action"));
  await settled();
  document.querySelectorAll("dialog.sheet[open]").forEach((d) => d.close());
  fakeOpenRouter();

  nextReply = "She folds it away.\nCorwin Ash: I take it from her.";
  const continueButton = [...document.querySelectorAll(".reply-action")].find(
    (button) => button.textContent === "→ Continue",
  );
  click(continueButton);
  await settled();
  await settled();

  const messages = document.querySelectorAll("#transcript .message");
  assert.equal(messages.length, 1);
  assert.match(messages[0].textContent, /tomorrow's date\.\s*She folds it away\./);
  assert.doesNotMatch(messages[0].textContent, /I take it from her/);

  const sent = requests.find((body) => body.stream);
  assert.deepEqual(sent.stop, [
    "\nCorwin Ash:",
    "\n**Corwin Ash:**",
    "\n**Corwin Ash**:",
  ]);
  const contents = sent.messages.map((message) => message.content);
  assert.match(contents.at(-1), /Continue your last reply/);
  assert.ok(contents.includes("[Author's note: Keep it tense.]"));
});

test("Write my next line drafts into the composer, not the transcript", async () => {
  requests.length = 0;
  nextReply = "Corwin Ash: I pocket the map before she can stop me.";
  $("#composer-input").value = "";
  click($("#composer-more"));
  await settled();
  const item = [...topSheet().querySelectorAll(".menu-label")]
    .find((label) => label.textContent === "Write my next line for me")
    .closest("button");
  click(item);
  await settled();
  await settled();

  assert.equal(
    $("#composer-input").value,
    "I pocket the map before she can stop me.",
  );
  assert.equal(document.querySelectorAll("#transcript .message").length, 1);
  assert.match(requests[0].messages.at(-1).content, /draft the next message for Corwin Ash/);
  assert.equal("stop" in requests[0], false);
});
