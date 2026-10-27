import { Mark, Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { closeHistory } from "@tiptap/pm/history";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

// The editor owns the held range. Native UI receives only an opaque token.
export function createTextColor({ Mark, Extension, Plugin, PluginKey, TextSelection, closeHistory, Decoration, DecorationSet,
  post, snapshot, selectionActive }) {
  const key = new PluginKey("vellixInlineTextColor");
  const gradientKey = new PluginKey("vellixInlineGradientLayout");
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

  function gradientView(view) {
    const doc = view.dom.ownerDocument, win = doc.defaultView;
    let frame = 0, destroyed = false;
    const stylesheet = doc.createElement("style");
    // Only the fallback mark background is suppressed. Block fills, layout and
    // text remain untouched; ProseMirror owns every generated inline span.
    stylesheet.textContent = ".vellix-gradient-fragment span[data-vellix-gradient]," +
      "span[data-vellix-gradient]:has(.vellix-gradient-fragment){background-image:none!important}";
    doc.head.appendChild(stylesheet);

    function fragments(node) {
      const range = doc.createRange(), text = node.data, result = [];
      const from = view.posAtDOM(node, 0);
      const position = view.state.doc.resolve(from);
      if (!position.parent.isTextblock || from + text.length > position.end() ||
          view.state.doc.textBetween(from, from + text.length, "\n") !== text) return result;
      function rects(start, end) {
        range.setStart(node, start); range.setEnd(node, end);
        return [...range.getClientRects()].filter(rect => rect.width > 0.01 && rect.height > 0.01);
      }
      let start = 0;
      while (start < text.length) {
        let end = text.length, boxes = rects(start, end);
        if (!boxes.length) break;
        if (boxes.length > 1) {
          // Find a single visual fragment without inserting wrappers while measuring.
          let low = start + 1, high = end;
          while (low < high) {
            const middle = Math.ceil((low + high) / 2);
            if (rects(start, middle).length <= 1) low = middle;
            else high = middle - 1;
          }
          end = low; boxes = rects(start, end);
        }
        if (boxes.length === 1) result.push({ from: from + start, to: from + end, rect: boxes[0] });
        start = end;
      }
      return result;
    }

    function paint() {
      frame = 0;
      if (destroyed || view.isDestroyed) return;
      const blocks = new Set();
      for (const span of view.dom.querySelectorAll("span[data-vellix-gradient]")) {
        const block = span.closest("p,h1,h2,h3,h4,h5,h6,pre,figcaption");
        if (block && view.dom.contains(block)) blocks.add(block);
      }
      const decorations = [], signature = [];
      for (const block of blocks) {
        const walker = doc.createTreeWalker(block, win.NodeFilter.SHOW_TEXT), groups = [];
        let node, current = null;
        while ((node = walker.nextNode())) {
          if (!node.data) continue;
          const boundary = node.parentElement.closest("[contenteditable]");
          const span = node.parentElement.closest("span[data-vellix-gradient]");
          const value = span && (!boundary || boundary === view.dom || boundary.contentEditable !== "false")
            ? parseGradient(span) : null;
          if (!value) { current = null; continue; }
          const identity = JSON.stringify(value);
          if (current?.identity !== identity) {
            current = { identity, value, parts: [] }; groups.push(current);
          }
          current.parts.push(...fragments(node));
        }
        for (const group of groups) {
          if (!group.parts.length) continue;
          let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
          for (const { rect } of group.parts) {
            left = Math.min(left, rect.left); right = Math.max(right, rect.right);
            top = Math.min(top, rect.top); bottom = Math.max(bottom, rect.bottom);
          }
          const radians = group.value.angle * Math.PI / 180;
          const dx = Math.sin(radians), dy = -Math.cos(radians);
          const length = Math.abs(dx) * (right - left) + Math.abs(dy) * (bottom - top);
          for (const { from, to, rect } of group.parts) {
            const fragmentLength = Math.abs(dx) * rect.width + Math.abs(dy) * rect.height;
            if (fragmentLength <= 0) continue;
            // Project the same CSS-angle gradient onto every line and formatted run.
            const offset = dx * ((left + right - rect.left - rect.right) / 2) +
              dy * ((top + bottom - rect.top - rect.bottom) / 2);
            const start = (offset - (length - fragmentLength) / 2) / fragmentLength;
            const end = start + length / fragmentLength;
            const image = `linear-gradient(${group.value.angle}deg,${group.value.start} ${(start * 100).toFixed(4)}%,${group.value.end} ${(end * 100).toFixed(4)}%)`;
            const css = `background-image:${image}!important;background-size:${rect.width.toFixed(3)}px ${rect.height.toFixed(3)}px!important;` +
              "background-position:0 0!important;background-repeat:no-repeat!important;background-origin:border-box!important;" +
              "background-clip:text!important;-webkit-background-clip:text!important;color:transparent!important;" +
              "-webkit-text-fill-color:transparent!important;box-decoration-break:clone;-webkit-box-decoration-break:clone";
            decorations.push(Decoration.inline(from, to, { class: "vellix-gradient-fragment", style: css }));
            signature.push([from, to, css]);
          }
        }
      }
      const next = JSON.stringify(signature);
      if (gradientKey.getState(view.state).signature === next) return;
      view.dispatch(view.state.tr.setMeta(gradientKey, {
        decorations: DecorationSet.create(view.state.doc, decorations), signature: next,
      }).setMeta("addToHistory", false));
    }
    function schedule() {
      if (!destroyed && !frame) frame = win.requestAnimationFrame(paint);
    }
    const resize = new win.ResizeObserver(schedule);
    resize.observe(view.dom);
    // Native font/appearance updates live here, outside the editable document.
    const appearance = new win.MutationObserver(schedule);
    appearance.observe(doc.documentElement, { attributes: true, attributeFilter: ["style", "class"] });
    doc.fonts?.addEventListener("loadingdone", schedule);
    void doc.fonts?.ready.then(schedule);
    schedule();
    return {
      update(_view, previous) { if (view.state.doc !== previous.doc) schedule(); },
      destroy() {
        destroyed = true; win.cancelAnimationFrame(frame);
        resize.disconnect(); appearance.disconnect(); stylesheet.remove();
        doc.fonts?.removeEventListener("loadingdone", schedule);
      },
    };
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
      } }), new Plugin({
        key: gradientKey,
        state: {
          init: () => ({ decorations: DecorationSet.empty, signature: "" }),
          apply(tr, previous) {
            const next = tr.getMeta(gradientKey);
            if (next) return next;
            // Drop old spans on content edits so new text keeps the normal mark
            // fallback until geometry is refreshed. Never write paint into JSON.
            return tr.docChanged ? { decorations: DecorationSet.empty, signature: "" } : previous;
          },
        },
        props: { decorations: state => gradientKey.getState(state)?.decorations ?? DecorationSet.empty },
        view: gradientView,
      })];
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

export const textColorDependencies = { Mark, Extension, Plugin, PluginKey, TextSelection, closeHistory, Decoration, DecorationSet };
