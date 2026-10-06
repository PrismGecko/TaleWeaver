/**
 * The one navigation primitive in the app. Everything that is not the
 * transcript — stories, branches, the world, the scene, settings — is a screen
 * inside a bottom sheet, so there is a single interaction to learn and a single
 * place for the back button.
 *
 * A sheet owns a stack of screens. `push` adds one (and reveals a back
 * button); `pop` returns; closing the sheet discards the stack.
 */

// Sheets stack rather than replace each other: a menu opened from the world
// browser has to leave the browser alive underneath, because dismissing the
// menu hands control back to the sheet that launched it.
const open = [];

/**
 * @typedef {object} Screen
 * @property {string} title
 * @property {(body: HTMLElement, sheet: SheetHandle) => void} render
 * @property {{label: string, onClick: () => void, variant?: string}} [action]
 *   Optional trailing button in the sheet header.
 */

/**
 * @typedef {object} SheetHandle
 * @property {(screen: Screen) => void} push
 * @property {() => void} pop
 * @property {() => void} refresh Re-render the top screen in place.
 * @property {() => void} close
 */

/**
 * Open a sheet with `screen` as its root. Any sheet already open is replaced.
 * @param {Screen} screen
 * @param {{onClose?: () => void, compact?: boolean}} [options]
 * @returns {SheetHandle}
 */
export function openSheet(screen, options = {}) {
  const dialog = document.createElement("dialog");
  dialog.className = `sheet${options.compact ? " sheet-compact" : ""}`;

  const frame = document.createElement("div");
  frame.className = "sheet-frame";

  const header = document.createElement("header");
  header.className = "sheet-header";
  const back = document.createElement("button");
  back.type = "button";
  back.className = "sheet-back";
  back.textContent = "‹";
  back.setAttribute("aria-label", "Back");
  const heading = document.createElement("h2");
  heading.className = "sheet-title";
  const trailing = document.createElement("div");
  trailing.className = "sheet-trailing";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "sheet-close";
  close.textContent = "Done";
  header.append(back, heading, trailing, close);

  const body = document.createElement("div");
  body.className = "sheet-body";

  frame.append(header, body);
  dialog.append(frame);
  document.body.append(dialog);

  const stack = [];
  /** @type {SheetHandle} */
  const handle = {
    push(next) {
      stack.push(next);
      draw();
    },
    pop() {
      if (stack.length <= 1) {
        handle.close();
        return;
      }
      stack.pop();
      draw();
    },
    refresh: draw,
    close() {
      if (dialog.open) dialog.close();
    },
  };

  function draw() {
    const current = stack.at(-1);
    if (!current) return;
    heading.textContent = current.title;
    back.classList.toggle("hidden", stack.length <= 1);
    trailing.replaceChildren();
    body.replaceChildren();
    body.scrollTop = 0;
    // Render before wiring the header action: screens routinely assign their
    // real `action.onClick` from inside render, so the click must be looked up
    // at click time rather than captured here.
    current.render(body, handle);
    if (current.action) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `sheet-action ${current.action.variant || ""}`.trim();
      button.textContent = current.action.label;
      button.addEventListener("click", (event) =>
        current.action.onClick(event),
      );
      trailing.append(button);
    }
  }

  back.addEventListener("click", () => handle.pop());
  close.addEventListener("click", () => handle.close());
  // Tapping the backdrop above the sheet dismisses it, as iOS sheets do.
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) handle.close();
  });
  // The hardware/keyboard back gesture should step back one screen, not
  // discard the whole sheet, while any screens remain beneath.
  dialog.addEventListener("cancel", (event) => {
    if (stack.length > 1) {
      event.preventDefault();
      handle.pop();
    }
  });
  dialog.addEventListener("close", () => {
    const index = open.indexOf(dialog);
    if (index >= 0) open.splice(index, 1);
    dialog.remove();
    options.onClose?.();
  });

  open.push(dialog);
  stack.push(screen);
  draw();
  dialog.showModal();
  return handle;
}

/**
 * A compact action list — the app's replacement for rows of tiny inline
 * buttons. Each item is a full-width row with a comfortable touch target.
 * @param {{title?: string, items: Array<{label: string, hint?: string, icon?: string, danger?: boolean, onSelect: () => void}>}} config
 */
export function openMenu({ title = "", items }) {
  return openSheet(
    {
      title,
      render(body, sheet) {
        const list = document.createElement("div");
        list.className = "menu-list";
        for (const item of items) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = `menu-item${item.danger ? " is-danger" : ""}`;
          if (item.icon) {
            const icon = document.createElement("span");
            icon.className = "menu-icon";
            icon.textContent = item.icon;
            icon.setAttribute("aria-hidden", "true");
            button.append(icon);
          }
          const text = document.createElement("span");
          text.className = "menu-text";
          const label = document.createElement("span");
          label.className = "menu-label";
          label.textContent = item.label;
          text.append(label);
          if (item.hint) {
            const hint = document.createElement("span");
            hint.className = "menu-hint";
            hint.textContent = item.hint;
            text.append(hint);
          }
          button.append(text);
          button.addEventListener("click", () => {
            sheet.close();
            // Let the sheet finish closing so the next one animates cleanly.
            queueMicrotask(item.onSelect);
          });
          list.append(button);
        }
        body.append(list);
      },
    },
    { compact: true },
  );
}

/** Close the topmost sheet, if any. */
export function closeSheet() {
  open.at(-1)?.close();
}

/**
 * Dismiss the whole stack. Used after an action that invalidates the screens
 * underneath — deleting the story a list is showing, say — so the user is not
 * left looking at a row that no longer exists.
 */
export function closeAllSheets() {
  for (const dialog of [...open].reverse()) dialog.close();
}
