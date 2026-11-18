// Tabs — a tabbed content block.
//
// Shape: tabs > tabPanel+ . Each tabPanel holds a full rich-text body ("block+",
// so every other document block nests inside a tab) plus a `name` attribute for
// its label and a stable `id`. The parent `tabs` node remembers which tab is
// default (`activeTab`) and carries every appearance setting (container, header,
// tab-bar style, colors, spacing). Only the active panel is shown — purely by CSS
// driven from `data-active-tab`, so switching tabs never mutates content.
//
// The node view owns the non-editable chrome (optional header, the interactive
// tab bar) outside of contentDOM; the panels themselves stay editable content.
// Tapping a tab switches it; holding a tab or tapping the container border opens settings.

import { Node, mergeAttributes } from "@tiptap/core";
import { DOMSerializer } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { closeHistory } from "@tiptap/pm/history";
import { iconAssetCSSVariable } from "./collection-node.js";
import { inlineTextEdit } from "./incremental-nodes.js";

export const TABS_DEFAULTS = {
  showContainer: true,
  showHeader: false,
  title: "",
  subtitle: "",
  icon: "",
  tabBarStyle: "filled", // filled | underlined | segmented | minimal
  activeTabBg: "#3A3A3C",
  activeTabText: "#FFFFFF",
  inactiveTabBg: "#1C1C1E",
  inactiveTabText: "#9A9AA0",
  indicatorColor: "#7C5CFF",
  containerBg: "#111113",
  containerBorder: "#2A2A2E",
  borderWidth: 1,
  cornerRadius: 16,
  padding: 14,
  outerSpacing: 8,
  shadow: false,
  titleColor: "#FFFFFF",
  subtitleColor: "#9A9AA0",
  tabCornerRadius: 10,
  tabSpacing: 8,
  alignment: "leading", // leading | center | trailing
  dividerVisible: true,
};

const COLOR_TARGETS = new Set([
  "activeTabBg", "activeTabText", "inactiveTabBg", "inactiveTabText", "indicatorColor",
  "containerBg", "containerBorder", "titleColor", "subtitleColor",
]);
const NUMBER_TARGETS = {
  borderWidth: [0, 8], cornerRadius: [0, 40], padding: [0, 40],
  outerSpacing: [0, 40], tabCornerRadius: [0, 24], tabSpacing: [0, 32],
};
const BOOL_TARGETS = new Set(["showContainer", "showHeader", "shadow", "dividerVisible"]);
const TEXT_TARGETS = new Set(["title", "subtitle", "icon"]);
const BAR_STYLES = new Set(["filled", "underlined", "segmented", "minimal"]);
const ALIGNMENTS = new Set(["leading", "center", "trailing"]);
const TAB_HOLD_MS = 550;
const TAB_PRESS_SLOP = 10;

const tabsSurfaces = new WeakMap();
export function tabsSurface(element) { return tabsSurfaces.get(element); }

const freshID = () => globalThis.crypto.randomUUID();
const validColor = value =>
  typeof value === "string" && /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value.trim()) ? value.trim() : null;
const colorOr = (value, fallback) => validColor(value) || fallback;
const clampNumber = (value, [lo, hi], fallback) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
};
const asBool = (value, fallback) =>
  typeof value === "boolean" ? value : value === "true" ? true : value === "false" ? false : fallback;
const asText = value => (typeof value === "string" ? value.slice(0, 240) : "");

function appearance(attrs) {
  const out = {
    showContainer: asBool(attrs.showContainer, TABS_DEFAULTS.showContainer),
    showHeader: asBool(attrs.showHeader, TABS_DEFAULTS.showHeader),
    shadow: asBool(attrs.shadow, TABS_DEFAULTS.shadow),
    dividerVisible: asBool(attrs.dividerVisible, TABS_DEFAULTS.dividerVisible),
    title: asText(attrs.title),
    subtitle: asText(attrs.subtitle),
    icon: asText(attrs.icon),
    tabBarStyle: BAR_STYLES.has(attrs.tabBarStyle) ? attrs.tabBarStyle : TABS_DEFAULTS.tabBarStyle,
    alignment: ALIGNMENTS.has(attrs.alignment) ? attrs.alignment : TABS_DEFAULTS.alignment,
  };
  for (const key of COLOR_TARGETS) out[key] = colorOr(attrs[key], TABS_DEFAULTS[key]);
  for (const key of Object.keys(NUMBER_TARGETS)) out[key] = clampNumber(attrs[key], NUMBER_TARGETS[key], TABS_DEFAULTS[key]);
  return out;
}

function tabsHTMLAttributes(attrs) {
  const a = appearance(attrs);
  const style =
    `--pt-active-bg:${a.activeTabBg};--pt-active-text:${a.activeTabText};` +
    `--pt-inactive-bg:${a.inactiveTabBg};--pt-inactive-text:${a.inactiveTabText};` +
    `--pt-indicator:${a.indicatorColor};--pt-container-bg:${a.containerBg};` +
    `--pt-container-border:${a.containerBorder};--pt-border-width:${a.borderWidth}px;` +
    `--pt-corner:${a.cornerRadius}px;--pt-padding:${a.padding}px;--pt-outer:${a.outerSpacing}px;` +
    `--pt-title-color:${a.titleColor};--pt-subtitle-color:${a.subtitleColor};` +
    `--pt-tab-corner:${a.tabCornerRadius}px;--pt-tab-spacing:${a.tabSpacing}px`;
  return {
    class: "penned-tabs",
    "data-tabs": "",
    "data-vellix-block-id": typeof attrs.id === "string" && attrs.id.trim() ? attrs.id : undefined,
    "data-active-tab": typeof attrs.activeTab === "string" ? attrs.activeTab : undefined,
    "data-pt-style": a.tabBarStyle,
    "data-pt-align": a.alignment,
    "data-pt-container": a.showContainer ? "true" : "false",
    "data-pt-header": a.showHeader ? "true" : "false",
    "data-pt-shadow": a.shadow ? "true" : "false",
    "data-pt-divider": a.dividerVisible ? "true" : "false",
    style,
  };
}

function emptyParagraph() {
  return { type: "paragraph", attrs: { id: freshID() } };
}
function defaultPanel(name) {
  return { type: "tabPanel", attrs: { id: freshID(), name }, content: [emptyParagraph()] };
}
export function tabsJSON(attrs = {}) {
  const panels = ["Overview", "Details", "Notes"].map(defaultPanel);
  return {
    type: "tabs",
    attrs: { id: freshID(), activeTab: panels[0].attrs.id, ...TABS_DEFAULTS, ...attrs },
    content: panels,
  };
}

// Deep-clone a panel's JSON, assigning fresh ids to the panel and every nested
// block so a duplicated tab is fully independent of the original.
function cloneWithFreshIds(json) {
  if (Array.isArray(json)) return json.map(cloneWithFreshIds);
  if (json && typeof json === "object") {
    const copy = {};
    for (const [key, value] of Object.entries(json)) {
      if (key === "attrs" && value && typeof value === "object") {
        const attrs = { ...value };
        if (Object.prototype.hasOwnProperty.call(attrs, "id")) attrs.id = freshID();
        copy.attrs = attrs;
      } else {
        copy[key] = cloneWithFreshIds(value);
      }
    }
    return copy;
  }
  return json;
}

export function createTabs({ post, snapshot, selectionActive, reportHeight }) {
  const notifySaved = () => { try { post("snapshot", snapshot()); } catch (_e) {} };

  const tabs = Node.create({
    name: "tabs",
    group: "block",
    content: "tabPanel+",
    isolating: true,
    defining: true,
    selectable: true,
    addAttributes() {
      const attrs = {
        id: {
          default: null,
          parseHTML: element => element.getAttribute("data-vellix-block-id"),
          renderHTML: () => ({}),
        },
        activeTab: {
          default: null,
          parseHTML: element => element.getAttribute("data-active-tab"),
          renderHTML: () => ({}),
        },
      };
      const simple = (name, parse) => ({
        default: TABS_DEFAULTS[name],
        parseHTML: element => parse(element.getAttribute(`data-pt-${name}`)),
        renderHTML: () => ({}),
      });
      attrs.showContainer = simple("showContainer", v => asBool(v, TABS_DEFAULTS.showContainer));
      attrs.showHeader = simple("showHeader", v => asBool(v, TABS_DEFAULTS.showHeader));
      attrs.shadow = simple("shadow", v => asBool(v, TABS_DEFAULTS.shadow));
      attrs.dividerVisible = simple("dividerVisible", v => asBool(v, TABS_DEFAULTS.dividerVisible));
      attrs.title = simple("title", v => asText(v));
      attrs.subtitle = simple("subtitle", v => asText(v));
      attrs.icon = simple("icon", v => asText(v));
      attrs.tabBarStyle = simple("tabBarStyle", v => (BAR_STYLES.has(v) ? v : TABS_DEFAULTS.tabBarStyle));
      attrs.alignment = simple("alignment", v => (ALIGNMENTS.has(v) ? v : TABS_DEFAULTS.alignment));
      for (const key of COLOR_TARGETS) attrs[key] = simple(key, v => colorOr(v, TABS_DEFAULTS[key]));
      for (const key of Object.keys(NUMBER_TARGETS)) attrs[key] = simple(key, v => clampNumber(v, NUMBER_TARGETS[key], TABS_DEFAULTS[key]));
      return attrs;
    },
    parseHTML() { return [{ tag: "div[data-tabs]" }]; },
    renderHTML({ node, HTMLAttributes }) {
      return ["div", mergeAttributes(HTMLAttributes, tabsHTMLAttributes(node.attrs)), 0];
    },
    addNodeView() {
      return ({ node, getPos, editor }) => {
        let current = node;
        let temporaryTab = null;
        let barSignature = "";
        let headerSignature = "";
        let tabPress = null;

        const cancelTabPress = (pointerID = tabPress?.pointerID) => {
          if (!tabPress || tabPress.pointerID !== pointerID) return;
          clearTimeout(tabPress.timer);
          tabPress = null;
        };

        const dom = document.createElement("div");
        dom.className = "penned-tabs";
        const header = document.createElement("div");
        header.className = "penned-tabs-header";
        header.setAttribute("contenteditable", "false");
        const bar = document.createElement("div");
        bar.className = "penned-tabs-bar";
        bar.setAttribute("contenteditable", "false");
        const content = document.createElement("div");
        content.className = "penned-tab-panels";
        dom.append(header, bar, content);

        const applyAttrs = attrs => {
          for (const [name, value] of Object.entries(tabsHTMLAttributes(attrs))) {
            // Never rewrite `class`: ProseMirror toggles the block-selection
            // class (`penned-block-selected`) on this element via classList, and
            // a wholesale reset here would wipe the selection highlight.
            if (name === "class" || name === "data-active-tab") continue;
            if (value == null) dom.removeAttribute(name);
            else if (dom.getAttribute(name) !== value) dom.setAttribute(name, value);
          }
        };

        const buildHeader = attrs => {
          const a = appearance(attrs);
          const signature = `${a.showHeader}|${a.icon}|${a.title}|${a.subtitle}`;
          if (signature === headerSignature) return;
          headerSignature = signature;
          header.textContent = "";
          header.style.display = a.showHeader ? "" : "none";
          if (!a.showHeader) return;
          if (a.icon) {
            const icon = document.createElement("span");
            icon.className = "penned-tabs-header-icon";
            icon.setAttribute("aria-hidden", "true");
            // Same asset pipeline the collection/header blocks use: a mask-image
            // sourced from the Swift-injected `--vellix-asset-<name>` var (falling
            // back to the vellix-icon:// scheme handler); the tint is the element's
            // own background-color, set in CSS.
            const mask = `var(${iconAssetCSSVariable(a.icon)}, url("vellix-icon://asset/${encodeURIComponent(a.icon)}?tint=%23FFFFFF&size=24"))`;
            icon.style.maskImage = icon.style.webkitMaskImage = mask;
            header.append(icon);
          }
          const text = document.createElement("div");
          text.className = "penned-tabs-header-text";
          const title = document.createElement("div");
          title.className = "penned-tabs-title";
          title.textContent = a.title || "Untitled";
          text.append(title);
          if (a.subtitle) {
            const sub = document.createElement("div");
            sub.className = "penned-tabs-subtitle";
            sub.textContent = a.subtitle;
            text.append(sub);
          }
          header.append(text);
        };

        const visibleTab = node => {
          const ids = [];
          node.forEach(panel => ids.push(panel.attrs.id));
          return ids.includes(temporaryTab) ? temporaryTab
            : ids.includes(node.attrs.activeTab) ? node.attrs.activeTab : ids[0] ?? null;
        };
        const buildBar = node => {
          const labels = [];
          node.forEach(panel => {
            if (panel.type.name !== "tabPanel") return;
            const title = typeof panel.attrs.name === "string" ? panel.attrs.name : "";
            labels.push([panel.attrs.id, title]);
          });
          const signature = JSON.stringify(labels);
          if (signature === barSignature) return;
          barSignature = signature;
          cancelTabPress();
          bar.textContent = "";
          labels.forEach(([id, title], index) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "penned-tab";
            btn.dataset.tabId = id;
            btn.textContent = title.trim() ? title : `Tab ${index + 1}`;
            bar.append(btn);
          });
        };

        const syncActive = node => {
          const active = visibleTab(node);
          buildBar(node);
          for (const button of bar.children) {
            button.toggleAttribute("data-active", button.dataset.tabId === active);
          }
          if (active) {
            if (dom.dataset.activeTab !== active) dom.dataset.activeTab = active;
          }
          else dom.removeAttribute("data-active-tab");
          const panels = content.querySelectorAll(":scope > .penned-tab-panel");
          panels.forEach(el => el.toggleAttribute("data-active", el.getAttribute("data-tab-id") === active));
        };

        const blockID = () => current.attrs.id;
        const canOpenSettings = event => editor.isEditable && !selectionActive() &&
          !editor.view.composing && !window.PennedBlockSelection?.consumesClick(event);
        const onContainerChrome = event => event.target === dom || header.contains(event.target);
        const tabButton = target => {
          const button = target?.closest?.("button.penned-tab");
          return button?.parentElement === bar ? button : null;
        };
        const preventTabDefault = event => {
          event.preventDefault();
          event.stopPropagation();
        };

        const switchTab = (button, event) => {
          if (!dom.isConnected || button.parentElement !== bar || selectionActive() ||
              window.PennedBlockSelection?.consumesClick(event)) return;
          const id = button.dataset.tabId;
          const pos = getPos();
          if (!Number.isInteger(pos) || typeof id !== "string") return;
          const liveNode = editor.state.doc.nodeAt(pos);
          if (liveNode?.type.name !== "tabs" || visibleTab(liveNode) === id) return;
          let containsTab = false;
          liveNode.forEach(panel => { if (panel.attrs.id === id) containsTab = true; });
          if (!containsTab) return;
          // Switching a tab is navigation only. Drop focus and clear the native
          // selection BEFORE switching: once the outgoing panel is
          // hidden, WebKit would
          // otherwise relocate a caret left inside it to the end of the
          // document. Removing the anchor first keeps the caret from jumping.
          // Tapping actual panel content afterwards establishes its own caret.
          editor.view.dom.blur();
          try {
            const view = dom.ownerDocument && dom.ownerDocument.defaultView;
            const sel = view ? view.getSelection() : null;
            if (sel) sel.removeAllRanges();
          } catch (_e) {}
          temporaryTab = id;
          syncActive(liveNode);
          reportHeight();
        };
        const openTabSettings = (button, event) => {
          if (!dom.isConnected || dom.ownerDocument.hidden || button.parentElement !== bar ||
              editor.isDestroyed || !canOpenSettings(event)) return false;
          return publishSettings(editor, blockID());
        };
        const withinPressSlop = (press, event) =>
          Math.hypot(event.clientX - press.x, event.clientY - press.y) <= TAB_PRESS_SLOP;
        bar.addEventListener("pointerdown", event => {
          if (!event.isPrimary) { cancelTabPress(); return; }
          const button = tabButton(event.target);
          if (!button || event.button !== 0 || selectionActive()) return;
          preventTabDefault(event);
          cancelTabPress();
          const press = { button, pointerID: event.pointerId, started: event.timeStamp,
            x: event.clientX, y: event.clientY, held: false, timer: null };
          tabPress = press;
          // WebKit's accessibility activation can synthesize pointer events
          // without a capturable native pointer.
          try { button.setPointerCapture(event.pointerId); } catch {}
          press.timer = setTimeout(() => {
            if (tabPress === press) press.held = openTabSettings(button, event);
          }, TAB_HOLD_MS);
        });
        bar.addEventListener("pointermove", event => {
          if (tabPress?.pointerID === event.pointerId && !withinPressSlop(tabPress, event)) cancelTabPress();
        });
        bar.addEventListener("pointerup", event => {
          const press = tabPress;
          if (!press || press.pointerID !== event.pointerId) return;
          cancelTabPress();
          preventTabDefault(event);
          if (press.held || !withinPressSlop(press, event) ||
              tabButton(dom.ownerDocument.elementFromPoint(event.clientX, event.clientY)) !== press.button) return;
          if (event.timeStamp - press.started >= TAB_HOLD_MS) {
            openTabSettings(press.button, event);
            return;
          }
          switchTab(press.button, event);
        });
        for (const name of ["pointercancel", "lostpointercapture"]) {
          bar.addEventListener(name, event => cancelTabPress(event.pointerId));
        }
        bar.addEventListener("pointerout", event => {
          if (tabPress?.pointerID === event.pointerId && !tabPress.button.contains(event.relatedTarget)) cancelTabPress();
        });
        bar.addEventListener("click", event => {
          const button = tabButton(event.target);
          if (!button || selectionActive()) return;
          preventTabDefault(event);
          // Pointer activation was already handled on release. Keep the native
          // button's non-pointer activation for keyboards and assistive tech.
          if (event.detail === 0 && !event.pointerType) switchTab(button, event);
        });
        bar.addEventListener("keydown", event => {
          if ((event.key === "Enter" || event.key === " ") && tabButton(event.target) && !selectionActive()) event.stopPropagation();
        });
        bar.addEventListener("contextmenu", event => {
          if (tabButton(event.target) && !selectionActive()) preventTabDefault(event);
        });
        // Cancel WebKit's synthesized mousedown as well as pointerdown so
        // tapping chrome never makes the editable surface take focus.
        dom.addEventListener("pointerdown", event => {
          if (event.button === 0 && onContainerChrome(event)) event.preventDefault();
        });
        dom.addEventListener("mousedown", event => {
          if (event.button === 0 && (onContainerChrome(event) || bar.contains(event.target))) event.preventDefault();
        });
        dom.addEventListener("click", event => {
          if (event.button !== 0 || !onContainerChrome(event) || !canOpenSettings(event)) return;
          event.preventDefault();
          event.stopPropagation();
          if (event.target === dom && dom.dataset.ptContainer === "true") publishSettings(editor, blockID());
        });

        applyAttrs(current.attrs);
        buildHeader(current.attrs);
        syncActive(current);
        // ProseMirror mounts contentDOM children after constructing the node view.
        queueMicrotask(() => { if (dom.isConnected) syncActive(current); });

        tabsSurfaces.set(dom, { getPos, blockID, resetNavigation() {
          cancelTabPress();
          if (temporaryTab === null) return false;
          temporaryTab = null;
          syncActive(current);
          return true;
        } });

        return {
          dom,
          contentDOM: content,
          update(next) {
            if (next.type !== current.type) return false;
            let panelsChanged = next.childCount !== current.childCount;
            for (let index = 0; !panelsChanged && index < next.childCount; index++) {
              panelsChanged = next.child(index).attrs !== current.child(index).attrs;
            }
            if (next.attrs.id !== current.attrs.id || next.attrs.activeTab !== current.attrs.activeTab) {
              cancelTabPress();
              temporaryTab = null;
            }
            if (next.attrs !== current.attrs || panelsChanged) {
              applyAttrs(next.attrs);
              buildHeader(next.attrs);
              syncActive(next);
              if (panelsChanged) queueMicrotask(() => { if (dom.isConnected) syncActive(current); });
            }
            current = next;

            return true;
          },
          ignoreMutation(mutation) {
            if (mutation.target === bar || mutation.target === header) return true;
            if (bar.contains(mutation.target) || header.contains(mutation.target)) return true;
            if (mutation.type === "attributes" && mutation.attributeName === "data-active") return true;
            return mutation.type === "attributes" && mutation.target === dom;
          },
          stopEvent(event) {
            // Stop only chrome gestures, not key or clipboard events routed to
            // the editor root. Panel content always remains editable.
            return /^(?:pointer|mouse|touch|click|dblclick|contextmenu)/.test(event.type) &&
              (onContainerChrome(event) || bar.contains(event.target));
          },
          destroy() { cancelTabPress(); tabsSurfaces.delete(dom); },
        };
      };
    },
  });

  const tabPanel = Node.create({
    name: "tabPanel",
    content: "block+",
    isolating: true,
    defining: true,
    selectable: false,
    addAttributes() {
      return {
        id: {
          default: null,
          parseHTML: element => element.getAttribute("data-tab-id"),
          renderHTML: attrs => (typeof attrs.id === "string" && attrs.id ? { "data-tab-id": attrs.id } : {}),
        },
        name: {
          default: "",
          parseHTML: element => element.getAttribute("data-tab-name") || "",
          renderHTML: attrs => (attrs.name ? { "data-tab-name": attrs.name } : {}),
        },
      };
    },
    parseHTML() { return [{ tag: "div[data-tab-panel]" }]; },
    renderHTML({ node, HTMLAttributes }) {
      return ["div", mergeAttributes(HTMLAttributes, {
        class: "penned-tab-panel",
        "data-tab-panel": "",
        "data-tab-id": typeof node.attrs.id === "string" ? node.attrs.id : undefined,
      }), 0];
    },
    addNodeView() {
      return ({ node }) => {
        const { dom, contentDOM } = DOMSerializer.renderSpec(document, node.type.spec.toDOM(node));
        return { dom, contentDOM, ignoreMutation: mutation =>
          mutation.type === "attributes" && mutation.target === dom && mutation.attributeName === "data-active" };
      };
    },
  });

  function findTabs(editor, blockID) {
    if (typeof blockID !== "string" || !blockID) return null;
    const dom = editor.view.dom.querySelector(`[data-tabs][data-vellix-block-id="${CSS.escape(blockID)}"]`);
    const pos = tabsSurface(dom)?.getPos?.();
    const liveNode = Number.isInteger(pos) ? editor.state.doc.nodeAt(pos) : null;
    if (liveNode?.type.name === "tabs" && liveNode.attrs.id === blockID) return { node: liveNode, pos };
    let match = null;
    editor.state.doc.descendants((node, pos) => {
      if (match) return false;
      if (node.type.name !== "tabs") return !node.isLeaf;
      if (node.attrs.id === blockID) match = { node, pos };
      return false;
    });
    return match;
  }

  function panelPositions(block) {
    const panels = [];
    block.node.forEach((panel, offset, index) => {
      if (panel.type.name === "tabPanel") panels.push({ node: panel, pos: block.pos + 1 + offset, index });
    });
    return panels;
  }

  function resolveActive(block) {
    const panels = panelPositions(block);
    const active = block.node.attrs.activeTab;
    if (panels.some(p => p.node.attrs.id === active)) return active;
    return panels[0]?.node.attrs.id ?? null;
  }

  function publishSettings(editor, blockID) {
    const block = findTabs(editor, blockID);
    if (!block) return false;
    const a = appearance(block.node.attrs);
    const tabs = panelPositions(block).map(({ node }, index) => ({
      id: node.attrs.id,
      name: node.attrs.name && node.attrs.name.trim() ? node.attrs.name : `Tab ${index + 1}`,
    }));
    post("tabsSettings", {
      blockId: blockID,
      activeTab: resolveActive(block),
      tabs,
      defaults: { ...TABS_DEFAULTS },
      ...a,
    });
    return true;
  }

  function setAttrs(editor, blockID, patch) {
    const block = findTabs(editor, blockID);
    if (!block) return false;
    const changes = Object.entries(patch).filter(([key, value]) => block.node.attrs[key] !== value);
    if (!changes.length) return true;
    const tr = closeHistory(editor.state.tr);
    for (const [key, value] of changes) tr.setNodeAttribute(block.pos, key, value);
    editor.view.dispatch(tr);
    notifySaved();
    return true;
  }

  function sanitizeAttr(key, value) {
    if (COLOR_TARGETS.has(key)) return validColor(value);
    if (Object.prototype.hasOwnProperty.call(NUMBER_TARGETS, key)) return clampNumber(value, NUMBER_TARGETS[key], TABS_DEFAULTS[key]);
    if (BOOL_TARGETS.has(key)) return asBool(value, TABS_DEFAULTS[key]);
    if (TEXT_TARGETS.has(key)) return asText(value);
    if (key === "tabBarStyle") return BAR_STYLES.has(value) ? value : null;
    if (key === "alignment") return ALIGNMENTS.has(value) ? value : null;
    return undefined;
  }

  function command(editor, name, args = {}) {
    if (typeof name !== "string" || !name.startsWith("tabs")) return undefined;

    if (name === "tabsResetNavigation") {
      let changed = false;
      for (const dom of editor.view.dom.querySelectorAll("[data-tabs]")) {
        if (tabsSurface(dom)?.resetNavigation()) changed = true;
      }
      if (changed) reportHeight();
      return true;
    }

    if (name === "tabsRequestSelectedSettings") {
      let id = null;
      const { $from } = editor.state.selection;
      for (let depth = $from.depth; depth >= 0; depth--) {
        const node = $from.node(depth);
        if (node.type.name === "tabs") { id = node.attrs.id; break; }
      }
      return id ? publishSettings(editor, id) : false;
    }
    if (name === "tabsRequestSettings") return publishSettings(editor, args.blockId);

    if (!editor.isEditable || selectionActive()) return false;

    if (name === "tabsAddToSelection") {
      let id = null;
      const { $from } = editor.state.selection;
      for (let depth = $from.depth; depth >= 0; depth--) {
        const node = $from.node(depth);
        if (node.type.name === "tabs") { id = node.attrs.id; break; }
      }
      return id ? command(editor, "tabsAddTab", { blockId: id }) : false;
    }

    if (name === "tabsSetAttr") {
      const value = sanitizeAttr(args.key, args.value);
      if (value === undefined || value === null) return false;
      return setAttrs(editor, args.blockId, { [args.key]: value });
    }

    if (name === "tabsSetDefaultTab") {
      const block = findTabs(editor, args.blockId);
      if (!block) return false;
      if (!panelPositions(block).some(p => p.node.attrs.id === args.tabId)) return false;
      return setAttrs(editor, args.blockId, { activeTab: args.tabId });
    }

    if (name === "tabsAddTab") {
      const block = findTabs(editor, args.blockId);
      if (!block) return false;
      const count = panelPositions(block).length;
      const panel = defaultPanel(typeof args.name === "string" && args.name.trim() ? args.name.trim() : `Tab ${count + 1}`);
      const node = editor.schema.nodeFromJSON(panel);
      const insertAt = block.pos + block.node.nodeSize - 1;
      const tr = closeHistory(editor.state.tr).insert(insertAt, node);
      editor.view.dispatch(tr);
      notifySaved();
      return panel.attrs.id;
    }

    if (name === "tabsRenameTab") {
      const block = findTabs(editor, args.blockId);
      if (!block) return false;
      const panel = panelPositions(block).find(p => p.node.attrs.id === args.tabId);
      if (!panel) return false;
      const value = asText(args.name);
      if (value === panel.node.attrs.name) return true;
      editor.view.dispatch(closeHistory(editor.state.tr).setNodeAttribute(panel.pos, "name", value));
      notifySaved();
      return true;
    }

    if (name === "tabsDuplicateTab") {
      const block = findTabs(editor, args.blockId);
      if (!block) return false;
      const panel = panelPositions(block).find(p => p.node.attrs.id === args.tabId);
      if (!panel) return false;
      const clone = cloneWithFreshIds(panel.node.toJSON());
      clone.attrs = { ...clone.attrs, name: `${panel.node.attrs.name || "Tab"} copy` };
      const node = editor.schema.nodeFromJSON(clone);
      const insertAt = panel.pos + panel.node.nodeSize;
      editor.view.dispatch(closeHistory(editor.state.tr).insert(insertAt, node));
      notifySaved();
      return clone.attrs.id;
    }

    if (name === "tabsRemoveTab") {
      const block = findTabs(editor, args.blockId);
      if (!block) return false;
      const panels = panelPositions(block);
      const target = panels.find(p => p.node.attrs.id === args.tabId);
      if (!target) return false;
      const tr = closeHistory(editor.state.tr);
      if (panels.length <= 1) {
        tr.delete(block.pos, block.pos + block.node.nodeSize);
        editor.view.dispatch(tr);
        notifySaved();
        return true;
      }
      tr.delete(target.pos, target.pos + target.node.nodeSize);
      if (block.node.attrs.activeTab === args.tabId) {
        const fallback = panels[target.index + 1] ?? panels[target.index - 1];
        if (fallback) tr.setNodeAttribute(block.pos, "activeTab", fallback.node.attrs.id);
      }
      editor.view.dispatch(tr);
      notifySaved();
      return true;
    }

    if (name === "tabsReorderTabs") {
      const block = findTabs(editor, args.blockId);
      if (!block || !Array.isArray(args.order)) return false;
      const panels = panelPositions(block);
      if (args.order.length !== panels.length) return false;
      const byID = new Map(panels.map(p => [p.node.attrs.id, p.node]));
      const ordered = args.order.map(id => byID.get(id));
      if (ordered.some(node => !node)) return false;
      const fragment = ordered.map(node => node.toJSON());
      const tr = closeHistory(editor.state.tr);
      tr.replaceWith(block.pos + 1, block.pos + block.node.nodeSize - 1,
        ordered.map(node => node));
      editor.view.dispatch(tr);
      notifySaved();
      return true;
    }

    return false;
  }

  // Keep the block structurally valid: drop a tabs node that somehow lost every
  // panel, and repair an activeTab that points at a tab that no longer exists.
  const guardKey = new PluginKey("vellixTabsGuard");
  const guard = new Plugin({
    key: guardKey,
    appendTransaction(transactions, _old, state) {
      if (!transactions.some(tr => tr.docChanged && !inlineTextEdit(tr))) return null;
      let tr = null;
      const empties = [];
      state.doc.descendants((node, pos) => {
        if (node.type.name !== "tabs") return node.type.name === "doc" || !node.isLeaf;
        if (node.childCount === 0) { empties.push(pos); return false; }
        const ids = [];
        node.forEach(panel => { if (panel.type.name === "tabPanel") ids.push(panel.attrs.id); });
        if (!ids.includes(node.attrs.activeTab) && ids.length) {
          tr = tr || state.tr;
          tr.setNodeAttribute(pos, "activeTab", ids[0]);
        }
        return false;
      });
      if (empties.length) {
        tr = tr || state.tr;
        for (const pos of empties.sort((a, b) => b - a)) {
          const node = tr.doc.nodeAt(pos);
          if (node) tr.delete(pos, pos + node.nodeSize);
        }
      }
      return tr && tr.docChanged ? tr.setMeta("addToHistory", false) : null;
    },
  });

  return { nodes: [tabs, tabPanel], plugins: [guard], command, tabsJSON };
}
