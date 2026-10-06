export function toPlainText(value, fallback = "") {
  if (typeof value === "string") {
    return value.replace(/\0/g, "");
  }

  if (value === null || value === undefined) {
    return fallback;
  }

  return String(value).replace(/\0/g, "");
}

export function toStringArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => toPlainText(item).trim()).filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

export function setText(element, value) {
  element.textContent = toPlainText(value);
  return element;
}

export function safeNumber(value, fallback, { min = -Infinity, max = Infinity } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}
