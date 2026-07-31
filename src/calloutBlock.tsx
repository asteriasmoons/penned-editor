import type { CSSProperties } from "react";
import { createReactBlockSpec } from "@blocknote/react";

import { sendToNative } from "./NativeBridge";

const DEFAULT_CALLOUT_ICON = "sparkles";
const DEFAULT_CALLOUT_COLOR = "#ffffff";

function iconGlyph(icon: string): string {
  switch (icon) {
    case "sparkles":
      return "✦";
    case "heart":
    case "heart.fill":
      return "♡";
    case "star":
    case "star.fill":
      return "★";
    case "moon":
    case "moon.fill":
      return "☾";
    default:
      return "✧";
  }
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
            contentEditable={false}
            onMouseDown={(event) => event.preventDefault()}
            onTouchStart={(event) => event.preventDefault()}
            onClick={() => {
              sendToNative("requestCalloutIconPicker", {
                blockId: props.block.id,
                icon,
              });
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
