import { Mark, Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { closeHistory } from "@tiptap/pm/history";
import "./text-gradient-paint.js";

// The editor owns the held range. Native UI receives only an opaque token.
export function createTextColor({ Mark, Extension, Plugin, PluginKey, TextSelection, closeHistory,
  post, snapshot, selectionActive }) {
  const key = new PluginKey("vellixInlineTextColor");
  let sequence = 0;
  function color(value) {
    if (typeof value !== "string") return null;
    const hex = value.trim().match(/^#([a-f\d]{3}|[a-f\d]{6})$/i);
    if (hex) return "#" + (hex[1].length === 3 ? [...hex[1]].map(c => c + c).join("") : hex[1]).toUpperCase();
    const rgb = value.trim().match(/^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i);
    return rgb && rgb.slice(1).every(c => +c <= 255)
      ? "#" + rgb.slice(1).map(c => (+c).toString(16).padStart(2, "0")).join("").toUpperCase() : null;
  }
  function style(value) {
    if (value?.kind === "solid") {
      const start = color(value.start);
      return start ? { kind: "solid", start } : null;
    }
    if (value?.kind !== "gradient") return null;
    const start = color(value.start), end = color(value.end), angle = value.angle;
    if (!start || !end || typeof angle !== "number" || !Number.isFinite(angle)) return null;
    return { kind: "gradient", start, end, angle: ((Math.round(angle) % 360) + 360) % 360 };
  }
  function markStyle(attrs) {
    return style(attrs?.gradient ? { ...attrs.gradient, kind: "gradient" } : { kind: "solid", start: attrs?.color });
  }
  function parseGradient(element) {
    try { return style({ ...JSON.parse(element.getAttribute("data-vellix-gradient")), kind: "gradient" }); }
    catch { return null; }
  }
  const mark = Mark.create({
    name: "textStyle", priority: 50, inclusive: false,
    addAttributes() {
      return {
        color: { default: null, rendered: false, parseHTML: el => color(el.style.color) },
        gradient: { default: null, rendered: false, parseHTML: el => {
          const value = parseGradient(el);
          return value ? { start: value.start, end: value.end, angle: value.angle } : null;
        } },
      };
    },
    parseHTML() { return [{ tag: "span[data-vellix-gradient]" }, { tag: "span[style]", getAttrs: el => color(el.style.color) ? {} : false }]; },
    renderHTML({ mark }) {
      const value = markStyle(mark.attrs);
      if (value?.kind === "gradient") {
        const gradient = { start: value.start, end: value.end, angle: value.angle };
        return ["span", { "data-vellix-gradient": JSON.stringify(gradient),
          style: `background-image:linear-gradient(${value.angle}deg,${value.start},${value.end});background-clip:text;-webkit-background-clip:text;color:transparent;-webkit-text-fill-color:transparent;box-decoration-break:clone;-webkit-box-decoration-break:clone` }, 0];
      }
      return ["span", value ? { style: `color:${value.start}` } : {}, 0];
    },
  });
  function ranges(editor, from, to) {
    const result = [], markType = editor.schema.marks.textStyle;
    editor.state.doc.nodesBetween(from, to, (node, pos, parent) => {
      if (node.isText && parent.type.allowsMarkType(markType)) {
        result.push({ from: Math.max(from, pos), to: Math.min(to, pos + node.nodeSize), node });
      }
    });
    return result;
  }
  function eligible(editor) {
    const selection = editor.state.selection;
    return editor.isEditable && !selectionActive() && selection instanceof TextSelection && !selection.empty
      && ranges(editor, selection.from, selection.to).length > 0;
  }
  function currentStyle(editor, from, to) {
    const values = ranges(editor, from, to).map(({ node }) => markStyle(node.marks.find(m => m.type.name === "textStyle")?.attrs));
    const mixed = new Set(values.map(v => JSON.stringify(v))).size > 1;
    return { style: mixed ? null : values[0] ?? null, mixed };
  }
  const integration = Extension.create({
    name: "vellixTextColorSelection",
    addProseMirrorPlugins() {
      const editor = this.editor;
      return [new Plugin({ key, state: {
        init: () => null,
        apply(tr, held) {
          const meta = tr.getMeta(key);
          if (meta !== undefined) return meta;
          if (held?.tracksSelection && !tr.docChanged && tr.selectionSet && editor.isFocused
              && (tr.selection.from !== held.from || tr.selection.to !== held.to)) return null;
          if (!held || !tr.docChanged) return held;
          const from = tr.mapping.map(held.from, 1), to = tr.mapping.map(held.to, -1);
          if (to <= from || tr.doc.textBetween(from, to, "\n") !== held.text) return null;
          return { ...held, from, to };
        },
      } })];
    },
  });
  function command(editor, name, args = {}) {
    const held = key.getState(editor.state);
    if (name === "setContent" || name === "setEditable" || name === "setSelectionMode") {
      if (held) editor.view.dispatch(editor.state.tr.setMeta(key, null).setMeta("addToHistory", false));
      return undefined;
    }
    if (name === "textColorBegin") {
      if (!eligible(editor)) return null;
      const { from, to } = editor.state.selection;
      const request = { token: `text-color-${++sequence}`, from, to, text: editor.state.doc.textBetween(from, to, "\n"),
        tracksSelection: args.trackSelection === true };
      editor.view.dispatch(editor.state.tr.setMeta(key, request).setMeta("addToHistory", false));
      return { token: request.token, text: request.text, ...currentStyle(editor, from, to) };
    }
    if (name !== "textColorApply" && name !== "textColorEnd") return undefined;
    if (!held || held.token !== args.token || !editor.isEditable || selectionActive()) return false;
    const { from, to } = held;
    if (name === "textColorEnd") {
      const tr = editor.state.tr.setMeta(key, null).setMeta("addToHistory", false);
      if (args.restoreFocus) tr.setSelection(TextSelection.create(tr.doc, from, to));
      editor.view.dispatch(tr);
      if (args.restoreFocus) editor.view.focus();
      return true;
    }
    const value = args.style == null ? null : style(args.style);
    if (args.style != null && !value) return false;
    const markType = editor.schema.marks.textStyle, parts = ranges(editor, from, to);
    if (!parts.length) return false;
    const tr = closeHistory(editor.state.tr);
    const attrs = value?.kind === "gradient" ? { gradient: { start: value.start, end: value.end, angle: value.angle } }
      : { color: value?.start ?? null };
    for (const part of parts) {
      tr.removeMark(part.from, part.to, markType);
      if (value) tr.addMark(part.from, part.to, markType.create(attrs));
    }
    tr.setSelection(TextSelection.create(tr.doc, from, to));
    editor.view.dispatch(tr);
    editor.view.dispatch(closeHistory(editor.state.tr).setMeta("addToHistory", false));
    post("snapshot", snapshot());
    return true;
  }
  function formattingState(editor) {
    const canColorText = eligible(editor);
    const hasTextSelection = editor.isFocused && canColorText;
    return { hasTextSelection, canColorText, textColorToken: key.getState(editor.state)?.token ?? null, textColor: canColorText
      ? currentStyle(editor, editor.state.selection.from, editor.state.selection.to).style : null };
  }
  return { mark, integration, command, formattingState };
}

export const textColorDependencies = { Mark, Extension, Plugin, PluginKey, TextSelection, closeHistory };
