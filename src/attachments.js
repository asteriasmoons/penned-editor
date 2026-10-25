import { Plugin, TextSelection } from "@tiptap/pm/state";
import { DOMSerializer, Fragment, Slice } from "@tiptap/pm/model";
import { closeHistory } from "@tiptap/pm/history";
import { audioPlayer } from "./audio-player.js";
import { videoPlayer } from "./video-player.js";
import { attachmentActions } from "./attachment-actions.js";

const modes = { image: ["inline", "fullWidth", "card"], pdf: ["preview", "card"], video: ["player", "card"], audio: ["player", "card"], file: ["card"] };
export function containsAttachments(nodes) { return nodes.some(node => node.type === "attachment" || containsAttachments(node.content || [])); }
export function attachmentLayout(file, attrs = {}) {
  const kind = Object.hasOwn(modes, file?.kind) ? file.kind : "file";
  return { mode: modes[kind].includes(attrs.displayMode) ? attrs.displayMode : modes[kind][0],
    width: Number.isFinite(attrs.widthPercent) ? Math.max(10, Math.min(100, attrs.widthPercent)) : null,
    alignment: ["left", "center", "right"].includes(attrs.textAlign) ? attrs.textAlign : "left" };
}
export function attachmentURL(file, preview = "") {
  if (!file?.relativePath || /[/\\\0]/.test(file.relativePath) || [".", ".."].includes(file.relativePath)) return "";
  return "penned-file://file/?path=" + encodeURIComponent(file.relativePath) + (preview ? "&preview=" + preview : "");
}

export function createAttachments({ Node, Extension, post, snapshot, selectionActive, reportHeight, iconCSS }) {
  let files = new Map(), bookmark = null, insertionToken = null;
  const clipboardRequests = new Map();
  const views = new Set();
  const actionHosts = new Map();
  const capture = editor => {
    bookmark = editor.state.selection.getBookmark(); insertionToken = crypto.randomUUID(); return insertionToken;
  };
  const importFiles = (editor, selected) => {
    if (selected.length > 20 || selected.reduce((total, file) => total + file.size, 0) > 64 * 1024 * 1024) {
      post("error", { message: "Use Add > File to import these files." }); return;
    }
    const token = capture(editor);
    // Native file imports stream from disk. The clipboard bridge is deliberately bounded.
    Promise.all(selected.map(file => new Promise((resolve, reject) => {
      if (file.size > 32 * 1024 * 1024) { reject(new Error("Use Add > File for files larger than 32 MB.")); return; }
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("The pasted file could not be read."));
      reader.onload = () => resolve({ name: file.name || "Image.png", mimeType: file.type, base64: String(reader.result).split(",")[1] });
      reader.readAsDataURL(file);
    }))).then(items => post("attachmentImport", { token, files: items }))
      .catch(error => post("error", { message: error.message }));
  };
  const integration = Extension.create({ name: "pennedAttachmentIntegration", addProseMirrorPlugins() {
    const editor = this.editor;
    return [new Plugin({
      view(view) {
        const actions = attachmentActions({ root: view.dom, enabled: () => !selectionActive(),
          request: host => actionHosts.get(host)?.() });
        return { update(view, previous) { if (previous.doc !== view.state.doc || selectionActive()) actions.cancel(); }, destroy: () => actions.destroy() };
      },
      state: { init: () => null, apply(tr, value) { if (bookmark) bookmark = bookmark.map(tr.mapping); return value; } },
      appendTransaction(transactions, old, state) {
        if (!transactions.some(tr => tr.docChanged)) return null;
        const seen = new Set(), tr = state.tr;
        state.doc.descendants((node, pos) => {
          if (node.type.name !== "attachment") return;
          if (!node.attrs.id || seen.has(node.attrs.id)) tr.setNodeMarkup(pos, undefined, { ...node.attrs, id: crypto.randomUUID() });
          seen.add(tr.doc.nodeAt(pos).attrs.id);
        });
        return tr.docChanged ? tr : null;
      }, props: {
      transformPasted(slice) {
        const copy = fragment => Fragment.fromArray(Array.from({ length: fragment.childCount }, (_, index) => {
          const node = fragment.child(index);
          if (node.isText) return node;
          return node.type.create(node.type.name === "attachment" ? { ...node.attrs, id: crypto.randomUUID() } : node.attrs, copy(node.content), node.marks);
        }));
        return new Slice(copy(slice.content), slice.openStart, slice.openEnd);
      },
      handlePaste(view, event) {
        const selected = Array.from(event.clipboardData?.files || []);
        if (!selected.length || !editor.isEditable || selectionActive()) return false;
        importFiles(editor, selected); return true;
      },
      handleDrop(view, event) {
        const selected = Array.from(event.dataTransfer?.files || []);
        if (!selected.length || !editor.isEditable || selectionActive()) return false;
        const position = view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (position) view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(position.pos))));
        importFiles(editor, selected); return true;
      }
    } })];
  } });
  const node = Node.create({ name: "attachment", group: "block", atom: true, selectable: true,
    addAttributes() { return { file: { default: null, rendered: false }, displayMode: { default: "auto", rendered: false }, widthPercent: { default: null, rendered: false } }; },
    parseHTML() { return [{ tag: "figure[data-penned-file]", getAttrs(element) {
      try { return { ...JSON.parse(element.dataset.pennedFile), id: element.dataset.vellixBlockId }; } catch { return false; }
    } }]; },
    renderHTML({ node, HTMLAttributes }) { return ["figure", { ...HTMLAttributes, "data-penned-file": JSON.stringify(node.attrs),
      "data-vellix-block-id": node.attrs.id, style: "text-align:" + (node.attrs.textAlign || "left") }, node.attrs.file?.name || "Attachment"]; },
    addNodeView() { return ({ node: initial, editor }) => {
      let current = initial, signature = "";
      const dom = document.createElement("figure"); dom.className = "penned-attachment"; dom.contentEditable = "false";
      dom.tabIndex = 0; dom.setAttribute("role", "group");
      const configure = (event, actions = event?.type === "contextmenu") => {
        if (selectionActive()) return;
        event?.preventDefault();
        post(actions ? "attachmentActions" : "attachmentMenu", { blockID: current.attrs.id, relativePath: current.attrs.file?.relativePath,
          ...attachmentLayout(files.get(current.attrs.file?.relativePath), current.attrs) });
      };
      actionHosts.set(dom, () => configure(null, true));
      dom.addEventListener("click", event => { if (!event.target.closest("video,audio,.penned-audio-pill,.penned-video-frame")) configure(event); });
      dom.addEventListener("keydown", event => { if (event.target === dom && ["Enter", " "].includes(event.key)) configure(event); });
      const render = () => {
        const stored = current.attrs.file, file = files.get(stored?.relativePath);
        const layout = attachmentLayout(file, current.attrs);
        dom.dataset.vellixBlockId = current.attrs.id;
        dom.dataset.vellixAlign = layout.alignment;
        dom.dataset.vellixIndent = String(current.attrs.indent || 0);
        dom.dataset.mode = layout.mode;
        dom.dataset.kind = file?.kind || "file";
        dom.style.marginLeft = layout.alignment === "left" ? "0" : "auto";
        dom.style.marginRight = layout.alignment === "right" ? "0" : "auto";
        dom.style.width = layout.mode === "fullWidth" ? "100%" : layout.width ? layout.width + "%" : file?.kind === "image" && layout.mode === "inline" ? "fit-content" : "100%";
        const next = JSON.stringify([file?.attachmentID, file?.relativePath, file?.name || stored?.name, file?.mimeType,
          file?.kind, file?.size, file?.width, file?.height, file?.previewPath, layout.mode]);
        if (signature === next) return;
        signature = next;
        dom.querySelectorAll("video,audio").forEach(player => player.pause());
        dom.setAttribute("aria-label", file?.name || stored?.name || "Attachment"); dom.replaceChildren();
        const card = message => {
          const button = document.createElement("button"); button.type = "button"; button.className = "penned-file-card";
          const type = document.createElement("span"); type.className = "penned-file-type";
          type.textContent = (file?.typeLabel || (file?.kind === "image" ? file.mimeType?.split("/").pop()?.replace("+xml", "") : file?.name?.split(".").pop()) || "FILE").slice(0, 8).toUpperCase();
          const info = document.createElement("span"); info.className = "penned-file-info";
          const title = document.createElement("strong"); title.textContent = file?.name || stored?.name || "Attachment unavailable";
          const detail = document.createElement("small");
          detail.textContent = message || (file?.size >= 1048576 ? (file.size / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round((file?.size || 0) / 1024)) + " KB");
          info.append(title, detail); button.append(type, info); dom.appendChild(button);
        };
        if (!file) { card("File unavailable in this Space"); reportHeight(); return; }
        if (layout.mode === "card") card();
        else if (file.kind === "image" || file.kind === "pdf") {
          const img = document.createElement("img"); img.alt = file.name; img.draggable = false;
          if (file.width && file.height && file.mimeType !== "image/svg+xml") { img.width = file.width; img.height = file.height; img.style.aspectRatio = file.width + "/" + file.height; }
          img.src = attachmentURL(file, file.kind === "pdf" ? "pdf" : /heic|heif/.test(file.mimeType) ? "image" : "");
          img.addEventListener("load", reportHeight, { once: true });
          img.addEventListener("error", () => { dom.replaceChildren(); card("Preview unavailable. Open original file."); reportHeight(); }, { once: true });
          if (file.kind === "pdf") { dom.classList.add("is-pdf"); card(); }
          else dom.classList.remove("is-pdf");
          dom.prepend(img);
        } else {
          const player = document.createElement(file.kind === "audio" ? "audio" : "video");
          player.controls = true; player.preload = "metadata"; player.setAttribute("playsinline", "");
          player.src = attachmentURL(file);
          player.addEventListener("loadedmetadata", reportHeight, { once: true });
          player.addEventListener("error", () => { dom.replaceChildren(); card("Playback unavailable. Open original file."); reportHeight(); }, { once: true });
          dom.appendChild(file.kind === "audio" ? audioPlayer(player, file, { iconCSS,
            menu: event => configure(event, true), canInteract: () => !selectionActive(),
            error: message => post("error", { message }) }) : videoPlayer(player, file, { iconCSS, reportHeight,
            posterURL: file.previewPath ? attachmentURL(file, "thumbnail") : "", canInteract: () => !selectionActive(),
            error: message => post("error", { message }) }));
        }
        reportHeight();
      };
      views.add(render); render();
      return { dom, update(updated) { if (updated.type.name !== "attachment") return false; current = updated; render(); return true; },
        ignoreMutation: mutation => mutation.type !== "selection",
        stopEvent: event => !selectionActive() && !!event.target.closest?.("button,video,audio,.penned-audio-pill,.penned-video-frame"),
        destroy() { actionHosts.delete(dom); views.delete(render); dom.querySelectorAll("video,audio").forEach(player => { player.pause(); player.removeAttribute("src"); player.load(); }); } };
    }; }
  });
  function command(editor, name, args) {
    if (name === "setContent") {
      bookmark = null; insertionToken = null;
      clipboardRequests.forEach(resolve => resolve(false)); clipboardRequests.clear();
    }
    if (name === "setAttachments") {
      files = new Map((args.files || []).filter(file => attachmentURL(file)).map(file => [file.relativePath, file]));
      views.forEach(render => render()); return true;
    }
    if (!name.startsWith("attachment")) return undefined;
    if (name === "attachmentClipboardResult") {
      clipboardRequests.get(args.token)?.(args.success === true); clipboardRequests.delete(args.token); return true;
    }
    if (name === "attachmentPauseAll") {
      editor.view.dom.querySelectorAll(".penned-attachment video,.penned-attachment audio").forEach(player => player.pause());
      return true;
    }
    if (name === "attachmentCaptureInsertion") return capture(editor);
    if (!editor.isEditable || selectionActive()) return false;
    if (name === "attachmentInsert") {
      if (args.token && args.token !== insertionToken) return false;
      const file = files.get(args.file?.relativePath);
      if (!file || file.attachmentID !== args.file.attachmentID) return false;
      editor.view.dispatch(closeHistory(editor.state.tr));
      const blockID = crypto.randomUUID();
      const chain = editor.chain().focus();
      if (bookmark) chain.command(({ tr }) => { tr.setSelection(bookmark.resolve(tr.doc)); return true; });
      const result = chain.insertContent({ type: "attachment", attrs: { id: blockID, file } }, { updateSelection: false }).command(({ tr }) => {
        let after = null;
        tr.doc.descendants((node, pos) => { if (node.attrs.id === blockID) { after = pos + node.nodeSize; return false; } });
        if (after == null) return false;
        if (!tr.doc.resolve(after).nodeAfter?.isTextblock) tr.insert(after, editor.schema.nodes.paragraph.create({ id: crypto.randomUUID() }));
        tr.setSelection(TextSelection.create(tr.doc, after + 1)); return true;
      }).run();
      if (result) { bookmark = editor.state.selection.getBookmark(); editor.view.dispatch(closeHistory(editor.state.tr)); post("snapshot", snapshot()); }
      return result;
    }
    let target = null;
    editor.state.doc.descendants((node, pos) => { if (node.type.name === "attachment" && node.attrs.id === args.blockID) target = { node, pos }; });
    if (!target) return false;
    if (!["attachmentDelete", "attachmentUpdate"].includes(name)) return false;
    editor.view.dispatch(closeHistory(editor.state.tr));
    if (name === "attachmentDelete") editor.view.dispatch(editor.state.tr.delete(target.pos, target.pos + target.node.nodeSize));
    else if (name === "attachmentUpdate") {
      const layout = attachmentLayout(files.get(target.node.attrs.file?.relativePath), { displayMode: args.mode, widthPercent: args.width, textAlign: args.alignment });
      editor.view.dispatch(editor.state.tr.setNodeMarkup(target.pos, undefined, { ...target.node.attrs, displayMode: layout.mode, widthPercent: layout.width, textAlign: layout.alignment }));
    } else return false;
    editor.view.dispatch(closeHistory(editor.state.tr)); post("snapshot", snapshot()); return true;
  }
  async function copyBlocks(editor, blocks, text) {
    if (!containsAttachments(blocks)) return undefined;
    const wrapper = document.createElement("div");
    const fragment = Fragment.fromArray(blocks.map(node => editor.schema.nodeFromJSON(node)));
    wrapper.appendChild(DOMSerializer.fromSchema(editor.schema).serializeFragment(fragment));
    const token = crypto.randomUUID();
    return await new Promise(resolve => {
      const timer = setTimeout(() => { clipboardRequests.delete(token); resolve(false); }, 5000);
      clipboardRequests.set(token, success => { clearTimeout(timer); resolve(success); });
      post("attachmentClipboard", { token, html: wrapper.innerHTML, text });
    });
  }
  return { node, integration, command, copyBlocks };
}
