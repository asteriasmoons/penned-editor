import { Node, getRenderedAttributes, mergeAttributes } from "@tiptap/core";
import { normalizeProperty, propertyText, propertyURL } from "./inline-properties.js";

export function inlinePropertyNode({ post, selectionActive, reportHeight }) {
  return Node.create({
    name: "inlineProperty",
    group: "block",
    atom: true,
    selectable: true,
    addAttributes() {
      return {
        property: {
          default: normalizeProperty(),
          parseHTML: (element) => {
            try { return normalizeProperty(JSON.parse(element.getAttribute("data-vellix-property"))); }
            catch { return normalizeProperty(); }
          },
          renderHTML: ({ property }) => ({ "data-vellix-property": JSON.stringify(normalizeProperty(property)) }),
        },
      };
    },
    parseHTML() { return [{ tag: "div[data-vellix-property]" }]; },
    renderHTML({ node, HTMLAttributes }) {
      return ["div", mergeAttributes(HTMLAttributes, { class: "vellix-property" }), propertyText(node.attrs.property)];
    },
    addNodeView() {
      return ({ node, editor, getPos }) => {
        let current = node;
        let renderedKind = null;
        const dom = document.createElement("div");
        dom.className = "vellix-property";
        dom.contentEditable = "false";
        const label = document.createElement("button");
        label.type = "button";
        label.className = "vellix-property-name";
        label.title = "Configure property";
        const value = document.createElement("div");
        value.className = "vellix-property-value";
        dom.append(label, value);

        const canEdit = () => editor.isEditable && !selectionActive();
        const updateProperty = (changes) => {
          if (!canEdit()) return;
          const pos = getPos();
          if (typeof pos !== "number") return;
          const live = editor.state.doc.nodeAt(pos);
          if (live?.type.name !== "inlineProperty" || live.attrs.id !== current.attrs.id) return;
          editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, {
            ...live.attrs, property: normalizeProperty({ ...live.attrs.property, ...changes }),
          }));
        };
        const configure = () => {
          if (!canEdit()) return;
          editor.commands.blur();
          post("propertyEditorRequest", {
            blockId: current.attrs.id, property: normalizeProperty(current.attrs.property),
          });
        };
        // Property values are document metadata, not nested editing hosts.
        const action = (button, activate) => {
          button.addEventListener("pointerdown", (event) => {
            if (canEdit()) { event.preventDefault(); event.stopPropagation(); }
          });
          button.addEventListener("mousedown", (event) => event.preventDefault());
          button.addEventListener("click", (event) => {
            event.preventDefault(); event.stopPropagation();
            if (canEdit()) activate();
          });
        };
        action(label, configure);
        dom.addEventListener("pointerdown", (event) => {
          if (!selectionActive()) { event.preventDefault(); event.stopPropagation(); }
        });
        dom.addEventListener("mousedown", (event) => {
          if (!selectionActive()) event.preventDefault();
        });

        const render = () => {
          const property = normalizeProperty(current.attrs.property);
          const emptyCaption = property.placeholder || "Tap title to configure";
          const attributes = getRenderedAttributes(current, editor.extensionManager.attributes);
          for (const [key, attr] of Object.entries(attributes)) dom.setAttribute(key, attr);
          dom.dataset.propertyKind = property.kind;
          label.textContent = property.name || "Property name";
          label.setAttribute("aria-label", property.name ? `Configure ${property.name}` : "Name property");
          label.disabled = !canEdit();
          if (renderedKind !== property.kind) {
            renderedKind = property.kind;
            value.replaceChildren();
            if (["text", "number"].includes(property.kind)) {
              const display = document.createElement("span");
              display.className = `vellix-property-caption vellix-property-${property.kind}`;
              value.append(display);
            } else {
              const button = document.createElement("button");
              button.type = "button";
              button.className = `vellix-property-control vellix-property-${property.kind}`;
              action(button, () => {
                const liveProperty = normalizeProperty(current.attrs.property);
                if (liveProperty.kind === "checkbox") updateProperty({ checked: !liveProperty.checked });
                else if (liveProperty.kind === "url" && propertyURL(liveProperty.value)) {
                  post("propertyURLRequest", { url: propertyURL(liveProperty.value) });
                } else configure();
              });
              value.append(button);
            }
          }
          if (["text", "number"].includes(property.kind)) {
            const display = value.firstElementChild;
            display.textContent = property.value
              ? property.kind === "number" ? `${property.prefix}${property.value}${property.suffix}` : property.value
              : emptyCaption;
            display.dataset.empty = String(!property.value);
          } else {
            const button = value.firstElementChild;
            button.replaceChildren();
            button.disabled = !canEdit();
            button.setAttribute("aria-label", property.name);
            button.dataset.empty = "false";
            if (property.kind === "checkbox") {
              button.setAttribute("role", "checkbox");
              button.setAttribute("aria-checked", String(property.checked));
              button.dataset.checked = String(property.checked);
              const indicator = document.createElement("span");
              indicator.className = "vellix-property-checkbox-indicator";
              indicator.setAttribute("aria-hidden", "true");
              const check = document.createElement("span");
              check.className = "vellix-property-checkbox-check";
              indicator.append(check);
              button.append(indicator);
            } else if (["select", "multiSelect"].includes(property.kind)) {
              const options = property.options.filter((option) => property.selectedOptionIDs.includes(option.id));
              for (const option of options) {
                const chip = document.createElement("span");
                chip.className = "vellix-property-option";
                chip.style.setProperty("--property-option-color", option.color);
                chip.textContent = option.name;
                button.append(chip);
              }
              if (!options.length) button.textContent = emptyCaption;
              button.dataset.empty = String(!options.length);
            } else if (property.kind === "date") {
              // Civil dates stay in the user's calendar day, not a UTC conversion.
              const date = property.value ? new Date(`${property.value}${property.value.length === 10 ? "T00:00:00" : ""}`) : null;
              const validDate = date && Number.isFinite(date.getTime());
              if (validDate) {
                const icon = document.createElement("span");
                icon.className = "vellix-property-icon vellix-property-calendar";
                icon.setAttribute("aria-hidden", "true");
                const text = document.createElement("span");
                text.className = "vellix-property-display-text";
                text.textContent = date.toLocaleString(undefined, { dateStyle: "medium", ...(property.includeTime ? { timeStyle: "short" } : {}) });
                button.append(icon, text);
              } else button.textContent = emptyCaption;
              button.dataset.empty = String(!validDate);
            } else {
              const text = document.createElement("span");
              text.className = "vellix-property-display-text";
              text.textContent = property.value ? property.urlLabel || property.value : emptyCaption;
              button.append(text);
              if (propertyURL(property.value)) {
                const icon = document.createElement("span");
                icon.className = "vellix-property-icon vellix-property-link-arrow";
                icon.setAttribute("aria-hidden", "true");
                button.append(icon);
              }
              button.dataset.empty = String(!property.value);
            }
          }
          requestAnimationFrame(reportHeight);
        };
        const refreshEditable = () => {
          label.disabled = !canEdit();
          for (const control of value.querySelectorAll("button")) control.disabled = !canEdit();
        };
        const observer = new MutationObserver(refreshEditable);
        observer.observe(editor.view.dom, { attributes: true, attributeFilter: ["contenteditable"] });
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-vellix-selection-mode"] });
        render();
        return {
          dom,
          update(updated) {
            if (updated.type !== current.type) return false;
            current = updated;
            render();
            return true;
          },
          stopEvent: (event) => !selectionActive() && dom.contains(event.target),
          ignoreMutation: () => true,
          destroy() { observer.disconnect(); },
        };
      };
    },
  });
}
