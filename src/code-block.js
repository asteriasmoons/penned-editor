import { CodeBlock } from "@tiptap/extension-code-block";
import catalog from "./code-block-catalog.json";

const palettes = new Map(catalog.themes.filter(theme => theme.id !== "auto")
  .map(theme => [theme.id, Object.fromEntries(catalog.colorRoles.map((role, i) => [role, theme.colors[i]]))]));
const themeID = value => palettes.has(value) ? value : "auto";
function languageID(value) {
  if (typeof value !== "string" || !value.trim()) return "plaintext";
  const id = value.trim().toLowerCase();
  if (!/^[\w+#.-]{1,64}$/.test(id)) return "other";
  return Object.prototype.hasOwnProperty.call(catalog.aliases, id) ? catalog.aliases[id] : id;
}

export function createCodeBlocks({ post, selectionActive, closeHistory }) {
  const views = new WeakMap();
  const data = node => ({ code: node.textContent, language: languageID(node.attrs.language), theme: themeID(node.attrs.theme) });

  function locate(editor, blockID) {
    let target;
    editor.state.doc.descendants((node, pos) => {
      if (target) return false;
      if (node.type.name !== "codeBlock") return true;
      if (node.attrs.id === blockID) target = { node, pos };
      return false;
    });
    return target;
  }

  function request(editor, blockID) {
    if (!blockID || !editor.isEditable || selectionActive()) return false;
    const target = locate(editor, blockID);
    if (!target) return false;
    editor.commands.blur();
    post("codeBlockEdit", { blockID, ...data(target.node) });
    return true;
  }

  const node = CodeBlock.extend({
    atom: true,
    isolating: true,
    addAttributes() {
      return {
        ...this.parent?.(),
        theme: {
          default: "auto",
          parseHTML: element => themeID(element.getAttribute("data-code-theme")),
          renderHTML: attrs => ({ "data-code-theme": themeID(attrs.theme) }),
        },
      };
    },
    addKeyboardShortcuts() {
      return { Enter: ({ editor }) => {
        const selected = editor.state.selection.node;
        return selected?.type.name === "codeBlock" && request(editor, selected.attrs.id);
      } };
    },
    addNodeView() {
      return ({ node: initial, editor, getPos }) => {
        const dom = document.createElement("div");
        dom.className = "penned-code-viewer";
        dom.contentEditable = "false";
        dom.tabIndex = 0;
        dom.setAttribute("role", "button");
        dom.setAttribute("aria-label", "Edit Code Block");
        let current = initial;
        let renderedSource, renderedLanguage;

        function render(draft) {
          const { code, language, theme } = { ...data(current), ...draft };
          const dark = palettes.get(theme === "auto" ? "aura" : theme);
          const light = theme === "auto" ? palettes.get("github-light") : dark;
          for (const role of catalog.colorRoles) {
            dom.style.setProperty(`--penned-code-${role}-dark`, dark[role]);
            dom.style.setProperty(`--penned-code-${role}-light`, light[role]);
          }
          dom.dataset.vellixBlockId = current.attrs.id || "";
          if (code === renderedSource && language === renderedLanguage) return;
          renderedSource = code;
          renderedLanguage = language;
          const scrollTop = dom.scrollTop;
          const rows = document.createDocumentFragment();
          const spans = globalThis.PennedCodeSyntax?.tokens(code, language) ?? [];
          let offset = 0, spanIndex = 0, number = 0;
          for (const line of code.split(/\r\n|[\r\n\u2028\u2029]/)) {
            const row = document.createElement("div");
            row.className = "penned-code-line";
            const gutter = document.createElement("span");
            gutter.className = "penned-code-number";
            gutter.setAttribute("aria-hidden", "true");
            gutter.textContent = String(++number);
            const text = document.createElement("span");
            text.className = "penned-code-text";
            const end = offset + line.length;
            let cursor = offset;
            while (spanIndex < spans.length && spans[spanIndex].start < end) {
              const span = spans[spanIndex];
              const start = Math.max(cursor, span.start);
              const stop = Math.min(end, span.start + span.length);
              if (stop > start) {
                if (start > cursor) text.append(code.slice(cursor, start));
                const part = document.createElement("span");
                part.style.color = `var(--penned-code-${span.role})`;
                part.textContent = code.slice(start, stop);
                text.append(part);
                cursor = stop;
              }
              if (span.start + span.length > end) break;
              spanIndex++;
            }
            if (cursor < end) text.append(code.slice(cursor, end));
            row.append(gutter, text);
            rows.append(row);
            offset = end + (code.startsWith("\r\n", end) ? 2 : 1);
          }
          dom.style.setProperty("--penned-code-gutter-width", `${Math.max(3, String(number).length + 1)}ch`);
          dom.replaceChildren(rows);
          dom.scrollTop = scrollTop;
        }

        function open(event) {
          if (event.defaultPrevented || selectionActive() || !editor.isEditable || window.PennedBlockSelection?.consumesClick(event)) return;
          const pos = getPos();
          const blockID = typeof pos === "number" ? editor.state.doc.nodeAt(pos)?.attrs.id : null;
          if (request(editor, blockID)) event.preventDefault();
        }
        dom.addEventListener("click", open);
        dom.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") open(event); });
        views.set(dom, render);
        render();
        return {
          dom,
          update(next) {
            if (next.type !== current.type) return false;
            if (next !== current) { current = next; render(); }
            return true;
          },
          ignoreMutation: () => true,
          stopEvent: event => !selectionActive() && (event.type === "click" || event.type === "keydown"),
        };
      };
    },
  });

  function command(editor, name, args) {
    if (!["codeBlockUpdate", "codeBlockPreview", "codeBlockEndPreview"].includes(name)) return undefined;
    if (name !== "codeBlockEndPreview" && (!editor.isEditable || selectionActive())) return false;
    const target = locate(editor, args.blockID);
    if (!target) return false;
    const render = views.get(editor.view.nodeDOM(target.pos));
    if (name !== "codeBlockUpdate") {
      render?.(name === "codeBlockPreview" ? { language: languageID(args.language), theme: themeID(args.theme) } : undefined);
      return true;
    }
    if (typeof args.code !== "string") return false;
    const previous = data(target.node);
    const next = { code: args.code, language: languageID(args.language), theme: themeID(args.theme) };
    const matches = (first, second) => first.code === second?.code && first.language === languageID(second?.language) && first.theme === themeID(second?.theme);
    if (!matches(previous, next)) {
      if (!matches(previous, args.original)) return false;
      const content = next.code ? editor.schema.text(next.code) : null;
      const replacement = target.node.type.createChecked({ ...target.node.attrs, language: next.language, theme: next.theme }, content);
      editor.view.dispatch(closeHistory(editor.state.tr).replaceWith(target.pos, target.pos + target.node.nodeSize, replacement));
      const updated = locate(editor, args.blockID);
      if (!updated || !matches(next, data(updated.node))) return false;
    }
    render?.();
    return editor.getJSON();
  }

  return { node, command, request };
}
