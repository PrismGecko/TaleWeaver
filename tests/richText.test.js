import test from "node:test";
import assert from "node:assert/strict";

import { parseInline } from "../src/utils/richText.js";

test("parseInline splits bold, action emphasis, and dialogue", () => {
  const tokens = parseInline('*He bows.* "After you," he says **firmly**.');

  assert.deepEqual(tokens, [
    { type: "action", text: "He bows." },
    { type: "text", text: " " },
    { type: "dialogue", text: '"After you,"' },
    { type: "text", text: " he says " },
    { type: "bold", text: "firmly" },
    { type: "text", text: "." },
  ]);
});

test("parseInline handles curly quotes and plain text", () => {
  assert.deepEqual(parseInline("“Hello.”"), [
    { type: "dialogue", text: "“Hello.”" },
  ]);
  assert.deepEqual(parseInline("Just prose."), [
    { type: "text", text: "Just prose." },
  ]);
});

test("parseInline leaves unbalanced markers as text", () => {
  assert.deepEqual(parseInline("2 * 3 = 6 and a lone \" quote"), [
    { type: "text", text: "2 * 3 = 6 and a lone \" quote" },
  ]);
});
