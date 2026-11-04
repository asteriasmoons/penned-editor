// Shared by the source editor and the shipped WebKit editor; no separate template editor.
(function (global) {
  function canonical(node) {
    if (!node || typeof node !== "object") return node;
    const result = { ...node };
    if (node.attrs) {
      result.attrs = { ...node.attrs };
      if (node.attrs.placeholderProjection) {
        result.attrs.placeholderGuidance = node.content || [];
        result.attrs.placeholderEnabled = true;
        delete result.attrs.placeholderProjection;
        result.content = [];
      }
      delete result.attrs.placeholderProjection;
    }
    if (result.content) result.content = result.content.map(canonical);
    return result;
  }
  function guidanceText(value) {
    if (!Array.isArray(value)) return "";
    return value.map(function (node) {
      if (!node || typeof node !== "object") return "";
      return node.type === "hardBreak" ? "\n" : (node.text || "");
    }).join("");
  }
  function createExtension(api) {
    const { Extension, Plugin, PluginKey, Decoration, DecorationSet, TextSelection, NodeSelection, ReplaceStep, isHistoryTransaction } = api;
    const key = new PluginKey("vellixStructuredPlaceholders");
    const control = { template: false, active: false, request: null, editor: null };
    function eligible(node) { return node && node.isTextblock; }
    function isProtected(node) { return control.template && !control.active && !!node?.attrs.placeholderEnabled; }
    const marked = node => !node.isText && (node.attrs.placeholderEnabled || node.attrs.placeholderProjection);
    function buildIndex(doc) {
      if (global.PennedIncrementalNodes) return global.PennedIncrementalNodes.createNodeIndex(doc, marked);
      const records = [];
      doc.descendants((node, pos) => { if (marked(node)) records.push({ node, pos }); return !node.isText; });
      return { doc, records };
    }
    const regions = state => (key.getState(state) || buildIndex(state.doc)).records;
    function lockedOwner(position) {
      for (let depth = 1; depth <= position.depth; depth++) {
        if (position.node(depth).attrs.placeholderEnabled) return { node: position.node(depth), pos: position.before(depth) };
      }
      return null;
    }
    function selectedDeletionRanges(tr, state) {
      const explicit = tr.getMeta("pennedPlaceholderDeletion");
      if (Array.isArray(explicit)) return explicit.filter(range => range && Number.isInteger(range.from) &&
        Number.isInteger(range.to) && range.from >= 0 && range.to <= state.doc.content.size && range.from < range.to);
      if (state.selection.empty || !tr.steps.length || ["paste", "drop"].includes(tr.getMeta("uiEvent"))) return [];
      const deletion = tr.steps.every((step, index) => {
        if (!(step instanceof ReplaceStep)) return false;
        if (!step.slice.size) return true;
        // Deleting a parent's last block uses its required empty paragraph.
        const filler = step.slice.content.firstChild;
        const from = tr.docs[index].resolve(step.from), to = tr.docs[index].resolve(step.to);
        return from.sameParent(to) && step.from === from.start() && step.to === from.end() &&
          !step.slice.openStart && !step.slice.openEnd && step.slice.content.childCount === 1 &&
          filler.type.name === "paragraph" && !filler.content.size && !filler.attrs.placeholderEnabled;
      });
      return deletion ? state.selection.ranges.map(range => ({ from: range.$from.pos, to: range.$to.pos })) : [];
    }
    function preservesLockedRegions(tr, state) {
      let byID;
      const deletions = selectedDeletionRanges(tr, state);
      const history = isHistoryTransaction(tr);
      for (const region of regions(state)) {
        if (!region.node.attrs.placeholderEnabled) continue;
        const start = tr.mapping.mapResult(region.pos, 1);
        const end = tr.mapping.map(region.pos + region.node.nodeSize, -1);
        const next = !start.deleted && tr.doc.nodeAt(start.pos);
        if (next && next.nodeSize === end - start.pos && next.eq(region.node)) continue;
        // Established block commands can replace the full document. Unchanged
        // placeholders must retain their identity; selected deletions are scoped below.
        const id = region.node.attrs.id;
        if (id && !byID) {
          byID = new Map();
          tr.doc.descendants(node => {
            if (node.attrs.id) {
              const list = byID.get(node.attrs.id) || [];
              list.push(node); byID.set(node.attrs.id, list);
            }
            return !node.isText;
          });
        }
        const matches = id ? byID.get(id) || [] : [];
        if (matches.length === 1 && matches[0].eq(region.node)) continue;
        // Selection deletion may remove a whole placeholder, never edit one
        // in place. History replays those removals through the existing undo stack.
        if (matches.length) return false;
        if (deletions.some(range => range.from <= region.pos && range.to >= region.pos + region.node.nodeSize)) continue;
        if (history && id) continue;
        return false;
      }
      return true;
    }
    function current(state) {
      const selection = state.selection;
      for (let depth = selection.$from.depth; depth > 0; depth--) {
        const node = selection.$from.node(depth);
        if (eligible(node)) return { node: node, pos: selection.$from.before(depth) };
      }
      return null;
    }
    function requestConversion(target) {
      if (!target || control.request) return;
      control.request = { token: crypto.randomUUID(), pos: target.pos, node: JSON.stringify(target.node.toJSON()) };
      global.webkit?.messageHandlers?.tiptap?.postMessage({
        kind: "placeholderConversionRequest", payload: { token: control.request.token }
      });
    }
    function projectionTransaction(state) {
      let tr = state.tr;
      regions(state).filter(region => eligible(region.node)).slice().reverse().forEach(function (region) {
        const node = region.node, pos = region.pos;
        const attrs = { ...node.attrs };
        if (control.template && control.active && attrs.placeholderEnabled) {
          if (!attrs.placeholderProjection && node.content.size === 0) {
            const content = (Array.isArray(attrs.placeholderGuidance) ? attrs.placeholderGuidance : []).map(function (child) { return state.schema.nodeFromJSON(child); });
            tr.replaceWith(pos + 1, pos + 1 + node.content.size, content);
            tr.setNodeMarkup(pos, undefined, { ...attrs, placeholderProjection: true });
          }
          // canonical() saves live guidance. Replacing its paragraph on every key
          // disrupts the native keyboard's capitalization and composition state.
        } else if (attrs.placeholderProjection) {
          tr.setNodeMarkup(pos, undefined, { ...attrs, placeholderGuidance: node.content.toJSON() || [], placeholderProjection: false });
          tr.delete(pos + 1, pos + 1 + node.content.size);
        }
      });
      return tr.steps.length ? tr.setMeta(key, true) : null;
    }
    function refresh() {
      const editor = control.editor;
      if (!editor) return;
      const tr = projectionTransaction(editor.state) || editor.state.tr;
      if (control.active && tr.selection.node?.isTextblock && tr.selection.node.attrs.placeholderEnabled) {
        tr.setSelection(TextSelection.create(tr.doc, tr.selection.from + 1));
      }
      tr.setMeta(key, true).setMeta("addToHistory", false);
      editor.view.dispatch(tr);
      editor.view.dom.classList.toggle("vellix-placeholder-authoring", control.template && control.active);
    }
    function change(action, token) {
      const editor = control.editor;
      if (!control.template || !control.active || !editor || editor.isEditable === false) return false;
      let target = current(editor.state);
      if (token) {
        const pending = control.request;
        control.request = null;
        if (!pending || pending.token !== token) return false;
        const node = editor.state.doc.nodeAt(pending.pos);
        if (!node || JSON.stringify(node.toJSON()) !== pending.node) return false;
        target = { node: node, pos: pending.pos };
      }
      if (!target) return false;
      const node = target.node, pos = target.pos, tr = editor.state.tr;
      const attrs = { ...node.attrs };
      if (action === "convert") {
        attrs.placeholderEnabled = true;
        attrs.placeholderGuidance = node.content.toJSON() || [];
        attrs.placeholderProjection = control.active;
        tr.setNodeMarkup(pos, undefined, attrs);
        if (!control.active) tr.delete(pos + 1, pos + 1 + node.content.size);
      } else if (action === "ordinary") {
        const content = attrs.placeholderProjection ? node.content : (Array.isArray(attrs.placeholderGuidance) ? attrs.placeholderGuidance : []).map(function (child) { return editor.schema.nodeFromJSON(child); });
        attrs.placeholderEnabled = false;
        attrs.placeholderGuidance = null;
        attrs.placeholderProjection = false;
        tr.setNodeMarkup(pos, undefined, attrs);
        // Do not overwrite actual consumer text if this region is already populated.
        if (node.content.size === 0 || node.attrs.placeholderProjection) {
          tr.replaceWith(pos + 1, pos + 1 + node.content.size, content);
        }
      } else if (action === "clear") {
        attrs.placeholderEnabled = false;
        attrs.placeholderGuidance = null;
        attrs.placeholderProjection = false;
        tr.setNodeMarkup(pos, undefined, attrs);
        if (node.attrs.placeholderProjection) tr.delete(pos + 1, pos + 1 + node.content.size);
      } else return false;
      tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(pos + 1, tr.doc.content.size))));
      editor.view.dispatch(tr);
      editor.view.focus();
      return true;
    }
    function cleanSlice(slice, authoringPaste) {
      function walk(node) {
        if (node.isText) return node;
        const children = [];
        if (!node.attrs.placeholderProjection) node.content.forEach(function (child) { children.push(walk(child)); });
        const attrs = { ...node.attrs, placeholderProjection: false };
        if (authoringPaste && eligible(node) && children.length) {
          attrs.placeholderEnabled = true;
          attrs.placeholderGuidance = children.map(function (child) { return child.toJSON(); });
          attrs.placeholderProjection = true;
        }
        return node.type.create(attrs, node.content.constructor.fromArray(children), node.marks);
      }
      const children = [];
      slice.content.forEach(function (node) { children.push(walk(node)); });
      return new slice.constructor(slice.content.constructor.fromArray(children), slice.openStart, slice.openEnd);
    }
    function placeholderHeight(node, pos) {
      const text = guidanceText(node.attrs.placeholderGuidance);
      const element = control.editor?.view.nodeDOM?.(pos);
      if (element && global.getComputedStyle) {
        const style = global.getComputedStyle(element);
        const width = Math.max(1, element.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0));
        const canvas = document.createElement("canvas");
        const context = canvas.getContext?.("2d");
        if (context) {
          context.font = style.font;
          const lines = text.split("\n").reduce(function (count, line) {
            return count + Math.max(1, Math.ceil(context.measureText(line).width / width));
          }, 0);
          return lines * (parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5 || 24);
        }
      }
      return Math.max(1, text.split("\n").reduce(function (count, line) { return count + Math.max(1, Math.ceil(line.length / 32)); }, 0)) * 24;
    }
    function preserveGuidance(oldState, state, transactions) {
      if (!control.template) return null;
      const tr = state.tr;
      regions(oldState).forEach(function (region) {
        const old = region.node;
        if (!eligible(old) || !old.attrs.placeholderEnabled || !old.attrs.id) return;
        let pos = region.pos;
        transactions.forEach(transaction => { pos = transaction.mapping.map(pos, 1); });
        const node = state.doc.nodeAt(pos);
        if (node && node.attrs.id === old.attrs.id && node.type !== old.type) {
          let target = eligible(node) ? { node: node, pos: pos } : null;
          if (!target) node.descendants(function (child, offset) {
            if (!target && eligible(child)) target = { node: child, pos: pos + 1 + offset };
          });
          if (target && !target.node.attrs.placeholderEnabled) {
            tr.setNodeMarkup(target.pos, undefined, { ...target.node.attrs,
              placeholderEnabled: true, placeholderProjection: old.attrs.placeholderProjection === true,
              placeholderGuidance: old.attrs.placeholderProjection ? (old.content.toJSON() || []) : old.attrs.placeholderGuidance });
          }
        }
      });
      return tr.steps.length ? tr.setMeta(key, true) : null;
    }
    function guardSelection(state, oldState, transactions) {
      // A selected range is not an editing caret. Keep native text/block
      // selection intact; filterTransaction separately protects the content.
      if (!(state.selection instanceof TextSelection) || !state.selection.empty) return null;
      const target = lockedOwner(state.selection.$head) || lockedOwner(state.selection.$anchor);
      if (!target) return null;
      if (oldState.selection instanceof TextSelection &&
          !transactions.some(tr => tr.getMeta("pennedPlaceholderDocumentLoad"))) {
        let previous = oldState.selection.getBookmark();
        for (const tr of transactions) previous = previous.map(tr.mapping);
        previous = previous.resolve(state.doc);
        if (previous instanceof TextSelection && !lockedOwner(previous.$head) && !lockedOwner(previous.$anchor)) {
          return state.tr.setSelection(previous).setMeta(key, true).setMeta("addToHistory", false);
        }
      }
      // A newly loaded or just-locked placeholder is read-only, not a new
      // insertion point. Normal taps elsewhere still use the editor's own caret path.
      return state.tr.setSelection(NodeSelection.create(state.doc, target.pos))
        .setMeta(key, true).setMeta("addToHistory", false);
    }
    return Extension.create({
      name: "vellixStructuredPlaceholders",
      addStorage() { return { isProtected }; },
      addGlobalAttributes() {
        const types = this.extensions.filter(function (extension) { return extension.type === "node" && extension.name !== "text"; }).map(function (extension) { return extension.name; });
        return [{
          types: types,
          attributes: {
            placeholderEnabled: { default: false, keepOnSplit: false, rendered: false },
            placeholderGuidance: { default: null, keepOnSplit: false, rendered: false },
            placeholderProjection: { default: false, keepOnSplit: false, rendered: false }
          }
        }];
      },
      onCreate() {
        const editor = this.editor;
        if (control.editor === editor) return;
        control.editor = editor;
        const originalGetJSON = editor.getJSON.bind(editor);
        editor.getJSON = function () { return canonical(originalGetJSON()); };
        editor.getText = function () {
          const doc = editor.schema.nodeFromJSON(editor.getJSON());
          return doc.textBetween(0, doc.content.size, "\n\n");
        };
        editor.getHTML = function () {
          const doc = editor.schema.nodeFromJSON(editor.getJSON());
          const container = document.createElement("div");
          container.appendChild(api.DOMSerializer.fromSchema(editor.schema).serializeFragment(doc.content));
          return container.innerHTML;
        };
        const command = global.tiptapCommand;
        global.tiptapCommand = async function (name, args) {
          args = args || {};
          if (name === "getDocument") return editor.getJSON();
          if (name === "setTemplateEditing") {
            if (args.enabled === true && !(typeof args.templateID === "string" && args.templateID.trim() &&
                typeof args.documentID === "string" && args.documentID.trim())) return false;
            control.template = args.enabled === true;
            control.active = control.template && args.placeholderMode === true;
            control.request = null;
            refresh();
            await command(name, args);
            return true;
          }
          if (name === "setPlaceholderMode") {
            if (!control.template || editor.isEditable === false) return false;
            control.active = args.active === true;
            if (!control.active) control.request = null;
            if (control.active) {
              const target = current(editor.state);
              if (target && !target.node.attrs.placeholderEnabled) {
                if (target.node.content.size) requestConversion(target);
                else {
                  editor.view.dispatch(editor.state.tr.setNodeMarkup(target.pos, undefined,
                    { ...target.node.attrs, placeholderEnabled: true, placeholderGuidance: [], placeholderProjection: true }));
                }
              }
            }
            refresh();
            if (editor.isFocused) editor.view.focus();
            return true;
          }
          if (name === "placeholderAction") return change(args.action, args.token);
          if (name === "cancelPlaceholderConversion") { control.request = null; return true; }
          return command(name, args);
        };
        const style = document.createElement("style");
        style.textContent = ".vellix-guided-empty{display:flow-root;min-height:0 !important}.vellix-guided-empty::before{content:attr(data-vellix-guidance);float:left;width:100%;height:auto;margin-right:-100%;white-space:pre-wrap;color:currentColor;opacity:.38;pointer-events:none;user-select:none;-webkit-user-select:none;font-style:italic}.vellix-placeholder-authoring .vellix-guidance-region{color:color-mix(in srgb,currentColor 58%,transparent);font-style:italic}.vellix-placeholder-authoring .vellix-guidance-active{outline:1px dashed color-mix(in srgb,currentColor 25%,transparent);outline-offset:3px;border-radius:3px}";
        document.head.appendChild(style);
      },
      addProseMirrorPlugins() {
        return [new Plugin({
          key: key,
          state: {
            init: (_config, state) => buildIndex(state.doc),
            apply(tr, index) {
              if (!tr.docChanged) return index;
              return global.PennedIncrementalNodes
                ? global.PennedIncrementalNodes.updateNodeIndex(index, tr, marked) : buildIndex(tr.doc);
            }
          },
          filterTransaction(tr, state) {
            if (control.template && !control.active) {
              return !tr.docChanged || tr.getMeta(key) || tr.getMeta("pennedPlaceholderDocumentLoad") || preservesLockedRegions(tr, state);
            }
            if (!control.template || !control.active || !tr.docChanged || tr.getMeta(key) ||
                Object.keys(tr.meta).some(function (name) { return name.indexOf("history") >= 0; })) return true;
            const target = current(state);
            if (!target || target.node.attrs.placeholderEnabled || !target.node.content.size) return true;
            if (tr.mapping.mapResult(target.pos, 1).deleted) return true;
            const mapped = tr.mapping.map(target.pos);
            const next = tr.doc.nodeAt(mapped);
            if (target.node.attrs.id && next?.attrs.id !== target.node.attrs.id) return true;
            if (next && eligible(next) && next.type === target.node.type && next.textContent !== target.node.textContent) {
              requestConversion(target);
              return false;
            }
            return true;
          },
          appendTransaction(transactions, oldState, state) {
            if (control.template && !control.active &&
                transactions.some(function (tr) { return tr.selectionSet || tr.docChanged || tr.getMeta(key); })) {
              const guard = guardSelection(state, oldState, transactions);
              if (guard) return guard;
            }
            if (!transactions.some(function (tr) { return tr.docChanged; })) return null;
            const retained = preserveGuidance(oldState, state, transactions);
            if (retained) return retained;
            if (control.template && control.active) {
              const target = current(state);
              if (target && !target.node.attrs.placeholderEnabled && target.node.content.size) {
                const oldTarget = current(oldState);
                if (!oldTarget || oldTarget.node.content.size === 0) {
                  return state.tr.setNodeMarkup(target.pos, undefined, {
                    ...target.node.attrs, placeholderEnabled: true,
                    placeholderGuidance: target.node.content.toJSON() || [], placeholderProjection: true
                  }).setMeta(key, true);
                }
              }
            }
            const projected = projectionTransaction(state);
            if (projected && !transactions.some(function (tr) { return tr.getMeta(key); })) return projected;
            return projected;
          },
          props: {
            transformCopied: function (slice) { return cleanSlice(slice, false); },
            transformPasted: function (slice) { return cleanSlice(slice, control.template && control.active); },
            clipboardTextSerializer(slice) {
              return cleanSlice(slice).content.textBetween(0, cleanSlice(slice).content.size, "\n\n");
            },
            decorations(state) {
              const decorations = [];
              regions(state).forEach(function ({ node, pos }) {
                if (!node.attrs.placeholderEnabled) return;
                const locked = control.template && !control.active ? {
                  contenteditable: "false", "data-penned-placeholder-locked": "true",
                } : {};
                if (node.attrs.placeholderProjection) {
                  const active = state.selection.from >= pos && state.selection.from <= pos + node.nodeSize;
                  decorations.push(Decoration.node(pos, pos + node.nodeSize,
                    { ...locked, class: "vellix-guidance-region" + (active ? " vellix-guidance-active" : "") }));
                } else if (node.content.size === 0) {
                  decorations.push(Decoration.node(pos, pos + node.nodeSize,
                    { ...locked, class: "vellix-guided-empty", "data-vellix-guidance": guidanceText(node.attrs.placeholderGuidance) }));
                } else if (control.template && !control.active) {
                  decorations.push(Decoration.node(pos, pos + node.nodeSize, locked));
                }
              });
              return DecorationSet.create(state.doc, decorations);
            }
          }
        })];
      }
    });
  }
  function initialize(editor) {
    const extension = editor.extensionManager.extensions.find(function (value) { return value.name === "vellixStructuredPlaceholders"; });
    if (extension) extension.config.onCreate.call({ editor: editor });
  }
  global.VellixStructuredPlaceholders = { createExtension: createExtension, initialize: initialize, canonical: canonical, guidanceText: guidanceText };
})(globalThis);

