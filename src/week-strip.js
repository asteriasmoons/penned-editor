// Week Strip — date-indexed, independently editable panels.
// Stage 1: document schema and initial seven-day content. Navigation and UI
// are separate stages; date keys remain stable independently of the visible week.
import { Node, mergeAttributes } from "@tiptap/core";
import { DOMSerializer } from "@tiptap/pm/model";
import { syncWeekDayPanels } from "./week-strip-visibility.js";
import { ensureCalendarInsertionSelection, rememberActiveCalendar, appendParagraphToCalendarDate } from "./calendar-insertion-target.js";
import { weekStripChromeEvent, weekStripSettingsAllowed } from "./calendar-block-editor-mode.js";
import { WEEK_STRIP_DEFAULTS, sanitizeWeekStripSetting, weekStripOpenDate } from "./week-strip-settings.js";
import { dateFromKey, shiftWeekDateKey, formatWeekRange } from "./week-strip-model.js";

const newID = () => globalThis.crypto.randomUUID();
import { localDateKey, validDateKey, weekDateKeys, ensureWeekPanels } from "./week-strip-model.js";
export { localDateKey, validDateKey, weekDateKeys, ensureWeekPanels };
const panelForDate = date => ({
  type: "weekDayPanel",
  attrs: { id: newID(), date },
  content: [{ type: "paragraph", attrs: { id: newID() } }],
});
export const navigateWeekStripJSON = (block, date) => {
  const key = date instanceof Date ? localDateKey(date) : date;
  if (!validDateKey(key)) throw new RangeError("Invalid selected date");
  const firstDayOfWeek = block.attrs?.firstDayOfWeek ?? 0;
  const updated = ensureWeekPanels(block, key, firstDayOfWeek, panelForDate);
  return { ...updated, attrs: { ...updated.attrs, selectedDate: key } };
};
export const weekStripJSON = ({ selectedDate = new Date(), firstDayOfWeek = 0 } = {}) => {
  const selected = localDateKey(selectedDate);
  const dates = weekDateKeys(selectedDate, firstDayOfWeek);
  return {
    type: "weekStrip",
    attrs: { id: newID(), selectedDate: selected, ...WEEK_STRIP_DEFAULTS, firstDayOfWeek },
    content: dates.map(panelForDate),
  };
};

export const WeekStrip = Node.create({
  name: "weekStrip",
  addOptions() { return { post: null, reportHeight: null }; },
  group: "block",
  content: "weekDayPanel+",
  isolating: true,
  defining: true,
  selectable: true,
  addAttributes() {
    return {
      id: { default: null, parseHTML: el => el.getAttribute("data-vellix-block-id") },
      selectedDate: { default: null, parseHTML: el => el.getAttribute("data-selected-date") },
      ...Object.fromEntries(Object.entries(WEEK_STRIP_DEFAULTS).map(([key, fallback]) => [key, {
        default: fallback,
        parseHTML: el => sanitizeWeekStripSetting(key, el.getAttribute(`data-week-${key}`)) ?? fallback,
      }])),
    };
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      let current = node;
      let temporaryDate = null;
      const logCalendar = (stage, details = {}) => {
        // Follow the existing tabsDiagnostic bridge. Only metadata is logged,
        // never document text, calendar account details, or event identities.
        this.options.post?.("calendarDiagnostic", {
          stage, blockID: current.attrs.id || "", ...details,
        });
      };
      const summarizePanels = (block = current) => {
        const summary = [];
        block.forEach(panel => summary.push({
          date: panel.attrs.date,
          id: panel.attrs.id,
          count: panel.childCount,
          types: panel.content.content.map(child => child.type.name),
        }));
        return summary;
      };
      const today = localDateKey(new Date());
      let selected = weekStripOpenDate(node.attrs, today);
      if (!validDateKey(selected)) selected = today;
      const shouldSelectToday = node.attrs.selectedDateBehavior === "today" && node.attrs.selectedDate !== today;
      const dom = document.createElement("div");
      dom.className = "penned-week-strip";
      dom.setAttribute("data-week-strip", "");
      const chrome = document.createElement("div");
      chrome.className = "penned-week-strip-chrome";
      chrome.contentEditable = "false";
      const previous = document.createElement("button");
      previous.type = "button";
      previous.dataset.wsNav = "prev";
      previous.setAttribute("aria-label", "Previous week");
      const label = document.createElement("input");
      label.type = "text";
      label.placeholder = "Calendar";
      label.maxLength = 240;
      label.enterKeyHint = "done";
      label.setAttribute("aria-label", "Calendar title");
      const next = document.createElement("button");
      next.type = "button";
      next.dataset.wsNav = "next";
      next.setAttribute("aria-label", "Next week");
      const disclosure = document.createElement("button");
      disclosure.type = "button";
      disclosure.className = "penned-week-strip-nav penned-week-strip-collapse";
      const days = document.createElement("div");
      days.className = "penned-week-strip-days";
      const content = document.createElement("div");
      content.className = "penned-week-strip-panels";
      const header = document.createElement("div");
      header.className = "penned-week-strip-header";
      label.className = "penned-week-strip-title";
      previous.className = "penned-week-strip-nav";
      next.className = "penned-week-strip-nav";
      for (const button of [previous, next, disclosure]) {
        const glass = document.createElement("span");
        glass.className = "penned-label-glass-material";
        glass.setAttribute("aria-hidden", "true");
        button.append(glass);
      }
      header.append(previous, label, disclosure, next);
      // Only empty header space initiates settings. Title editing and arrow
      // buttons retain their own interaction without starting a long press.
      let headerPress = null;
      const cancelHeaderPress = () => {
        if (headerPress?.timer) clearTimeout(headerPress.timer);
        headerPress = null;
      };
      header.addEventListener("pointerdown", event => {
        if (!event.isPrimary || event.button !== 0 || event.target.closest("button, input")) return;
        if (window.PennedBlockDragAndDrop?.allowBlockHold(event, "calendar-header-settings") === false) return;
        cancelHeaderPress();
        const press = { id: event.pointerId, x: event.clientX, y: event.clientY, fired: false, timer: null };
        headerPress = press;
        press.timer = setTimeout(() => {
          if (headerPress !== press || !dom.isConnected || !weekStripSettingsAllowed(editor.isEditable)) return;
          const blockID = current.attrs.id;
          if (!blockID) return;
          press.fired = true;
          this.options.post?.("weekStripSettings", {
            blockId: blockID,
            settings: Object.fromEntries(Object.keys(WEEK_STRIP_DEFAULTS).map(key => [key, current.attrs[key]])),
          });
        }, 550);
      });
      header.addEventListener("pointermove", event => {
        if (headerPress?.id === event.pointerId && Math.hypot(event.clientX - headerPress.x, event.clientY - headerPress.y) > 10) cancelHeaderPress();
      });
      for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) {
        header.addEventListener(name, event => {
          if (headerPress?.id === event.pointerId) cancelHeaderPress();
        });
      }
      header.addEventListener("contextmenu", event => {
        if (event.target.closest("button, input")) return;
        event.preventDefault();
        // Avoid a second native menu after the long-press sheet is requested.
      });
      chrome.append(header, days);
      dom.append(chrome, content);
      const visibleDate = () => {
        const dates = new Set();
        current.forEach(panel => dates.add(panel.attrs.date));
        return dates.has(temporaryDate) ? temporaryDate
          : validDateKey(current.attrs.selectedDate) ? current.attrs.selectedDate : selected;
      };
      const syncActive = () => {
        const active = visibleDate();
        const state = syncWeekDayPanels(content, active);
        if (active) dom.dataset.activeDate = active;
        else dom.removeAttribute("data-active-date");
        return state;
      };
      let renderedDateSignature = null;
      let titleComposing = false;
      const setDOMAttribute = (element, key, value) => {
        if (element.getAttribute(key) !== value) element.setAttribute(key, value);
      };
      const updateVisible = () => {
        const a = current.attrs;
        const nextBlockID = a.id || "";
        if (dom.getAttribute("data-vellix-block-id") !== nextBlockID) {
          dom.setAttribute("data-vellix-block-id", nextBlockID);
        }
        for (const [name, value] of Object.entries(a)) {
          if (!(name in WEEK_STRIP_DEFAULTS) || name === "title" || name === "collapsed") continue;
          const prop = `--ws-${name.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}`;
          const nextValue = typeof value === "number" && !["fontWeight", "firstDayOfWeek"].includes(name) ? `${value}px` : String(value);
          if (dom.style.getPropertyValue(prop) !== nextValue) dom.style.setProperty(prop, nextValue);
        }
        const title = typeof a.title === "string" ? a.title : WEEK_STRIP_DEFAULTS.title;
        if (!titleComposing && label.value !== title) label.value = title;
        const collapsed = a.collapsed === true;
        setDOMAttribute(dom, "data-collapsed", String(collapsed));
        if (content.inert !== collapsed) content.inert = collapsed;
        setDOMAttribute(content, "aria-hidden", String(collapsed));
        setDOMAttribute(content, "id", `penned-calendar-content-${nextBlockID}`);
        setDOMAttribute(disclosure, "aria-controls", content.id);
        setDOMAttribute(disclosure, "aria-expanded", String(!collapsed));
        const disclosureTitle = collapsed ? "Expand calendar content" : "Collapse calendar content";
        setDOMAttribute(disclosure, "aria-label", disclosureTitle);
        setDOMAttribute(disclosure, "title", disclosureTitle);
        const keys = weekDateKeys(selected, current.attrs.firstDayOfWeek);
        const nextRangeText = formatWeekRange(keys[0], keys[6]);
        setDOMAttribute(days, "aria-label", nextRangeText);
        const dateSignature = `${selected}|${current.attrs.firstDayOfWeek}`;
        if (dateSignature !== renderedDateSignature) {
          renderedDateSignature = dateSignature;
          days.replaceChildren();
        for (const key of keys) {
          const day = dateFromKey(key);
          const button = document.createElement("button");
          button.type = "button";
          button.dataset.date = key;
          button.setAttribute("aria-pressed", String(key === selected));
          button.className = "penned-week-strip-day";
          const weekday = document.createElement("span");
          weekday.className = "penned-week-strip-weekday";
          weekday.textContent = day.toLocaleDateString(undefined, { weekday: "short" }).slice(0, 1);
          const number = document.createElement("span");
          number.className = "penned-week-strip-number";
          number.textContent = String(day.getDate());
          if (key === selected) {
            const glass = document.createElement("span");
            glass.className = "penned-label-glass-material";
            glass.setAttribute("aria-hidden", "true");
            button.append(glass);
          }
          button.append(weekday, number);
          days.append(button);
        }
        }
        // Tabs' strategy: keep every ProseMirror panel mounted and switch only
        // data-active. Never apply hidden or display:none to editable content.
        return syncActive();
      };
      const setAttribute = (key, input) => {
        if (!editor.isEditable || !dom.isConnected) return false;
        const value = sanitizeWeekStripSetting(key, input);
        const pos = getPos();
        if (value === undefined || !Number.isInteger(pos)) return false;
        const live = editor.state.doc.nodeAt(pos);
        if (live?.type.name !== "weekStrip" || live.attrs.id !== current.attrs.id) return false;
        if (live.attrs[key] !== value) editor.view.dispatch(editor.state.tr.setNodeAttribute(pos, key, value));
        return true;
      };
      const saveTitle = () => {
        if (!titleComposing && !setAttribute("title", label.value)) updateVisible();
      };
      label.addEventListener("pointerdown", () => { label.readOnly = !editor.isEditable; });
      label.addEventListener("focus", () => {
        label.readOnly = !editor.isEditable;
        if (label.readOnly) label.blur();
      });
      label.addEventListener("compositionstart", () => { titleComposing = true; });
      label.addEventListener("compositionend", () => { titleComposing = false; saveTitle(); });
      label.addEventListener("input", event => { if (!event.isComposing) saveTitle(); });
      label.addEventListener("blur", () => { titleComposing = false; saveTitle(); });
      label.addEventListener("keydown", event => {
        if (event.key === "Enter" && !event.isComposing && !titleComposing) {
          event.preventDefault();
          saveTitle();
          label.blur();
        }
      });
      disclosure.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        if (!editor.isEditable || !dom.isConnected) {
          logCalendar("collapse-blocked", { reason: !editor.isEditable ? "editor-locked" : "detached" });
          return;
        }
        label.blur();
        const collapsed = current.attrs.collapsed === true;
        logCalendar("collapse-request", { collapsed, targetCollapsed: !collapsed });
        if (!collapsed) {
          editor.view.dom.blur();
          try { dom.ownerDocument.getSelection()?.removeAllRanges(); } catch {}
        }
        const applied = setAttribute("collapsed", !collapsed);
        logCalendar("collapse-result", { applied, collapsed: current.attrs.collapsed === true,
          domCollapsed: dom.dataset.collapsed, expanded: disclosure.getAttribute("aria-expanded") });
      });
      const select = key => {
        if (!validDateKey(key) || !dom.isConnected) return;
        label.blur();
        const pos = getPos();
        if (!Number.isInteger(pos)) return;
        const live = editor.state.doc.nodeAt(pos);
        if (live?.type.name !== "weekStrip") return;
        // Dismiss the old caret before hiding its panel, as Tabs does.
        if (editor.isEditable) {
          editor.view.dom.blur();
          try { dom.ownerDocument.getSelection()?.removeAllRanges(); } catch {}
        }
        // As with Tabs, expose the destination immediately without touching
        // existing panel content. Only unvisited days require new child nodes.
        const json = navigateWeekStripJSON(live.toJSON(), key);
        const missing = json.content.slice(live.childCount);
        const before = summarizePanels(live);
        logCalendar("navigate-before", { from: selected, to: key,
          selectedDate: live.attrs.selectedDate, missing: missing.map(panel => panel.attrs.date), panels: before });
        selected = key;
        temporaryDate = key;
        const visibleBefore = updateVisible();
        logCalendar("navigate-dom-before", { date: key, ...visibleBefore });
        // Unlike Tabs, Calendar also remembers the date chosen when reopened.
        // setNodeAttribute changes just that attribute, never replaces the node.
        const tr = editor.state.tr;
        if (missing.length) {
          const nodes = missing.map(panel => editor.schema.nodeFromJSON(panel));
          tr.insert(pos + live.nodeSize - 1, nodes);
        }
        if (live.attrs.selectedDate !== key) tr.setNodeAttribute(pos, "selectedDate", key);
        // Tabs only changes panel visibility. Calendar also needs to move the
        // editor's insertion position: otherwise Add Block silently inserts
        // into the old hidden date. Every block type uses this same selection.
        if (editor.isEditable) rememberActiveCalendar(editor, live.attrs.id, key);
        const insertionTarget = editor.isEditable
          ? ensureCalendarInsertionSelection(tr, { stripPos: pos, date: key, force: true }) : null;
        if (tr.docChanged || tr.selectionSet) editor.view.dispatch(tr.setMeta("addToHistory", false));
        logCalendar("navigate-after-transaction", { date: key, insertionTarget,
          caretDate: insertionTarget?.date || null,
          panels: summarizePanels(editor.state.doc.nodeAt(pos) || current) });
        this.options.reportHeight?.();
        queueMicrotask(() => {
          if (!dom.isConnected) return;
          const visibility = updateVisible();
          logCalendar("navigate-dom-mounted", { date: key, ...visibility,
            activeDOM: content.querySelector('[data-active]')?.getAttribute('data-week-date') || null });
          this.options.reportHeight?.();
        });
      };
      // A tap on empty space beneath an Event/Page Card must establish a real
      // text caret in that date, not let WebKit restore the Infocard's caret
      // from above the Calendar. Child content taps remain untouched.
      const focusEmptyDateSurface = event => {
        if (!editor.isEditable || current.attrs.collapsed || event.button !== 0) return false;
        if (event.target !== dom && event.target !== content &&
            !(event.target.classList?.contains("penned-week-day-panel") && event.target.hasAttribute("data-active"))) return false;
        const date = visibleDate();
        const tr = editor.state.tr;
        const result = appendParagraphToCalendarDate(tr, { stripID: current.attrs.id, date });
        if (!result) return false;
        rememberActiveCalendar(editor, current.attrs.id, date);
        event.preventDefault();
        event.stopPropagation();
        editor.view.dispatch(tr.scrollIntoView());
        editor.view.focus();
        logCalendar("blank-date-caret", { date, inserted: result.inserted,
          pos: editor.state.selection.from });
        return true;
      };
      // Empty container background, including the space beneath the last
      // Event, is a valid insertion surface too; chrome/buttons are excluded.
      dom.addEventListener("pointerdown", focusEmptyDateSurface);
      // Browser/VoiceOver click activation can arrive without pointerdown.
      dom.addEventListener("click", event => {
        if (event.detail === 0) focusEmptyDateSurface(event);
      });
      chrome.addEventListener("mousedown", event => {
        if (event.button === 0 && event.target !== label) event.preventDefault();
      });
      days.addEventListener("pointerdown", event => { if (event.target.closest("button")) event.preventDefault(); });
      days.addEventListener("click", event => {
        const button = event.target.closest("button[data-date]");
        if (button) { event.preventDefault(); event.stopPropagation(); select(button.dataset.date); }
      });
      const shift = amount => {
        select(shiftWeekDateKey(selected, amount / 7));
      };
      previous.addEventListener("click", event => { event.preventDefault(); shift(-7); });
      next.addEventListener("click", event => { event.preventDefault(); shift(7); });
      updateVisible();
      logCalendar("mounted-before-content", { selectedDate: selected, panels: summarizePanels() });
      // Identical to Tabs: ProseMirror mounts contentDOM children after the
      // parent NodeView is constructed, so repeat activation after mounting.
      queueMicrotask(() => {
        if (!dom.isConnected) return;
        if (shouldSelectToday) select(today);
        else {
          const visibility = updateVisible();
          logCalendar("mounted-after-content", { date: selected, ...visibility });
        }
      });
      return {
        dom, contentDOM: content,
        update: nextNode => {
          if (nextNode.type !== current.type) return false;
          let panelsChanged = nextNode.childCount !== current.childCount;
          for (let index = 0; !panelsChanged && index < nextNode.childCount; index++) {
            panelsChanged = nextNode.child(index).attrs !== current.child(index).attrs;
          }
          const attrsChanged = nextNode.attrs !== current.attrs;
          const collapsedChanged = nextNode.attrs.collapsed !== current.attrs.collapsed;
          const dateChanged = nextNode.attrs.selectedDate !== current.attrs.selectedDate;
          if (nextNode.attrs.id !== current.attrs.id || (dateChanged && temporaryDate !== nextNode.attrs.selectedDate)) {
            temporaryDate = null;
          }
          current = nextNode;
          selected = visibleDate();
          if (attrsChanged || panelsChanged) {
            const visibility = updateVisible();
            logCalendar("nodeview-update", { date: selected, attrsChanged, dateChanged,
              panelsChanged, ...visibility, panels: summarizePanels(nextNode) });
          }
          if (collapsedChanged) this.options.reportHeight?.();
          // Child NodeViews can be remounted after rich-content edits without
          // changing any parent attributes. Like Tabs' post-mount sync, restore
          // their active marker after ProseMirror has updated contentDOM.
          queueMicrotask(() => {
            if (!dom.isConnected) return;
            const state = syncActive();
            if (panelsChanged || !state.matched) {
              logCalendar("nodeview-update-mounted", { date: selected, ...state });
            }
          });
          return true;
        },
        stopEvent: event => chrome.contains(event.target) && (event.target === label || weekStripChromeEvent(event.type)),
        // Mirror Tabs' ignoreMutation: chrome and the active-panel marker are
        // ours; ProseMirror remains responsible for every child content edit.
        ignoreMutation: mutation => chrome.contains(mutation.target) ||
          (mutation.type === "attributes" && mutation.target === dom) ||
          (mutation.type === "attributes" && mutation.target === content) ||
          (mutation.type === "attributes" && mutation.attributeName === "data-active" && mutation.target.parentElement === content),
        destroy: cancelHeaderPress,
      };
    };
  },
  parseHTML() { return [{ tag: "div[data-week-strip]" }]; },
  renderHTML({ node, HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, {
      class: "penned-week-strip",
      "data-week-strip": "",
      "data-vellix-block-id": node.attrs.id,
      "data-selected-date": node.attrs.selectedDate,
      ...Object.fromEntries(Object.keys(WEEK_STRIP_DEFAULTS).map(key => [`data-week-${key}`, node.attrs[key]])),
    }), 0];
  },
});

export const WeekDayPanel = Node.create({
  name: "weekDayPanel",
  content: "block+",
  isolating: true,
  defining: true,
  selectable: false,
  addAttributes() {
    return {
      id: { default: null, parseHTML: el => el.getAttribute("data-week-day-id") },
      date: { default: null, parseHTML: el => el.getAttribute("data-week-date") },
    };
  },
  parseHTML() { return [{ tag: "div[data-week-day-panel]" }]; },
  renderHTML({ node, HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, {
      class: "penned-week-day-panel",
      "data-week-day-panel": "",
      "data-week-day-id": node.attrs.id,
      "data-week-date": node.attrs.date,
    }), 0];
  },
  // Same ProseMirror child-panel NodeView as Tabs: retain the actual
  // contentDOM, and ignore only our data-active visibility marker.
  addNodeView() {
    return ({ node }) => {
      const { dom, contentDOM } = DOMSerializer.renderSpec(document, node.type.spec.toDOM(node));
      return { dom, contentDOM, ignoreMutation: mutation =>
        mutation.type === "attributes" && mutation.target === dom && mutation.attributeName === "data-active" };
    };
  },
});
