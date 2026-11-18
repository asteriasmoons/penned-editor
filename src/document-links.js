import { Extension, Node, mergeAttributes } from "@tiptap/core";
import { NodeSelection, Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { closeHistory } from "@tiptap/pm/history";

const layouts = new Set(["small", "regular", "card"]);
const textTypes = new Set(["paragraph", "heading", "caption"]);
export const richLinkLayout = value => layouts.has(value) ? value : "regular";
const clean = (value, limit) => typeof value === "string" ? value.trim().replace(/\s+/gu, " ").slice(0, limit) : "";

export function webLinkURL(value, base) {
  if (typeof value !== "string" || !value.trim() || value.length > 4096 || /[\s\u0000-\u001f\u007f\\]/u.test(value.trim())) return null;
  try {
    const url = new URL(value.trim(), base);
    return ["https:", "http:"].includes(url.protocol) && url.hostname && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function openableLink(value) {
  const web = webLinkURL(value);
  if (web) return web;
  return typeof value === "string" && value.length <= 4096 && /^(mailto|tel):[^\s\u0000-\u001f\u007f]+$/iu.test(value) ? value : null;
}

export function richLinkMetadata(value) {
  return { title: clean(value?.title, 320), description: clean(value?.description, 640), site: clean(value?.site, 120),
    image: webLinkURL(value?.image), favicon: webLinkURL(value?.favicon) };
}

export function extractLinkMetadata(html, href, document) {
  const base = webLinkURL(href);
  if (!base || typeof html !== "string") return richLinkMetadata(null);
  // Template contents are inert: page scripts and subresources never load.
  const template = document.createElement("template");
  template.innerHTML = html.slice(0, 524288);
  const values = new Map();
  for (const tag of template.content.querySelectorAll("meta[content]")) {
    const key = (tag.getAttribute("property") || tag.getAttribute("name") || "").trim().toLowerCase();
    const content = tag.getAttribute("content")?.trim();
    if (key && content && !values.has(key)) values.set(key, content);
  }
  const first = (...keys) => keys.map(key => values.get(key)).find(Boolean);
  const media = (selector, attribute) => [...template.content.querySelectorAll(selector)]
    .map(tag => webLinkURL(tag.getAttribute(attribute), base)).find(Boolean);
  return richLinkMetadata({
    title: first("og:title", "twitter:title") || template.content.querySelector("title")?.textContent,
    description: first("og:description", "twitter:description", "description"), site: first("og:site_name", "application-name"),
    image: webLinkURL(first("og:image:secure_url", "og:image", "og:image:url", "twitter:image", "twitter:image:src"), base)
      || media('link[rel~="image_src" i]', "href"),
    favicon: media('link[rel~="icon" i], link[rel="apple-touch-icon" i]', "href") || webLinkURL("/favicon.ico", base),
  });
}

export const richLinkDefaults = { href: "", layout: "regular", metadata: null, sourceType: "paragraph", sourceLevel: null };

export function richLinkDOM(node, attrs = {}) {
  const href = webLinkURL(node.attrs.href);
  const metadata = richLinkMetadata(node.attrs.metadata);
  const url = href ? new URL(href) : null;
  const site = url ? `${url.host}${url.pathname === "/" ? "" : url.pathname}` : "";
  const title = metadata.title || node.textContent || site || "Link";
  const image = metadata.image || metadata.favicon;
  const imageDOM = (src, className) => ["img", { src, class: className, alt: "", loading: "lazy", referrerpolicy: "no-referrer", draggable: "false" }];
  const preview = ["a", { class: "penned-rich-link-preview", href, rel: "noopener noreferrer", target: "_blank", draggable: "false" },
    ["div", { class: "penned-rich-link-main" },
      ...(image ? [imageDOM(image, `penned-rich-link-image${metadata.image ? "" : " penned-rich-link-favicon-only"}`)] : []),
      ["div", { class: "penned-rich-link-copy" }, ["div", { class: "penned-rich-link-title" }, title],
        ...(metadata.description ? [["div", { class: "penned-rich-link-description" }, metadata.description]] : [])]],
    ["div", { class: "penned-rich-link-site" }, ...(metadata.favicon ? [imageDOM(metadata.favicon, "penned-rich-link-favicon")] : []),
      ["span", {}, metadata.site && metadata.site !== site ? `${metadata.site} · ${site}` : site]]];
  return ["div", mergeAttributes(attrs, { class: "penned-rich-link", "data-rich-link": "", "data-link-layout": richLinkLayout(node.attrs.layout),
    "data-link-info": JSON.stringify(metadata), contenteditable: "false" }), preview, ["span", { hidden: "", "data-link-text": "" }, 0]];
}

export function createDocumentLinks({ post, selectionActive, selectedBlock, reselect, canEdit, id }) {
  let held = null;
  let pointer = null;
  const linkSelectionKey = new PluginKey("pennedLinkSelection");
  function setHeld(editor, request) {
    held = request;
    const range = request?.mode === "text" ? { from: request.from, to: request.to } : null;
    if (range || linkSelectionKey.getState(editor.state)) {
      editor.view.dispatch(editor.state.tr.setMeta(linkSelectionKey, range).setMeta("addToHistory", false));
    }
  }
  const node = Node.create({
    name: "richLink", group: "block", content: "inline*", atom: true, isolating: true,
    addAttributes() {
      return Object.fromEntries(Object.entries(richLinkDefaults).map(([key, value]) => [key, { default: value, rendered: false }]));
    },
    parseHTML() {
      return [{ tag: "div[data-rich-link]", contentElement: "[data-link-text]", getAttrs: element => {
        const href = webLinkURL(element.querySelector("a[href]")?.getAttribute("href"));
        if (!href || !element.querySelector("[data-link-text]")) return false;
        let metadata;
        try { metadata = JSON.parse(element.dataset.linkInfo); } catch { metadata = null; }
        return { href, layout: richLinkLayout(element.dataset.linkLayout), metadata: richLinkMetadata(metadata) };
      } }];
    },
    renderHTML: ({ node, HTMLAttributes }) => richLinkDOM(node, HTMLAttributes),
  });
  const integration = Extension.create({
    name: "pennedDocumentLinks",
    addGlobalAttributes() {
      return [{ types: ["link"], attributes: { pennedPreview: { default: null, rendered: false } } }];
    },
    addProseMirrorPlugins() {
      // The native URL field owns focus, so the browser's selection paint
      // is no longer available. Keep a temporary decoration on the held range.
      return [new Plugin({
        key: linkSelectionKey,
        state: {
          init: () => null,
          apply(transaction, previous) {
            const range = transaction.getMeta(linkSelectionKey);
            if (range === undefined) return transaction.docChanged ? null : previous;
            return range ? DecorationSet.create(transaction.doc, [
              Decoration.inline(range.from, range.to, { class: "penned-link-held-selection" }),
            ]) : null;
          },
        },
        props: { decorations: state => linkSelectionKey.getState(state) },
      })];
    },
  });

  const markFor = node => node.marks.find(mark => mark.type.name === "link");
  function textRange(editor) {
    const selection = editor.state.selection;
    if (!editor.isEditable || selectionActive() || !(selection instanceof TextSelection)) return null;
    let { from, to } = selection;
    if (selection.empty) {
      const { $from } = selection;
      if (!$from.nodeBefore?.marks.some(mark => mark.type.name === "link") &&
          !$from.nodeAfter?.marks.some(mark => mark.type.name === "link")) return null;
      const spans = [];
      $from.parent.forEach((child, offset) => {
        if (child.isText) spans.push({ from: $from.start() + offset, to: $from.start() + offset + child.nodeSize, href: markFor(child)?.attrs.href });
      });
      const index = spans.findIndex(span => span.href && span.from <= from && span.to >= to);
      if (index < 0) return null;
      const href = spans[index].href;
      let left = index, right = index;
      while (left > 0 && spans[left - 1].href === href && spans[left - 1].to === spans[left].from) left--;
      while (right + 1 < spans.length && spans[right + 1].href === href && spans[right].to === spans[right + 1].from) right++;
      from = spans[left].from; to = spans[right].to;
    }
    const urls = new Set();
    let eligible = false;
    editor.state.doc.nodesBetween(from, to, (node, _, parent) => {
      if (node.isText && parent?.type.name !== "richLink" && parent?.type.allowsMarkType(editor.schema.marks.link)) {
        eligible = true;
        urls.add(markFor(node)?.attrs.href ?? "");
      }
    });
    return eligible ? { from, to, href: urls.size === 1 ? [...urls][0] : "", existing: [...urls].some(Boolean) } : null;
  }

  function blockLink(block) {
    if (!block?.node?.attrs.id) return null;
    const { node, pos } = block;
    if (node.type.name === "richLink") {
      const href = webLinkURL(node.attrs.href);
      return href ? { node, pos, kind: "rich", href, layout: richLinkLayout(node.attrs.layout), metadata: richLinkMetadata(node.attrs.metadata) } : null;
    }
    if (!textTypes.has(node.type.name) || !node.textContent) return null;
    const parts = node.content.content;
    const mark = markFor(parts[0]);
    const href = openableLink(mark?.attrs.href);
    if (!href || !parts.every(part => part.isText && markFor(part)?.attrs.href === mark.attrs.href)) return null;
    const preview = mark.attrs.pennedPreview;
    const metadata = richLinkMetadata(preview?.metadata);
    return { node, pos, kind: "text", href, layout: richLinkLayout(preview?.layout),
      metadata: Object.values(metadata).some(Boolean) ? metadata : null };
  }

  function acceptsReplacement(editor, link, type) {
    const position = editor.state.doc.resolve(link.pos);
    return position.parent.canReplaceWith(position.index(), position.index() + 1, type);
  }

  function selectionInfo(editor) {
    const link = selectionActive() && blockLink(selectedBlock());
    return link ? { blockID: link.node.attrs.id, kind: link.kind, href: link.href, layout: link.layout, metadata: link.metadata,
      canConvertToRich: link.kind === "text" && !!webLinkURL(link.href) && acceptsReplacement(editor, link, editor.schema.nodes.richLink) } : null;
  }

  function textContent(editor, link, href, preview = null) {
    const mark = href ? editor.schema.marks.link.create({ href, pennedPreview: preview }) : null;
    const parts = link.node.content.content.map(part => {
      const marks = part.marks.filter(value => value.type.name !== "link");
      return part.mark(mark ? mark.addToSet(marks) : marks);
    });
    return parts.length ? parts : [editor.schema.text(link.href, mark ? [mark] : [])];
  }

  function fromRich(editor, link, href) {
    const type = textTypes.has(link.node.attrs.sourceType) ? link.node.attrs.sourceType : "paragraph";
    const preview = href ? { layout: link.layout, metadata: link.metadata } : null;
    return editor.schema.nodes[type].create({ id: link.node.attrs.id, indent: link.node.attrs.indent,
      textAlign: link.node.attrs.textAlign, blockFont: link.node.attrs.blockFont,
      level: link.node.attrs.sourceLevel ?? 1 }, textContent(editor, link, href, preview));
  }

  function replaceBlock(editor, link, replacement) {
    if (!acceptsReplacement(editor, link, replacement.type)) return false;
    const wasSelected = selectionActive();
    editor.view.dispatch(closeHistory(editor.state.tr.replaceWith(link.pos, link.pos + link.node.nodeSize, replacement)).setMeta("preventAutolink", true));
    if (wasSelected) reselect(replacement.attrs.id);
    return true;
  }

  function begin(editor, args) {
    if (!canEdit()) return false;
    const mode = args.mode;
    let context;
    if (mode === "block") {
      const link = selectionActive() && blockLink(selectedBlock());
      if (!link || link.node.attrs.id !== args.blockID) return false;
      context = { ...link, existing: true };
    } else if (mode === "text") {
      context = textRange(editor);
    } else if (mode === "insert" && editor.isEditable && !selectionActive()) {
      context = { selection: editor.state.selection.getBookmark(), href: "", existing: false };
    }
    if (!context) return false;
    const token = id();
    setHeld(editor, { ...context, mode, token, doc: editor.state.doc });
    if (mode === "text") editor.view.dom.blur();
    else editor.commands.blur();
    return { token, href: context.href, existing: context.existing, kind: context.kind ?? "text" };
  }

  function apply(editor, args) {
    if (!canEdit() || !held || held.token !== args.token || held.doc !== editor.state.doc) return false;
    if (held.mode === "block") {
      const current = selectionActive() && blockLink(selectedBlock());
      if (!current || current.node !== held.node || current.pos !== held.pos) return false;
    } else if (selectionActive() || !editor.isEditable) return false;
    const href = args.remove ? null : openableLink(args.href);
    if (!href && (!args.remove || !held.existing)) return false;
    const mark = editor.schema.marks.link;
    if (held.mode === "text") {
      if (href && href === held.href) { setHeld(editor, null); return true; }
      let tr = closeHistory(editor.state.tr).removeMark(held.from, held.to, mark);
      if (href) tr.addMark(held.from, held.to, mark.create({ href }));
      editor.view.dispatch(tr.setMeta("preventAutolink", true));
    } else if (held.mode === "block") {
      const link = held;
      if (link.kind === "rich") {
        if (href && !webLinkURL(href)) return false;
        if (!replaceBlock(editor, link, href ? link.node.type.create({ ...link.node.attrs, href,
          metadata: href === link.href ? link.metadata : richLinkMetadata(args.metadata) }, link.node.content) : fromRich(editor, link, null))) return false;
      } else {
        const tr = closeHistory(editor.state.tr).removeMark(link.pos + 1, link.pos + link.node.nodeSize - 1, mark);
        if (href) tr.addMark(link.pos + 1, link.pos + link.node.nodeSize - 1,
          mark.create({ href, pennedPreview: href === link.href ? markFor(link.node.firstChild)?.attrs.pennedPreview : null }));
        editor.view.dispatch(tr.setMeta("preventAutolink", true));
      }
    } else {
      const kind = args.kind;
      const label = kind === "label" ? clean(args.label, 4096) : href;
      if (!href || !label || (kind === "rich" && !webLinkURL(href))) return false;
      const blockID = id();
      const inserted = kind === "rich" ? { type: "richLink", attrs: { id: blockID, href, metadata: richLinkMetadata(args.metadata) }, content: [{ type: "text", text: label }] }
        : { type: "paragraph", attrs: { id: blockID }, content: [{ type: "text", text: label, marks: [{ type: "link", attrs: { href } }] }] };
      const target = held.selection.resolve(editor.state.doc);
      const insertion = target instanceof NodeSelection || !target.empty ? target.to : target.from;
      if (!editor.chain().command(({ tr }) => { closeHistory(tr).setMeta("preventAutolink", true); return true; })
        .insertContentAt(insertion, inserted).run()) return false;
    }
    setHeld(editor, null);
    return true;
  }

  function action(editor, args) {
    if (!canEdit() || !selectionActive()) return false;
    const link = blockLink(selectedBlock());
    if (!link || link.node.attrs.id !== args.blockID || link.href !== args.href || link.kind !== args.kind) return false;
    const { node, pos, href } = link;
    if (args.action === "convert") {
      if (link.kind === "rich") return replaceBlock(editor, link, fromRich(editor, link, href));
      if (webLinkURL(href)) return replaceBlock(editor, link, editor.schema.nodes.richLink.create({ ...node.attrs, href,
        layout: link.layout, metadata: link.metadata || richLinkMetadata(args.metadata), sourceType: node.type.name,
        sourceLevel: node.attrs.level }, textContent(editor, link, null)));
      return false;
    }
    if (link.kind !== "rich") return false;
    const attrs = args.action === "layout" && layouts.has(args.layout) ? { layout: args.layout }
      : args.action === "reload" && args.metadata ? { metadata: richLinkMetadata(args.metadata) } : null;
    if (!attrs) return false;
    editor.view.dispatch(closeHistory(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs })));
    if (!selectionActive()) reselect(node.attrs.id);
    return true;
  }

  function handleClick(editor, event) {
    const anchor = event.target.closest?.("a[href]");
    if (!anchor || !editor.view.dom.contains(anchor) || event.defaultPrevented) return false;
    const raw = anchor.getAttribute("href");
    if (raw?.startsWith("#") && !selectionActive()) return false;
    event.preventDefault();
    const href = openableLink(raw);
    if (!href || selectionActive() || window.PennedBlockSelection?.consumesClick(event)) return true;
    const editing = pointer?.anchor === anchor ? pointer.editing : editor.isFocused;
    if (!editor.isEditable || !editing || anchor.closest("[data-rich-link]") || event.metaKey || event.ctrlKey || event.detail === 0) {
      post("documentLinkOpen", { url: href });
    }
    return true;
  }

  function command(editor, name, args) {
    if (name === "setContent" || name === "setEditable" || name === "setSelectionMode") setHeld(editor, null);
    if (name === "linksBegin") return begin(editor, args);
    if (name === "linksApply") return apply(editor, args);
    if (name === "linksEnd") { if (held?.token === args.token) setHeld(editor, null); return true; }
    if (name === "linksSelected") return action(editor, args);
    if (name === "linksMetadata") return extractLinkMetadata(args.html, args.href, editor.view.dom.ownerDocument);
  }

  return { node, integration, command, handleClick, formatting(editor) {
    const range = textRange(editor);
    return { canLinkText: !!range, textLinkActive: !!range?.existing, selectedLink: selectionInfo(editor) };
  }, pointerDown(editor, event) {
    const anchor = event.target.closest?.("a[href]");
    pointer = anchor ? { anchor, editing: editor.isFocused } : null;
  } };
}
