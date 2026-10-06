let activeDialog = null;

function buildDialog() {
  const dialog = document.createElement("dialog");
  dialog.className = "app-dialog";
  document.body.append(dialog);
  return dialog;
}

function closeDialog(dialog) {
  if (dialog.open) dialog.close();
  dialog.remove();
  if (activeDialog === dialog) activeDialog = null;
}

/**
 * Text-entry dialog replacing window.prompt (which iOS home-screen web apps
 * never display). Resolves with the entered string, or null on cancel.
 */
export function promptDialog({
  title,
  value = "",
  multiline = false,
  confirmLabel = "Save",
  placeholder = "",
}) {
  return new Promise((resolve) => {
    if (activeDialog) closeDialog(activeDialog);
    const dialog = buildDialog();
    activeDialog = dialog;

    const form = document.createElement("form");
    form.method = "dialog";
    form.className = "app-dialog-form";

    const heading = document.createElement("h2");
    heading.textContent = title;

    const input = multiline
      ? document.createElement("textarea")
      : document.createElement("input");
    if (multiline) {
      input.rows = 6;
    } else {
      input.type = "text";
    }
    input.value = value;
    input.placeholder = placeholder;
    input.name = "value";

    const actions = document.createElement("div");
    actions.className = "dialog-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "secondary";
    cancel.textContent = "Cancel";
    const confirm = document.createElement("button");
    confirm.type = "submit";
    confirm.className = "primary";
    confirm.textContent = confirmLabel;
    actions.append(cancel, confirm);

    form.append(heading, input, actions);
    dialog.append(form);

    let settled = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      closeDialog(dialog);
      resolve(result);
    };

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      settle(input.value);
    });
    if (multiline) {
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          form.requestSubmit();
        }
      });
    }
    cancel.addEventListener("click", () => settle(null));
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      settle(null);
    });
    dialog.addEventListener("close", () => settle(null));

    dialog.showModal();
    input.focus();
    if (!multiline) input.select();
  });
}

/**
 * Confirmation dialog replacing window.confirm. Resolves with a boolean.
 */
export function confirmDialog({
  message,
  confirmLabel = "Confirm",
  danger = false,
}) {
  return new Promise((resolve) => {
    if (activeDialog) closeDialog(activeDialog);
    const dialog = buildDialog();
    activeDialog = dialog;

    const form = document.createElement("form");
    form.method = "dialog";
    form.className = "app-dialog-form";

    const text = document.createElement("p");
    text.textContent = message;

    const actions = document.createElement("div");
    actions.className = "dialog-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "secondary";
    cancel.textContent = "Cancel";
    const confirm = document.createElement("button");
    confirm.type = "submit";
    confirm.className = danger ? "danger" : "primary";
    confirm.textContent = confirmLabel;
    actions.append(cancel, confirm);

    form.append(text, actions);
    dialog.append(form);

    let settled = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      closeDialog(dialog);
      resolve(result);
    };

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      settle(true);
    });
    cancel.addEventListener("click", () => settle(false));
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      settle(false);
    });
    dialog.addEventListener("close", () => settle(false));

    dialog.showModal();
    confirm.focus();
  });
}
