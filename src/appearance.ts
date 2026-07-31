const APPEARANCE_STORAGE_KEY = "vellix.editor.appearance.v1";
const RUNTIME_STYLE_ID = "vellix-runtime-appearance-style";

export interface EditorAppearance {
  fontFamily?: string;
  pageBackground?: string;
  textColor?: string;
}

export type EditorAppearancePayload = Record<string, unknown>;

const FONT_STACKS = {
  mono: "ui-monospace, 'SF Mono', Menlo, Monaco, monospace",
  rounded:
    "ui-rounded, -apple-system-rounded, 'SF Pro Rounded', 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif",
  serif: "ui-serif, Georgia, 'Times New Roman', serif",
} as const;

function ensureRuntimeAppearanceStyle(): void {
  let style = document.getElementById(RUNTIME_STYLE_ID) as HTMLStyleElement | null;

  if (!style) {
    style = document.createElement("style");
    style.id = RUNTIME_STYLE_ID;
    document.head.append(style);
  }

  style.textContent = `
html,
body,
#root,
#root .vellix-editor-shell,
#root .vellix-editor-page,
#root .bn-container,
#root .bn-default-styles,
#root .bn-editor,
#root .ProseMirror,
#root .bn-block,
#root .bn-block-content,
#root .bn-inline-content,
#root [data-inline-content],
#root .bn-default-styles *,
#root .ProseMirror * {
  font-family: var(--vellix-font-family) !important;
}

#root .vellix-editor-shell svg,
#root .vellix-editor-shell svg * {
  color: #fff !important;
  fill: currentColor !important;
  stroke: currentColor !important;
}

#root .vellix-editor-shell [data-vellix-icon],
#root .vellix-editor-shell .vellix-icon,
#root .vellix-editor-shell [data-vellix-icon] img,
#root .vellix-editor-shell .vellix-icon img {
  color: #fff !important;
  filter: brightness(0) invert(1);
}
`;
}

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
  ensureRuntimeAppearanceStyle();

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
  ensureRuntimeAppearanceStyle();

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

export function reinforceEditorAppearance(): void {
  ensureRuntimeAppearanceStyle();

  document
    .querySelectorAll<HTMLElement>(
      [
        "html",
        "body",
        "#root",
        ".vellix-editor-shell",
        ".vellix-editor-page",
        ".bn-container",
        ".bn-default-styles",
        ".bn-editor",
        ".ProseMirror",
        ".bn-block",
        ".bn-block-content",
        ".bn-inline-content",
        "[data-inline-content]",
      ].join(","),
    )
    .forEach((element) => {
      element.style.setProperty(
        "font-family",
        "var(--vellix-font-family)",
        "important",
      );
    });
}
