import { toPlainText } from "./sanitize.js";

const INLINE_PATTERN = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|“[^”\n]+”|"[^"\n]+")/g;

/**
 * Tokenize one line of roleplay prose into typed spans: **bold**, *action*
 * emphasis, and “quoted dialogue”. Pure so it can be unit tested in Node.
 */
export function parseInline(text) {
  const tokens = [];
  let last = 0;
  for (const match of text.matchAll(INLINE_PATTERN)) {
    if (match.index > last) {
      tokens.push({ type: "text", text: text.slice(last, match.index) });
    }
    const raw = match[0];
    if (raw.startsWith("**")) {
      tokens.push({ type: "bold", text: raw.slice(2, -2) });
    } else if (raw.startsWith("*")) {
      tokens.push({ type: "action", text: raw.slice(1, -1) });
    } else {
      tokens.push({ type: "dialogue", text: raw });
    }
    last = match.index + raw.length;
  }
  if (last < text.length) {
    tokens.push({ type: "text", text: text.slice(last) });
  }
  return tokens;
}

/**
 * Render text into container as paragraphs of styled DOM nodes. Everything is
 * built with textContent — user/model text never reaches innerHTML.
 */
export function renderRichText(container, text) {
  container.replaceChildren();
  const value = toPlainText(text);
  for (const paragraphText of value.split(/\n{2,}/)) {
    const paragraph = document.createElement("p");
    const lines = paragraphText.split("\n");
    lines.forEach((line, lineIndex) => {
      if (lineIndex) paragraph.append(document.createElement("br"));
      for (const token of parseInline(line)) {
        if (token.type === "text") {
          paragraph.append(token.text);
        } else if (token.type === "bold") {
          const strong = document.createElement("strong");
          strong.textContent = token.text;
          paragraph.append(strong);
        } else if (token.type === "action") {
          const em = document.createElement("em");
          em.className = "rt-action";
          em.textContent = token.text;
          paragraph.append(em);
        } else {
          const span = document.createElement("span");
          span.className = "rt-dialogue";
          span.textContent = token.text;
          paragraph.append(span);
        }
      }
    });
    container.append(paragraph);
  }
  return container;
}
