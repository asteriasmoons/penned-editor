import type { CSSProperties } from "react";
import { createReactBlockSpec } from "@blocknote/react";

import { sendToNative } from "./NativeBridge";

const DEFAULT_CALLOUT_ICON = "sparkle";
const DEFAULT_CALLOUT_COLOR = "#ffffff";

function iconGlyph(icon: string): string {
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
          <button
            type="button"
            className="vellix-callout-icon"
            data-vellix-icon
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
            {iconGlyph(icon)}
          </button>
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
          <span>{iconGlyph(icon)}</span>
          <span ref={props.contentRef} />
        </aside>
      );
    },
  },
)();
