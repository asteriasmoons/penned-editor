import type { CSSProperties } from "react";
import { createReactBlockSpec } from "@blocknote/react";

import { sendToNative } from "./NativeBridge";

const DEFAULT_CALLOUT_ICON = "sparkle";
const DEFAULT_CALLOUT_COLOR = "#ffffff";

function iconFallbackGlyph(icon: string): string {
  const normalized = icon.toLowerCase();

  if (normalized.includes("heart")) {
    return "♡";
  }
  if (normalized.includes("star")) {
    return "★";
  }
  if (normalized.includes("moon")) {
    return "☾";
  }
  if (normalized.includes("check")) {
    return "✓";
  }
  if (normalized.includes("book") || normalized.includes("doc")) {
    return "▤";
  }
  if (normalized.includes("code") || normalized.includes("window")) {
    return "</>";
  }
  if (normalized.includes("cal")) {
    return "◷";
  }
  if (normalized.includes("chat")) {
    return "◌";
  }

  return "✦";
}

function normalizedIconName(icon: string): string {
  const trimmed = icon.trim() || DEFAULT_CALLOUT_ICON;
  const lower = trimmed.toLowerCase();

  return (
    lower
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || DEFAULT_CALLOUT_ICON
  );
}

function iconAssetPath(icon: string): string {
  return `/asset-icons/${encodeURIComponent(normalizedIconName(icon))}.png`;
}

function calloutIconElement(icon: string) {
  return (
    <span
      aria-hidden="true"
      className="vellix-callout-icon-mask"
      data-fallback-icon={iconFallbackGlyph(icon)}
      style={
        {
          "--vellix-callout-icon-url": `url("${iconAssetPath(icon)}")`,
        } as CSSProperties
      }
    >
      <span className="vellix-callout-icon-fallback">
        {iconFallbackGlyph(icon)}
      </span>
    </span>
  );
}

export const calloutBlockSpec = createReactBlockSpec(
  {
    type: "callout",
    propSchema: {
      icon: {
        default: DEFAULT_CALLOUT_ICON,
      },
      color: {
        default: DEFAULT_CALLOUT_COLOR,
      },
    },
    content: "inline",
  },
  {
    parse(element) {
      if (!element.classList.contains("vellix-callout")) {
        return undefined;
      }

      return {
        icon: element.getAttribute("data-callout-icon") || DEFAULT_CALLOUT_ICON,
        color:
          element.getAttribute("data-callout-color") || DEFAULT_CALLOUT_COLOR,
      };
    },
    render(props) {
      const icon = props.block.props.icon || DEFAULT_CALLOUT_ICON;
      const color = props.block.props.color || DEFAULT_CALLOUT_COLOR;

      return (
        <div
          className="vellix-callout"
          data-callout-icon={icon}
          data-callout-color={color}
          style={{ "--vellix-callout-color": color } as CSSProperties}
        >
          <span
            role="button"
            tabIndex={-1}
            className="vellix-callout-icon"
            aria-label="Change callout icon"
            data-vellix-icon
            data-vellix-callout-icon={icon}
            data-vellix-editor-control
            contentEditable={false}
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onPointerUp={(event) => {
              event.preventDefault();
              event.stopPropagation();
              sendToNative("requestCalloutIconPicker", {
                blockId: props.block.id,
                icon,
              });
            }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
          >
            {calloutIconElement(icon)}
          </span>
          <div className="vellix-callout-text" ref={props.contentRef} />
        </div>
      );
    },
    toExternalHTML(props) {
      const icon = props.block.props.icon || DEFAULT_CALLOUT_ICON;
      const color = props.block.props.color || DEFAULT_CALLOUT_COLOR;

      return (
        <aside
          className="vellix-callout"
          data-callout-icon={icon}
          data-callout-color={color}
        >
          <span
            className="vellix-callout-icon-mask"
            style={
              {
                "--vellix-callout-icon-url": `url("${iconAssetPath(icon)}")`,
              } as CSSProperties
            }
          />
          <span ref={props.contentRef} />
        </aside>
      );
    },
  },
)();
