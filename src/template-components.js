import { TextSelection } from "@tiptap/pm/state";

const kinds = new Set(["rating", "singleSelect", "multiSelect", "slider"]);
const titles = { rating: "Rating", singleSelect: "Single Select", multiSelect: "Multi-Select", slider: "Slider" };

export function componentDefinition(value) {
  if (!value || !kinds.has(value.kind)) throw new Error("Choose a valid template component.");
  const definition = { kind: value.kind, label: String(value.label || ""), minimum: Number(value.minimum ?? (value.kind === "slider" ? 0 : 1)),
    maximum: Number(value.maximum ?? (value.kind === "slider" ? 100 : 5)), step: Number(value.step ?? 1),
    minimumLabel: String(value.minimumLabel || ""), maximumLabel: String(value.maximumLabel || ""),
    choices: Array.isArray(value.choices) ? value.choices.map(choice => ({ id: String(choice.id || ""), label: String(choice.label || "").trim() })) : [] };
  const { kind, minimum, maximum, step, choices } = definition;
  if (![minimum, maximum, step].every(Number.isFinite) || Math.abs(minimum) > 1e9 || Math.abs(maximum) > 1e9) throw new Error("Enter finite component values.");
  if (kind === "rating" && (!Number.isInteger(minimum) || !Number.isInteger(maximum) || maximum <= minimum || maximum - minimum > 49)) throw new Error("Choose 2 to 50 whole-number ratings.");
  if (kind === "slider" && (maximum <= minimum || step <= 0 || step > maximum - minimum || !Number.isFinite((maximum - minimum) / step) || minimum + step === minimum || maximum - step === maximum)) throw new Error("Choose a valid slider range and step.");
  if ((kind === "singleSelect" || kind === "multiSelect") && (!choices.length || choices.length > 100 || choices.some(choice => !choice.id || !choice.label) || new Set(choices.map(choice => choice.id)).size !== choices.length)) throw new Error("Add named, independently identified choices.");
  if (kind === "rating") definition.step = 1;
  return definition;
}

export function componentResponse(definition, value) {
  const { kind, minimum, maximum, step, choices } = definition;
  if (kind === "multiSelect") return choices.filter(choice => Array.isArray(value) && value.includes(choice.id)).map(choice => choice.id);
  if (value == null) return null;
  if (kind === "singleSelect") return choices.some(choice => choice.id === value) ? value : null;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (kind === "rating") return Number.isInteger(value) && value >= minimum && value <= maximum ? value : null;
  const steps = Math.min(Math.floor((maximum - minimum) / step + 1e-9), Math.max(0, Math.round((value - minimum) / step)));
  return Number((minimum + steps * step).toPrecision(15));
}

export function createTemplateComponents({ Node, post, snapshot, selectionActive }) {
  let templateEditing = false;
  let activeRange = null;
  const views = new Set();
  const stopRangeDrag = event => { if (activeRange?.isConnected) event.preventDefault(); };
  const endRange = () => { activeRange = null; };
  document.addEventListener("dragstart", stopRangeDrag, true);
  document.addEventListener("pointerup", endRange, true);
  document.addEventListener("pointercancel", endRange, true);
  const node = Node.create({
    name: "templateComponent", group: "block", atom: true, selectable: true,
    onDestroy() {
      activeRange = null;
      views.clear();
      document.removeEventListener("dragstart", stopRangeDrag, true);
      document.removeEventListener("pointerup", endRange, true);
      document.removeEventListener("pointercancel", endRange, true);
    },
    addAttributes() {
      return { id: { default: null }, definition: { default: null, rendered: false }, response: { default: null, rendered: false } };
    },
    parseHTML() { return [{ tag: "section[data-template-component]", getAttrs: element => {
      try { return { id: element.dataset.vellixBlockId, definition: componentDefinition(JSON.parse(element.dataset.definition)), response: JSON.parse(element.dataset.response || "null") }; }
      catch { return false; }
    } }]; },
    renderHTML({ node, HTMLAttributes }) {
      return ["section", { ...HTMLAttributes, "data-template-component": "true", "data-vellix-block-id": node.attrs.id,
        "data-component-kind": node.attrs.definition?.kind,
        style: "text-align:" + (node.attrs.textAlign || "left"),
        "data-definition": JSON.stringify(node.attrs.definition), "data-response": JSON.stringify(node.attrs.response), class: "penned-template-component" }];
    },
    addNodeView() {
      return ({ node: initial, editor, getPos }) => {
        let current = initial, signature = "", controls = [], slider = null, output = null, configureButton = null, rangePressed = false;
        let touch = null, compatibilityClick = null;
        const dom = document.createElement("section");
        dom.className = "penned-template-component";
        dom.contentEditable = "false";
        dom.dataset.templateComponent = "true";
        const enabled = () => editor.isEditable && !selectionActive();
        const isRange = target => !!target.closest?.('input[type="range"]');
        const preventFocus = event => {
          if (selectionActive()) return;
          if (event.type === "pointerdown" && event.pointerType && event.pointerType !== "touch") compatibilityClick = null;
          // A native range must retain its default dragging and keyboard behavior.
          if (!isRange(event.target)) event.preventDefault();
          event.stopPropagation();
        };
        const touchStart = event => {
          touch = null;
          if (selectionActive()) return;
          event.stopPropagation();
          if (event.touches.length !== 1 || isRange(event.target)) return;
          const point = event.touches[0];
          touch = { id: point.identifier, x: point.clientX, y: point.clientY, moved: false,
            button: event.target.closest?.("button"), started: performance.now() };
          compatibilityClick = null;
        };
        const touchMove = event => {
          if (!touch) return;
          const point = Array.from(event.touches).find(point => point.identifier === touch.id);
          if (!point || event.touches.length !== 1 || Math.hypot(point.clientX - touch.x, point.clientY - touch.y) > 10) touch.moved = true;
        };
        const touchEnd = event => {
          const contact = touch; touch = null;
          if (selectionActive()) return;
          event.stopPropagation();
          const point = Array.from(event.changedTouches).find(point => point.identifier === contact?.id);
          if (!contact || contact.moved || !point || Math.hypot(point.clientX - contact.x, point.clientY - contact.y) > 10) return;
          // Cancel only a finished tap, not touchstart/move: starting here must still scroll.
          event.preventDefault();
          const button = event.target.closest?.("button");
          if (event.cancelable && button === contact.button && button && !button.disabled &&
              dom.contains(button) && performance.now() - contact.started < 500) {
            compatibilityClick = { button, until: performance.now() + 700 };
            button.click();
          }
        };
        const touchCancel = () => { touch = null; };
        const suppressCompatibilityClick = event => {
          if (!selectionActive() && event.detail > 0 && compatibilityClick?.button.contains(event.target) &&
              performance.now() < compatibilityClick.until) {
            event.preventDefault(); event.stopImmediatePropagation();
          }
        };
        const componentClick = event => {
          if (!selectionActive()) { event.preventDefault(); event.stopPropagation(); }
        };
        dom.addEventListener("pointerdown", preventFocus);
        dom.addEventListener("mousedown", preventFocus);
        dom.addEventListener("touchstart", touchStart, { passive: true });
        dom.addEventListener("touchmove", touchMove, { passive: true });
        dom.addEventListener("touchend", touchEnd, { passive: false });
        dom.addEventListener("touchcancel", touchCancel);
        dom.addEventListener("click", suppressCompatibilityClick, true);
        dom.addEventListener("click", componentClick);
        const configure = () => {
          if (enabled() && templateEditing) post("templateComponentConfigure", { blockID: current.attrs.id, definition: current.attrs.definition });
        };
        const commit = (value, flush = true) => {
          if (!enabled()) return;
          if (templateEditing) { configure(); return; }
          const position = getPos();
          if (typeof position !== "number" || editor.state.doc.nodeAt(position)?.attrs.id !== current.attrs.id) return;
          const response = componentResponse(componentDefinition(current.attrs.definition), value);
          editor.view.dispatch(editor.state.tr.setNodeMarkup(position, undefined, { ...current.attrs, response }));
          if (flush) post("snapshot", snapshot());
        };
        const renderState = () => {
          const definition = componentDefinition(current.attrs.definition);
          const response = componentResponse(definition, current.attrs.response);
          if (configureButton) configureButton.disabled = !enabled();
          for (const { button, value } of controls) {
            const selected = !templateEditing && (Array.isArray(response) ? response.includes(value) : response === value);
            if (definition.kind === "multiSelect") button.dataset.selectedMulti = String(selected);
            button.classList.toggle("is-selected", selected);
            button.setAttribute("aria-pressed", String(selected));
            button.disabled = !enabled();
          }
          if (slider) {
            const disabled = templateEditing || !enabled(), value = String(response ?? definition.minimum);
            if (slider.disabled !== disabled) slider.disabled = disabled;
            if (slider.value !== value) slider.value = value;
            const caption = response == null || templateEditing ? "" : String(response);
            output.hidden = !caption;
            if (output.textContent !== caption) output.textContent = caption;
          }
        };
        const render = () => {
          dom.dataset.vellixBlockId = current.attrs.id;
          dom.dataset.vellixAlign = current.attrs.textAlign || "left";
          dom.dataset.vellixIndent = String(Math.max(0, Math.min(6, Number(current.attrs.indent) || 0)));
          dom.style.textAlign = current.attrs.textAlign || "left";
          const next = JSON.stringify([current.attrs.definition, templateEditing, current.attrs.textAlign]);
          if (signature === next) { renderState(); return; }
          signature = next; controls = []; slider = null; output = null; configureButton = null;
          dom.replaceChildren();
          let definition;
          try { definition = componentDefinition(current.attrs.definition); }
          catch { dom.textContent = "Component unavailable"; return; }
          dom.dataset.componentKind = definition.kind;
          const heading = document.createElement(templateEditing ? "button" : "div");
          heading.className = "penned-component-question";
          heading.textContent = definition.label;
          if (templateEditing) {
            heading.type = "button"; heading.setAttribute("aria-label", "Configure " + titles[definition.kind]);
            heading.addEventListener("click", configure);
          }
          if (heading.textContent) dom.appendChild(heading);
          const group = document.createElement("div");
          group.className = "penned-component-choices" + (definition.kind === "rating" ? " is-rating" : "");
          group.style.justifyContent = current.attrs.textAlign === "center" ? "center" : current.attrs.textAlign === "right" ? "flex-end" : "flex-start";
          group.setAttribute("role", "group"); group.setAttribute("aria-label", definition.label || titles[definition.kind]);
          const addChoice = (label, value) => {
            const button = document.createElement("button");
            button.type = "button"; button.textContent = label;
            button.addEventListener("click", () => {
              const response = componentResponse(definition, current.attrs.response);
              commit(definition.kind === "multiSelect" ? (response.includes(value) ? response.filter(id => id !== value) : [...response, value]) : value);
            });
            controls.push({ button, value }); group.appendChild(button);
          };
          if (definition.kind === "rating") {
            for (let value = definition.minimum; value <= definition.maximum; value++) addChoice(String(value), value);
            dom.appendChild(group);
          } else if (definition.kind === "singleSelect" || definition.kind === "multiSelect") {
            definition.choices.forEach(choice => addChoice(choice.label, choice.id)); dom.appendChild(group);
          } else {
            output = document.createElement("output"); output.className = "penned-component-value";
            slider = document.createElement("input"); slider.type = "range";
            slider.min = String(definition.minimum); slider.max = String(definition.maximum); slider.step = String(definition.step);
            slider.setAttribute("aria-label", definition.label || "Slider");
            slider.addEventListener("pointerdown", () => { activeRange = slider; rangePressed = true; });
            slider.addEventListener("pointercancel", () => { rangePressed = false; });
            slider.addEventListener("pointerup", () => {
              if (rangePressed && !templateEditing && current.attrs.response == null) commit(Number(slider.value));
              rangePressed = false;
            });
            slider.addEventListener("input", () => commit(Number(slider.value), false));
            slider.addEventListener("change", () => {
              const position = getPos();
              if (enabled() && !templateEditing && typeof position === "number" && editor.state.doc.nodeAt(position)?.attrs.id === current.attrs.id) post("snapshot", snapshot());
            });
            const endpoints = document.createElement("div"); endpoints.className = "penned-component-endpoints";
            const minimum = document.createElement("span"), maximum = document.createElement("span");
            minimum.textContent = definition.minimumLabel || String(definition.minimum);
            maximum.textContent = definition.maximumLabel || String(definition.maximum);
            endpoints.append(minimum, output, maximum);
            dom.append(slider, endpoints);
            if (templateEditing) {
              configureButton = document.createElement("button");
              configureButton.type = "button";
              configureButton.className = "penned-component-configure";
              configureButton.setAttribute("aria-label", "Configure Slider");
              configureButton.addEventListener("click", configure);
              dom.appendChild(configureButton);
            }
          }
          renderState();
        };
        views.add(render); render();
        return { dom,
          // The default atom selection makes the entire section draggable, stealing range gestures.
          selectNode() { dom.classList.add("ProseMirror-selectednode"); },
          deselectNode() { dom.classList.remove("ProseMirror-selectednode"); },
          update(updated) { if (updated.type.name !== "templateComponent") return false; current = updated; render(); return true; },
          ignoreMutation(mutation) { return mutation.type !== "selection" || dom.contains(document.activeElement); },
          stopEvent() { return !selectionActive(); },
          destroy() {
            views.delete(render); touch = null; compatibilityClick = null;
            if (activeRange && dom.contains(activeRange)) activeRange = null;
            dom.removeEventListener("pointerdown", preventFocus);
            dom.removeEventListener("mousedown", preventFocus);
            dom.removeEventListener("touchstart", touchStart);
            dom.removeEventListener("touchmove", touchMove);
            dom.removeEventListener("touchend", touchEnd);
            dom.removeEventListener("touchcancel", touchCancel);
            dom.removeEventListener("click", suppressCompatibilityClick, true);
            dom.removeEventListener("click", componentClick);
          }
        };
      };
    }
  });
  function command(editor, name, args) {
    if (name === "setTemplateEditing") { templateEditing = args.enabled === true; views.forEach(render => render()); return true; }
    if (!name.startsWith("templateComponent")) return undefined;
    if (!templateEditing || !editor.isEditable || selectionActive()) return false;
    const definition = name === "templateComponentSave" ? componentDefinition(args.definition) : null;
    let position = null, target = null;
    if (args.blockID) editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "templateComponent" && node.attrs.id === args.blockID) { position = pos; target = node; }
    });
    if (args.blockID && !target) return false;
    let result = false;
    if (name === "templateComponentSave") {
      if (target) { editor.view.dispatch(editor.state.tr.setNodeMarkup(position, undefined, { ...target.attrs, definition, response: null })); result = true; }
      else {
        const blockID = crypto.randomUUID();
        const content = { type: "templateComponent", attrs: { id: blockID, definition, response: null } };
        const position = editor.state.selection.node?.isAtom ? editor.state.selection.to
          : { from: editor.state.selection.from, to: editor.state.selection.to };
        const chain = editor.chain().focus();
        result = chain.insertContentAt(position, content, { updateSelection: false }).command(({ tr }) => {
          let after = null;
          tr.doc.descendants((node, pos) => { if (node.attrs.id === blockID) { after = pos + node.nodeSize; return false; } });
          if (after == null) return false;
          // Continue in text, never a native range selection around the inserted atom.
          if (!tr.doc.resolve(after).nodeAfter?.isTextblock) tr.insert(after, editor.schema.nodes.paragraph.create({ id: crypto.randomUUID() }));
          tr.setSelection(TextSelection.create(tr.doc, after + 1));
          return true;
        }).run();
      }
    } else if (name === "templateComponentDelete" && target) {
      editor.view.dispatch(editor.state.tr.delete(position, position + target.nodeSize)); result = true;
    } else if (name === "templateComponentMove" && target) {
      const $pos = editor.state.doc.resolve(position), index = $pos.index(), parent = $pos.parent;
      const destination = index + (args.direction < 0 ? -1 : 1);
      if (destination >= 0 && destination < parent.childCount) {
        const children = []; parent.forEach(child => children.push(child));
        [children[index], children[destination]] = [children[destination], children[index]];
        const start = $pos.start();
        editor.view.dispatch(editor.state.tr.replaceWith(start, start + parent.content.size, children)); result = true;
      }
    }
    if (result) post("snapshot", snapshot());
    return result;
  }
  return { node, command, refresh: () => views.forEach(render => render()) };
}
