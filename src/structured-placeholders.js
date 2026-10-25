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
    const { Extension, Plugin, PluginKey, Decoration, DecorationSet, TextSelection } = api;
    const key = new PluginKey("vellixStructuredPlaceholders");
    const control = { template: false, active: false, request: null, editor: null };
    function eligible(node) { return node && node.isTextblock; }
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
      const regions = [];
      state.doc.descendants(function (node, pos) {
        if (eligible(node)) regions.push({ node: node, pos: pos });
      });
      regions.reverse().forEach(function (region) {
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
      tr.setMeta(key, true).setMeta("addToHistory", false);
      editor.view.dispatch(tr);
      editor.view.dom.classList.toggle("vellix-placeholder-authoring", control.template && control.active);
    }
    function change(action, token) {
      const editor = control.editor;
      if (!control.template || !editor) return false;
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
    function preserveGuidance(oldState, state) {
      if (!control.template) return null;
      const tr = state.tr;
      oldState.doc.descendants(function (old) {
        if (!eligible(old) || !old.attrs.placeholderEnabled || !old.attrs.id) return;
        state.doc.descendants(function (node, pos) {
          if (node.attrs.id !== old.attrs.id || node.type === old.type) return;
          let target = eligible(node) ? { node: node, pos: pos } : null;
          if (!target) node.descendants(function (child, offset) {
            if (!target && eligible(child)) target = { node: child, pos: pos + 1 + offset };
          });
          if (target && !target.node.attrs.placeholderEnabled) {
            tr.setNodeMarkup(target.pos, undefined, { ...target.node.attrs,
              placeholderEnabled: true, placeholderGuidance: old.attrs.placeholderProjection ? (old.content.toJSON() || []) : old.attrs.placeholderGuidance });
          }
        });
      });
      return tr.steps.length ? tr.setMeta(key, true) : null;
    }
    return Extension.create({
      name: "vellixStructuredPlaceholders",
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
            control.template = args.enabled === true;
            if (!control.template) control.active = false;
            refresh();
            await command(name, args);
            return true;
          }
          if (name === "setPlaceholderMode") {
            if (!control.template || editor.isEditable === false) return false;
            control.active = args.active === true;
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
        style.textContent = ".vellix-guided-empty::before{content:attr(data-vellix-guidance);float:left;height:0;max-width:100%;white-space:pre-wrap;color:currentColor;opacity:.38;pointer-events:none;user-select:none;-webkit-user-select:none;font-style:italic}.vellix-placeholder-authoring .vellix-guidance-region{color:color-mix(in srgb,currentColor 58%,transparent);font-style:italic}.vellix-placeholder-authoring .vellix-guidance-active{outline:1px dashed color-mix(in srgb,currentColor 25%,transparent);outline-offset:3px;border-radius:3px}";
        document.head.appendChild(style);
      },
      addProseMirrorPlugins() {
        return [new Plugin({
          key: key,
          filterTransaction(tr, state) {
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
            if (!transactions.some(function (tr) { return tr.docChanged; })) return null;
            const retained = preserveGuidance(oldState, state);
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
              state.doc.descendants(function (node, pos) {
                if (!eligible(node) || !node.attrs.placeholderEnabled) return;
                if (node.attrs.placeholderProjection) {
                  const active = state.selection.from >= pos && state.selection.from <= pos + node.nodeSize;
                  decorations.push(Decoration.node(pos, pos + node.nodeSize,
                    { class: "vellix-guidance-region" + (active ? " vellix-guidance-active" : "") }));
                } else if (node.content.size === 0) {
                  decorations.push(Decoration.node(pos, pos + node.nodeSize,
                    { class: "vellix-guided-empty", "data-vellix-guidance": guidanceText(node.attrs.placeholderGuidance),
                      style: "min-height:" + placeholderHeight(node, pos) + "px" }));
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

