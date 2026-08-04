import type { CSSProperties } from "react";
import { createReactBlockSpec } from "@blocknote/react";

const DEFAULT_CALLOUT_ICON = "sparkle";
const DEFAULT_CALLOUT_COLOR = "#ffffff";

function normalizedIconName(icon: string): string {
  const trimmed = icon.trim() || DEFAULT_CALLOUT_ICON;

  return (
    trimmed
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || DEFAULT_CALLOUT_ICON
  );
}

function iconAssetPath(icon: string): string {
  return `/asset-icons/${encodeURIComponent(normalizedIconName(icon))}.png`;
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
          data-vellix-callout="true"
          data-callout-icon={icon}
          data-callout-color={color}
          tabIndex={-1}
          style={
            {
              "--vellix-callout-color": color,
              "--vellix-callout-icon-url": `url("${iconAssetPath(icon)}")`,
            } as CSSProperties
          }
        >
          <span className="vellix-callout-icon" aria-hidden="true" />
          <div
            className="vellix-callout-text"
            data-vellix-callout-content="true"
            ref={props.contentRef}
          />
        </div>
      );
    },
    toExternalHTML(props) {
      const icon = props.block.props.icon || DEFAULT_CALLOUT_ICON;
      const color = props.block.props.color || DEFAULT_CALLOUT_COLOR;

      return (
        <aside
          className="vellix-callout"
          data-vellix-callout="true"
          data-callout-icon={icon}
          data-callout-color={color}
          style={
            {
              "--vellix-callout-color": color,
              "--vellix-callout-icon-url": `url("${iconAssetPath(icon)}")`,
            } as CSSProperties
          }
        >
          <span className="vellix-callout-icon" aria-hidden="true" />
          <span
            className="vellix-callout-text"
            data-vellix-callout-content="true"
            ref={props.contentRef}
          />
        </aside>
      );
    },
  },
)();
