import { Node, Extension, mergeAttributes } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { closeHistory } from "@tiptap/pm/history";
import { Mapping } from "@tiptap/pm/transform";

export function cleanTagName(input) {
  const value = String(input ?? "").trim().replace(/^#/, "").normalize("NFC");
  return value && [...value].length <= 80 && /^[\p{L}\p{M}\p{N}_-]+$/u.test(value) ? value : null;
}
export const normalizedTagName = input => cleanTagName(input)?.toUpperCase().toLowerCase().normalize("NFC") ?? null;

export function taggedInlineContent(node) {
  let found = false;
  const inline = new Set(["text", "hardBreak", "inlineTag"]);
  function collect(value) {
    if (inline.has(value.type)) { if (value.type === "inlineTag") found = true; return [value]; }
    const result = [];
    let previousBlock = false;
    for (const child of value.content ?? []) {
      const content = collect(child);
      if (!content.length) continue;
      const block = !inline.has(child.type);
      if (result.length && block && previousBlock) result.push({ type: "hardBreak" });
      result.push(...content); previousBlock = block;
    }
    return result;
  }
  const content = collect(node);
  return found ? content : null;
}

export function createDocumentTags({ post, snapshot, selectionActive, reportHeight }) {
  const key = new PluginKey("pennedDocumentTags");
  const pending = new Map();
  let catalogue = [], menu = null, active = null, highlighted = null;
  let highlightBlockID = null, liveEditor = null;
  let dismissed = null, selected = 0;
  const removeHighlight = () => {
    const hadHighlight = highlightBlockID;
    highlightBlockID = null;
    highlighted = null;
    if (hadHighlight && liveEditor && !liveEditor.isDestroyed)
      liveEditor.view.dispatch(liveEditor.state.tr.setMeta(key, "clearHighlight").setMeta("addToHistory", false));
  };
  const hide = () => { menu?.remove(); menu = null; active = null; };
  const resetReveals = editor => {
    for (const element of editor.view.dom.querySelectorAll("[data-vellix-toggle]")) element.dispatchEvent(new CustomEvent("pennedTagReset"));
  };
  const remember = value => {
    const token = crypto.randomUUID();
    pending.set(token, value);
    // Tokens are short-lived bookmarks, never persisted or used across documents.
    if (pending.size > 32) pending.delete(pending.keys().next().value);
    return token;
  };
  function inputAt(state) {
    const { $from, empty } = state.selection;
    if (!empty || !$from.parent.isTextblock || $from.parent.type.spec.code || state.storedMarks?.some(m => m.type.name === "code")) return null;
    if ($from.marks().some(m => ["code", "link"].includes(m.type.name))) return null;
    const text = $from.parent.textBetween(0, $from.parentOffset, "\n", "\ufffc");
    const match = /(?:^|[\s([{])#([\p{L}\p{M}\p{N}_-]{0,80})$/u.exec(text);
    if (!match) return null;
    const to = $from.pos, from = to - match[1].length - 1;
    return { from, to, query: match[1], text: "#" + match[1] };
  }
  function choices(query) {
    const normalized = normalizedTagName(query) ?? "";
    const matches = catalogue.filter(tag => tag.normalizedName.includes(normalized)).slice(0, 12)
      .map(tag => ({ name: tag.name, title: "#" + tag.name }));
    if (cleanTagName(query) && !catalogue.some(tag => tag.normalizedName === normalized))
      matches.push({ name: cleanTagName(query), title: "Create #" + cleanTagName(query) });
    return matches;
  }
  function choose(editor, choice) {
    if (!active || !choice) return;
    const token = remember({ ...active, kind: "input" });
    hide();
    post("tagRequest", { action: "commit", token, name: choice.name });
  }
  function render(editor) {
    const next = editor.isEditable && !selectionActive() && !editor.view.composing && editor.view.hasFocus() ? inputAt(editor.state) : null;
    if (!next || dismissed === `${next.from}:${next.text}`) { hide(); return; }
    if (active?.from !== next.from || active?.query !== next.query) selected = 0;
    active = next;
    const options = choices(next.query);
    if (!options.length) { menu?.remove(); menu = null; return; }
    selected = Math.min(selected, options.length - 1);
    const signature = JSON.stringify([next.from, next.query, selected, options]);
    if (!menu || menu.dataset.signature !== signature) {
      menu?.remove();
      menu = document.createElement("div");
      menu.dataset.signature = signature;
      menu.className = "penned-tag-suggestions";
      menu.setAttribute("role", "listbox"); menu.setAttribute("aria-label", "Tags");
      options.forEach((choice, index) => {
        const button = document.createElement("button"); button.type = "button";
        button.textContent = choice.title; button.setAttribute("role", "option");
        button.setAttribute("aria-selected", String(index === selected));
        button.addEventListener("pointerdown", event => event.preventDefault());
        button.addEventListener("mousedown", event => event.preventDefault());
        button.addEventListener("click", event => { event.preventDefault(); choose(editor, choice); });
        menu.append(button);
      });
      document.body.append(menu);
    }
    try {
      const rect = editor.view.coordsAtPos(next.to);
      const width = Math.min(300, document.documentElement.clientWidth - 24);
      menu.style.width = `${width}px`;
      menu.style.left = `${Math.max(12, Math.min(rect.left, document.documentElement.clientWidth - width - 12))}px`;
      // Above the active line keeps the menu visible while the keyboard is open.
      const height = Math.min(220, menu.scrollHeight);
      menu.style.top = `${Math.max(8, rect.top - height - 8)}px`;
    } catch { hide(); }
  }
  const node = Node.create({
    name: "inlineTag", group: "inline", inline: true, atom: true, selectable: false,
    addAttributes() { return { id: { default: null }, name: { default: "" }, tagID: { default: null } }; },
    parseHTML() { return [{ tag: "span[data-penned-tag]", getAttrs: el => {
      const name = cleanTagName(el.dataset.pennedTag);
      return name ? { name, id: el.dataset.tagOccurrence || crypto.randomUUID() } : false;
    } }]; },
    renderHTML({ node, HTMLAttributes }) {
      return ["span", mergeAttributes(HTMLAttributes, { "data-penned-tag": node.attrs.name, "data-tag-occurrence": node.attrs.id, class: "penned-inline-tag", role: "button", tabindex: "0" }), "#" + node.attrs.name];
    },
    renderText({ node }) { return "#" + node.attrs.name; },
  });
  const integration = Extension.create({
    name: "pennedTagIntegration",
    addProseMirrorPlugins() {
      const editor = this.editor;
      liveEditor = editor;
      function openTag(view, event) {
        const element = event.target?.closest?.("[data-tag-occurrence]");
        if (!element || selectionActive()) return false;
        let found = null;
        view.state.doc.descendants((node, pos) => {
          if (node.type.name === "inlineTag" && node.attrs.id === element.dataset.tagOccurrence) found = { node, pos };
        });
        if (!found || !cleanTagName(found.node.attrs.name)) return false;
        event.preventDefault(); hide();
        const token = remember({ kind: "node", id: found.node.attrs.id });
        post("tagRequest", { action: "menu", token, name: found.node.attrs.name });
        return true;
      }
      return [new Plugin({
        key,
        state: {
          init: () => null,
          apply(tr) {
            for (const [token, value] of pending) if (value.kind === "input") {
              const from = tr.mapping.mapResult(value.from, -1), to = tr.mapping.mapResult(value.to, 1);
              if (from.deletedAcross || to.deletedAcross || tr.doc.textBetween(from.pos, to.pos) !== value.text) pending.delete(token);
              else { value.from = from.pos; value.to = to.pos; }
            }
            return null;
          },
        },
        appendTransaction(transactions, old, state) {
          if (!transactions.some(tr => tr.docChanged)) return null;
          const seen = new Set(), tr = state.tr;
          const mapping = new Mapping(), preserved = new Map();
          transactions.forEach(transaction => mapping.appendMapping(transaction.mapping));
          old.doc.descendants((node, pos) => {
            if (!node.attrs.id) return;
            const mapped = mapping.mapResult(pos, 1);
            if (!mapped.deletedAcross && state.doc.nodeAt(mapped.pos)?.attrs.id === node.attrs.id) preserved.set(node.attrs.id, mapped.pos);
          });
          state.doc.descendants((node, pos) => {
            if (!("id" in node.attrs)) return;
            let id = node.attrs.id;
            // A paste before its source must not steal the original block's navigation ID.
            if (!id || (preserved.has(id) ? preserved.get(id) !== pos : seen.has(id))) {
              id = crypto.randomUUID(); tr.setNodeMarkup(pos, undefined, { ...node.attrs, id });
            }
            seen.add(id);
          });
          return tr.docChanged ? tr : null;
        },
        props: {
          handleDOMEvents: {
            mousedown(view, event) { if (event.target?.closest?.("[data-tag-occurrence]")) event.preventDefault(); return false; },
            click: openTag,
            keydown(view, event) {
              if ((event.key === "Enter" || event.key === " ") && event.target?.closest?.("[data-tag-occurrence]")) return openTag(view, event);
              return false;
            },
          },
          handleKeyDown(_view, event) {
            if (!menu || !active || event.isComposing) return false;
            const options = choices(active.query);
            if (["ArrowDown", "ArrowUp"].includes(event.key)) { selected = (selected + (event.key === "ArrowDown" ? 1 : options.length - 1)) % options.length; render(editor); return true; }
            if (["Enter", "Tab"].includes(event.key)) { choose(editor, options[selected]); return true; }
            if (event.key === "Escape") { dismissed = `${active.from}:${active.text}`; hide(); return true; }
            return false;
          },
          decorations(state) {
            if (!highlightBlockID) return null;
            const decorations = [];
            state.doc.descendants((node, pos) => {
              if (node.isBlock && node.attrs.id === highlightBlockID)
                decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: "penned-tag-destination" }));
            });
            return DecorationSet.create(state.doc, decorations);
          },
        },
        view() {
          const reposition = () => render(editor);
          window.addEventListener("resize", reposition); window.visualViewport?.addEventListener("resize", reposition);
          return { update: () => render(editor), destroy() { hide(); pending.clear(); removeHighlight();
            window.removeEventListener("resize", reposition); window.visualViewport?.removeEventListener("resize", reposition); } };
        },
      })];
    },
  });
  async function command(editor, name, args) {
    if (name === "setContent") { pending.clear(); hide(); removeHighlight(); resetReveals(editor); dismissed = null; return undefined; }
    if (name === "tagCatalogue") {
      catalogue = (args.tags ?? []).filter(tag => cleanTagName(tag.name)).map(tag => ({ ...tag, normalizedName: normalizedTagName(tag.name) }));
      render(editor); return true;
    }
    if (name === "tagDismiss") { pending.delete(args.token); hide(); return true; }
    if (name === "tagLocate") {
      editor.commands.blur();
      resetReveals(editor);
      removeHighlight();
      let found = null;
      editor.state.doc.descendants((node, pos) => { if (node.isBlock && node.attrs.id === args.blockID) found = { node, pos }; });
      if (!found) return null;
      const resolved = editor.state.doc.resolve(found.pos), ancestors = new Set();
      for (let depth = 1; depth <= resolved.depth; depth++) if (resolved.node(depth).type.name === "toggleItem") ancestors.add(resolved.node(depth).attrs.id);
      for (const element of editor.view.dom.querySelectorAll("[data-vellix-toggle]"))
        if (ancestors.has(element.dataset.vellixBlockId)) element.dispatchEvent(new CustomEvent("pennedTagReveal"));
      reportHeight();
      await document.fonts?.ready;
      await new Promise(resolve => requestAnimationFrame(resolve));
      const element = editor.view.nodeDOM(found.pos);
      if (!(element instanceof Element)) return null;
      const occurrence = args.occurrenceID ? [...element.querySelectorAll("[data-tag-occurrence]")].find(el => el.dataset.tagOccurrence === args.occurrenceID) : null;
      if (args.occurrenceID && !occurrence) return null;
      const destination = occurrence ?? element;
      for (let parent = destination.parentElement; parent && parent !== editor.view.dom; parent = parent.parentElement) {
        if (parent.clientWidth <= 0 || parent.scrollWidth <= parent.clientWidth || !/auto|scroll/.test(getComputedStyle(parent).overflowX)) continue;
        const bounds = parent.getBoundingClientRect(), target = destination.getBoundingClientRect();
        if (target.left < bounds.left) parent.scrollLeft += target.left - bounds.left;
        else if (target.right > bounds.right) parent.scrollLeft += target.right - bounds.right;
      }
      const blockRect = element.getBoundingClientRect(), tagRect = destination.getBoundingClientRect();
      // WebView document coordinates; native code converts these into the outer ScrollView.
      return { x: tagRect.left + window.scrollX, y: tagRect.top + window.scrollY,
        width: Math.max(1, tagRect.width), height: Math.max(1, tagRect.height), blockY: blockRect.top + window.scrollY };
    }
    if (name === "tagHighlight") {
      removeHighlight();
      const element = [...editor.view.dom.querySelectorAll("[data-vellix-block-id]")].find(el => el.dataset.vellixBlockId === args.blockID);
      if (!element) return false;
      highlightBlockID = args.blockID;
      editor.view.dispatch(editor.state.tr.setMeta(key, "highlight").setMeta("addToHistory", false));
      highlighted = element;
      element.addEventListener("animationend", removeHighlight, { once: true });
      editor.view.dom.addEventListener("pointerdown", removeHighlight, { once: true });
      return true;
    }
    if (!["tagApply", "tagToText"].includes(name)) return undefined;
    if (!editor.isEditable || selectionActive()) return false;
    const bookmark = pending.get(args.token);
    if (!bookmark) return false;
    let from, to, marks, sourceName;
    if (bookmark.kind === "node") {
      editor.state.doc.descendants((node, pos) => { if (node.type.name === "inlineTag" && node.attrs.id === bookmark.id) { from = pos; to = pos + node.nodeSize; marks = node.marks; sourceName = node.attrs.name; } });
    } else if (editor.state.doc.textBetween(bookmark.from, bookmark.to) === bookmark.text) {
      from = bookmark.from; to = bookmark.to; marks = editor.state.doc.resolve(from).marks();
    }
    if (from == null) { pending.delete(args.token); return false; }
    const clean = cleanTagName(name === "tagToText" ? sourceName : args.name);
    if (!clean) return false;
    const replacement = name === "tagToText" ? editor.schema.text("#" + clean, marks)
      : editor.schema.nodes.inlineTag.create({ id: bookmark.kind === "node" ? bookmark.id : crypto.randomUUID(), name: clean, tagID: args.tagID ?? null }, null, marks);
    pending.delete(args.token); hide(); dismissed = name === "tagToText" ? `${from}:#${clean}` : null;
    let tr = closeHistory(editor.state.tr).replaceWith(from, to, replacement);
    tr.setSelection(TextSelection.create(tr.doc, from + replacement.nodeSize));
    editor.view.dispatch(tr);
    editor.view.dispatch(closeHistory(editor.state.tr));
    editor.view.focus();
    post("snapshot", snapshot());
    return true;
  }
  return { node, integration, command };
}
