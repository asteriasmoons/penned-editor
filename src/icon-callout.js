import { Node, mergeAttributes } from "@tiptap/core";
import { attachmentURL } from "./attachments.js";
import { gridCardSettings, opaqueHex, solidCalloutAttributes } from "./grid-card.js";
import { calloutWidth } from "./callout-layout.js";
import { Plugin, Selection, NodeSelection } from "@tiptap/pm/state";

export const ICON_CALLOUT_DEFAULTS = {
  icon: "sparkle", iconColor: "#ffffff", backgroundColor: "#302d36", imagePath: null, textColor: null, imageTint: null,
  title: "", titleColor: null, collapsible: false, collapsed: false, collapseColor: null,
};

export function iconCalloutSettings(attrs = {}) {
  const { icon, iconColor, backgroundColor } = gridCardSettings(attrs);
  const imagePath = typeof attrs.imagePath === "string" && attachmentURL({ relativePath: attrs.imagePath }) ? attrs.imagePath : null;
  const collapsible = attrs.collapsible === true || attrs.collapsible === "true";
  return { icon, iconColor, backgroundColor, imagePath,
    textColor: opaqueHex(attrs.textColor, null), imageTint: opaqueHex(attrs.imageTint, null),
    title: typeof attrs.title === "string" ? attrs.title : "", titleColor: opaqueHex(attrs.titleColor, null),
    collapsible, collapsed: collapsible && (attrs.collapsed === true || attrs.collapsed === "true"),
    collapseColor: opaqueHex(attrs.collapseColor, null) };
}

export function iconCalloutSurface(settings) {
  return solidCalloutAttributes(settings.backgroundColor) + `--vellix-callout-color:${settings.iconColor};`
    + `--penned-callout-text:${settings.textColor ?? "initial"};`
    + `--penned-callout-title:${settings.titleColor ?? "var(--vellix-primary-text)"};`
    + `--penned-callout-icon-outline:${settings.imagePath ? settings.imageTint ?? "transparent" : settings.iconColor};`
    + `--penned-callout-disclosure:${settings.collapseColor ?? settings.iconColor};`;
}

export function plainCalloutSettings(attrs = {}) {
  const height = Number(attrs.minimumHeight);
  return { color: opaqueHex(attrs.color, "#ffffff"), textColor: opaqueHex(attrs.textColor, null),
    widthPercent: calloutWidth(attrs.widthPercent),
    minimumHeight: Number.isFinite(height) && height > 0 ? Math.round(Math.min(1600, Math.max(44, height))) : null };
}

export function plainCalloutSurface(attrs) {
  const settings = plainCalloutSettings(attrs);
  return iconCalloutSurface({ backgroundColor: settings.color, textColor: settings.textColor, iconColor: "#ffffff" })
    + (settings.minimumHeight ? `--penned-plain-callout-min-height:${settings.minimumHeight}px;` : "");
}

export function iconCalloutImage(src, tint) {
  const image = ["img", { class: "penned-icon-callout-image", src, alt: "", draggable: "false" }];
  if (!tint) return image;
  return ["span", { class: "penned-icon-callout-tint",
    style: `--penned-callout-tint:${tint};--penned-callout-mask:url(${JSON.stringify(src)});`,
  }, image];
}

export function iconCalloutNode({ renderLibraryIcon, selectionActive = () => false, reportHeight }) {
  return Node.create({
    name: "iconCallout", group: "block", content: "block+", defining: true, isolating: true,
    addAttributes: () => Object.fromEntries(Object.entries(ICON_CALLOUT_DEFAULTS).map(([key, value]) =>
      [key, { default: value, rendered: false }])),
    parseHTML: () => [{
      tag: "div[data-type='penned-icon-callout']",
      contentElement: element => element.querySelector(":scope > .vellix-callout-text") ?? element,
      getAttrs: element => iconCalloutSettings({
        icon: element.dataset.calloutIcon, iconColor: element.dataset.calloutColor,
        backgroundColor: element.dataset.calloutBackground, imagePath: element.dataset.calloutImage,
        textColor: element.dataset.calloutTextColor, imageTint: element.dataset.calloutImageTint,
        title: element.dataset.calloutTitle, titleColor: element.dataset.calloutTitleColor,
        collapsible: element.dataset.calloutCollapsible, collapsed: element.dataset.calloutCollapsed,
        collapseColor: element.dataset.calloutCollapseColor,
      }),
    }],
    renderHTML({ HTMLAttributes, node }) {
      const settings = iconCalloutSettings(node.attrs);
      const { icon, iconColor, backgroundColor, imagePath, textColor, imageTint } = settings;
      const hasTitle = settings.title.trim().length > 0;
      const children = [["button", {
        type: "button", class: "vellix-callout-icon-button", contenteditable: "false",
        "data-vellix-callout-icon-button": "true", "aria-label": "Callout Settings",
      }, imagePath ? iconCalloutImage(attachmentURL({ relativePath: imagePath }), imageTint) : renderLibraryIcon(icon, iconColor)]];
      if (hasTitle) children.push(["div", { class: "penned-icon-callout-title", contenteditable: "false" }, settings.title]);
      children.push(["div", { class: "vellix-callout-text", "aria-hidden": settings.collapsed ? "true" : null,
        ...(settings.collapsed ? { inert: "" } : {}) }, 0]);
      if (settings.collapsible) children.push(["button", {
        type: "button", class: "penned-icon-callout-disclosure", contenteditable: "false",
        "data-icon-callout-disclosure": "", "aria-expanded": String(!settings.collapsed),
        "aria-label": settings.collapsed ? "Expand callout" : "Collapse callout",
      }, ["span", { "aria-hidden": "true" }]]);
      return ["div", mergeAttributes(HTMLAttributes, {
        class: "vellix-callout penned-icon-callout", "data-type": "penned-icon-callout",
        "data-callout-icon": icon, "data-callout-color": iconColor, "data-callout-background": backgroundColor,
        "data-callout-image": imagePath, style: iconCalloutSurface(settings),
        "data-callout-text-color": textColor, "data-callout-image-tint": imageTint,
        "data-callout-title": settings.title, "data-callout-title-color": settings.titleColor,
        "data-callout-has-title": String(hasTitle), "data-callout-collapsible": String(settings.collapsible),
        "data-callout-collapsed": String(settings.collapsed), "data-callout-collapse-color": settings.collapseColor,
      }), ...children];
    },
    addProseMirrorPlugins() {
      const buttonFor = (view, event) => {
        const button = event.target.closest?.("button[data-icon-callout-disclosure]");
        return button && view.dom.contains(button) ? button : null;
      };
      const preventFocus = (view, event) => {
        if (!buttonFor(view, event)) return false;
        event.preventDefault();
        return true;
      };
      return [new Plugin({ props: { handleDOMEvents: {
        pointerdown: preventFocus, mousedown: preventFocus,
        click(view, event) {
          const button = buttonFor(view, event);
          if (!button) return false;
          event.preventDefault();
          event.stopPropagation();
          if (!view.editable || selectionActive()) return true;
          const root = button.closest(".penned-icon-callout");
          const blockID = root?.dataset.vellixBlockId;
          if (!blockID) return true;
          let target = null;
          view.state.doc.descendants((node, pos) => {
            if (!target && node.type.name === "iconCallout" && node.attrs.id === blockID) target = { node, pos };
            return !target;
          });
          if (!target || !iconCalloutSettings(target.node.attrs).collapsible) return true;
          const collapsed = !iconCalloutSettings(target.node.attrs).collapsed;
          const tr = view.state.tr.setNodeAttribute(target.pos, "collapsed", collapsed);
          if (collapsed && tr.selection.from > target.pos && tr.selection.to < target.pos + target.node.nodeSize) {
            const after = tr.doc.resolve(target.pos + target.node.nodeSize);
            const before = tr.doc.resolve(target.pos);
            tr.setSelection(Selection.findFrom(after, 1, true) ?? Selection.findFrom(before, -1, true)
              ?? NodeSelection.create(tr.doc, target.pos));
          }
          view.dom.blur();
          const native = root.ownerDocument.getSelection();
          if (native?.anchorNode && root.contains(native.anchorNode)) native.removeAllRanges();
          view.dispatch(tr.setMeta("addToHistory", false));
          reportHeight?.();
          return true;
        },
      } } })];
    },
  });
}
