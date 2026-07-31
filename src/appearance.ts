const APPEARANCE_STORAGE_KEY = "vellix.editor.appearance.v1";

export interface EditorAppearance {
  fontFamily?: string;
  pageBackground?: string;
  textColor?: string;
}

export type EditorAppearancePayload = Record<string, unknown>;

const FONT_STACKS = {
  mono: "ui-monospace, 'SF Mono', Menlo, Monaco, monospace",
  rounded:
    "ui-rounded, 'SF Pro Rounded', -apple-system, BlinkMacSystemFont, sans-serif",
  serif: "ui-serif, Georgia, 'Times New Roman', serif",
} as const;

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function normalizeFontFamily(value: unknown): string | undefined {
  const family = stringValue(value);
  if (!family) {
    return undefined;
  }

  const lowered = family.toLowerCase();
  if (
    lowered.includes("ui-rounded") ||
    lowered.includes("sf pro rounded") ||
    lowered === "rounded"
  ) {
    return FONT_STACKS.rounded;
  }

  if (
    lowered.includes("ui-monospace") ||
    lowered.includes("sf mono") ||
    lowered.includes("menlo") ||
    lowered.includes("mono")
  ) {
    return FONT_STACKS.mono;
  }

  if (
    lowered.includes("ui-serif") ||
    lowered.includes("georgia") ||
    lowered.includes("times new roman") ||
    lowered.includes("serif")
  ) {
    return FONT_STACKS.serif;
  }

  return family;
}

function normalizeAppearance(
  payload: EditorAppearancePayload,
): EditorAppearance {
  return {
    fontFamily: normalizeFontFamily(payload.fontFamily),
    pageBackground: stringValue(payload.pageBackground),
    textColor: stringValue(payload.textColor),
  };
}

export function applyAppearance(
  payload: EditorAppearancePayload,
  options: { persist?: boolean } = {},
): EditorAppearance {
  const appearance = normalizeAppearance(payload);
  const style = document.documentElement.style;

  if (appearance.textColor) {
    style.setProperty("--vellix-primary-text", appearance.textColor);
  }

  if (appearance.fontFamily) {
    style.setProperty("--vellix-font-family", appearance.fontFamily);
  }

  if (appearance.pageBackground) {
    style.setProperty("--vellix-page-background", appearance.pageBackground);
  }

  if (options.persist !== false) {
    try {
      localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(appearance));
    } catch {
      /* WKWebView storage can be unavailable in some test contexts. */
    }
  }

  return appearance;
}

export function applyStoredAppearance(): void {
  try {
    const raw = localStorage.getItem(APPEARANCE_STORAGE_KEY);
    if (!raw) {
      return;
    }

    const parsed = JSON.parse(raw) as EditorAppearancePayload;
    applyAppearance(parsed, { persist: false });
  } catch {
    /* Ignore corrupt or unavailable persisted appearance. */
  }
}
