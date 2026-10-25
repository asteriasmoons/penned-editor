import { Node, getRenderedAttributes, mergeAttributes } from "@tiptap/core";

const collections = new Map();
const subscribers = new Set();
const nativeHeights = new Map();
let payloadSignature = "";

export function iconAssetCSSVariable(name) {
  return `--vellix-asset-${String(name).replace(/[^a-zA-Z0-9_-]/g, char => `_${char.codePointAt(0).toString(16)}_`)}`;
}

export function setCollections(records = []) {
  const next = new Map(records.filter(record => typeof record.id === "string").map(record => [record.id, record]));
  const signature = JSON.stringify([...next]);
  if (payloadSignature === signature) return;
  payloadSignature = signature;
  collections.clear();
  for (const [id, record] of next) collections.set(id, record);
  for (const render of subscribers) render();
}

export function setNativeCollectionHeight({ blockID, viewID, height }) {
  if (!Number.isFinite(height) || height < 120 || height > 560) return false;
  const hosts = Array.from(document.querySelectorAll("[data-native-collection-block]"))
    .filter(element => element.dataset.nativeCollectionBlock === blockID && element.dataset.nativeCollectionView === viewID);
  if (!hosts.length) return false;
  nativeHeights.set(`${blockID}:${viewID}`, height);
  for (const host of hosts) host.style.height = `${height}px`;
  return true;
}

export function collectionNode({ post, selectionActive, reportHeight }) {
  return Node.create({
    name: "collection", group: "block", atom: true, selectable: true,
    addAttributes() {
      return {
        collectionID: { default: "", parseHTML: element => element.dataset.collectionId || "", renderHTML: attrs => ({ "data-collection-id": attrs.collectionID }) },
        documentID: { default: "", parseHTML: element => element.dataset.collectionDocument || "", renderHTML: attrs => ({ "data-collection-document": attrs.documentID }) },
      };
    },
    parseHTML() { return [{ tag: "div[data-collection-id]" }]; },
    renderHTML({ HTMLAttributes }) { return ["div", mergeAttributes(HTMLAttributes, { class: "penned-collection" }), "Collection"]; },
    addNodeView() {
      return ({ node, editor }) => {
        let current = node, limit = 100, viewStamp = "";
        const galleryScrollPositions = new Map();
        const dom = document.createElement("div");
        dom.className = "penned-collection";
        dom.contentEditable = "false";
        const icon = name => {
          const span = document.createElement("span");
          span.className = "penned-collection-icon";
          span.style.maskImage = span.style.webkitMaskImage = `var(${iconAssetCSSVariable(name)}, url("vellix-icon://asset/${encodeURIComponent(name)}?tint=%23FFFFFF&size=24"))`;
          span.setAttribute("aria-hidden", "true");
          return span;
        };
        const request = (action, args = {}) => {
          if (selectionActive() || !editor.isEditable) return;
          editor.commands.blur();
          post("collectionRequest", { action, blockID: current.attrs.id, collectionID: current.attrs.collectionID, ...args });
        };
        const button = (label, action, args = {}, asset = null) => {
          const result = document.createElement("button");
          result.type = "button"; result.className = "penned-collection-button";
          result.title = label; result.setAttribute("aria-label", label);
          if (asset) result.append(icon(asset)); else result.textContent = label;
          result.addEventListener("click", event => { event.preventDefault(); event.stopPropagation(); request(action, args); });
          return result;
        };
        const valueControl = (record, field) => {
          const value = record.values?.[field.id];
          const result = button(`Edit ${field.name} for ${record.title}`, "value", { documentID: record.id, fieldID: field.id });
          result.classList.add("penned-collection-value");
          result.replaceChildren();
          if (value?.chips?.length) {
            for (const chip of value.chips) {
              const span = document.createElement("span"); span.className = "penned-collection-chip";
              span.textContent = chip.name;
              const color = /^#[0-9a-f]{6,8}$/i.test(chip.color) ? chip.color : "#b59ad9";
              span.style.setProperty("--chip-color", color); result.append(span);
            }
          } else if (field.kind === "checkbox" && !value?.empty) {
            result.append(icon(value.checked ? "checkwavy" : "minuswavy"));
            const caption = document.createElement("span"); caption.textContent = value.text; result.append(caption);
          } else {
            result.textContent = value?.text || "Not set";
            result.classList.toggle("penned-collection-empty-value", !value || value.empty);
          }
          return result;
        };
        const render = () => {
          const record = collections.get(current.attrs.collectionID);
          const oldScroll = dom.querySelector(".penned-collection-scroll")?.scrollLeft || 0;
          const previousGallery = dom.querySelector(".penned-collection-gallery-scroll");
          if (previousGallery) galleryScrollPositions.set(viewStamp, previousGallery.scrollTop);
          dom.replaceChildren();
          delete dom.dataset.nativeCollection;
          delete dom.dataset.nativeCollectionBlock;
          delete dom.dataset.nativeCollectionView;
          dom.style.height = "";
          dom.removeAttribute("aria-hidden");
          for (const [key, value] of Object.entries(getRenderedAttributes(current, editor.extensionManager.attributes))) dom.setAttribute(key, value);
          if (!record) {
            const missing = button(current.attrs.collectionID ? "Collection unavailable" : "Create Collection", current.attrs.collectionID ? "openCollection" : "create");
            missing.disabled = Boolean(current.attrs.collectionID);
            dom.append(missing); return;
          }
          const nextStamp = `${record.viewID}:${record.kind}`;
          if (viewStamp !== nextStamp) { viewStamp = nextStamp; limit = record.kind === "gallery" ? 40 : 100; }
          if (record.kind === "kanban") {
            // Only reserve the atom's position. The interactive board is native SwiftUI.
            dom.dataset.nativeCollection = record.id;
            dom.dataset.nativeCollectionBlock = current.attrs.id || "";
            dom.dataset.nativeCollectionView = record.viewID;
            dom.style.height = `${nativeHeights.get(`${current.attrs.id}:${record.viewID}`) ?? (Number(record.nativeHeight) || 560)}px`;
            dom.setAttribute("aria-hidden", "true");
            requestAnimationFrame(reportHeight);
            return;
          }
          const header = document.createElement("div"); header.className = "penned-collection-header";
          const title = button(record.name, "configure"); title.classList.add("penned-collection-name");
          const selector = button(record.viewName, "menu", { viewID: record.viewID }); selector.append(icon("chevdown"));
          selector.classList.add("penned-collection-selector");
          header.append(title, selector, button("Configure Collection", "configure", {}, "dotswavy")); dom.append(header);
          const entries = record.entries || [], fields = record.fields || [];
          let footerParent = dom;
          if (record.kind === "gallery") {
            const viewport = document.createElement("div"); viewport.className = "penned-collection-gallery-scroll";
            viewport.setAttribute("role", "region"); viewport.setAttribute("aria-label", `${record.name}, ${record.viewName}`);
            viewport.tabIndex = 0; dom.append(viewport); footerParent = viewport;
          }
          if (!entries.length && record.kind === "gallery") {
            const empty = document.createElement("div"); empty.className = "penned-collection-empty";
            empty.textContent = record.totalCount ? "No matching entries" : "No entries yet"; footerParent.append(empty);
          } else if (record.kind === "gallery") {
            const grid = document.createElement("div"); grid.className = "penned-collection-gallery";
            grid.style.setProperty("--collection-columns", Math.min(3, Math.max(1, Number(record.galleryColumns) || 2)));
            grid.classList.toggle("penned-collection-compact", Boolean(record.compactCards));
            for (const entry of entries.slice(0, limit)) {
              const card = document.createElement("article"); card.className = "penned-collection-card";
              const open = button(entry.title, "openEntry", { documentID: entry.id }); open.classList.add("penned-collection-card-open"); open.replaceChildren();
              if (record.showsCover) {
                const cover = document.createElement("div"); cover.className = "penned-collection-cover";
                if (/^penned-cover:\/\/image\?/.test(entry.cover || "")) {
                  const img = document.createElement("img"); img.src = entry.cover; img.alt = ""; img.loading = "lazy"; img.draggable = false;
                  img.addEventListener("error", () => { img.remove(); cover.append(icon("imagesign")); });
                  cover.append(img);
                } else { cover.append(icon("imagesign")); }
                open.append(cover);
              }
              const title = document.createElement("span"); title.className = "penned-collection-card-title"; title.textContent = entry.title; open.append(title);
              card.append(open);
              const values = document.createElement("div"); values.className = "penned-collection-card-values";
              for (const field of fields) {
                const control = valueControl(entry, field);
                if (!entry.values?.[field.id]?.empty) values.append(control);
              }
              card.append(values);
              const actions = button(`Actions for ${entry.title}`, "entry", { documentID: entry.id }, "dotswavy"); actions.classList.add("penned-collection-entry-actions"); card.append(actions);
              grid.append(card);
            }
            footerParent.append(grid);
          } else {
            // CSS-grid table, deliberately separate from the rich-text table engine.
            const scroll = document.createElement("div"); scroll.className = "penned-collection-scroll";
            const table = document.createElement("div"); table.className = "penned-collection-table"; table.setAttribute("role", "table");
            table.style.setProperty("--collection-tracks", `220px ${fields.map(field => field.kind === "number" || field.kind === "checkbox" ? "120px" : "180px").join(" ")} 44px`);
            const heading = document.createElement("div"); heading.className = "penned-collection-row penned-collection-heading"; heading.setAttribute("role", "row");
            const titleHeading = document.createElement("span"); titleHeading.textContent = "Title"; titleHeading.setAttribute("role", "columnheader"); heading.append(titleHeading);
            for (const field of fields) {
              const cell = button(field.name, "field", { fieldID: field.id }); cell.prepend(icon(field.icon)); cell.setAttribute("role", "columnheader"); heading.append(cell);
            }
            heading.append(button("Add Property", "field", {}, "addwavy")); table.append(heading);
            for (const entry of entries.slice(0, limit)) {
              const row = document.createElement("div"); row.className = "penned-collection-row"; row.setAttribute("role", "row");
              const title = button(entry.title, "openEntry", { documentID: entry.id }); title.classList.add("penned-collection-table-title"); title.setAttribute("role", "cell"); row.append(title);
              for (const field of fields) { const cell = valueControl(entry, field); cell.setAttribute("role", "cell"); row.append(cell); }
              row.append(button(`Actions for ${entry.title}`, "entry", { documentID: entry.id }, "dotswavy")); table.append(row);
            }
            scroll.append(table); dom.append(scroll); scroll.scrollLeft = oldScroll;
            if (!entries.length) {
              const empty = document.createElement("div"); empty.className = "penned-collection-empty";
              empty.textContent = record.totalCount ? "No matching entries" : "No entries yet"; dom.append(empty);
            }
          }
          const footer = document.createElement("div"); footer.className = "penned-collection-footer";
          const add = record.kind === "gallery" ? button("New Entry", "addEntry", {}, "addwavy") : button("New Entry", "addEntry");
          if (record.kind !== "gallery") add.prepend(icon("addwavy")); footer.append(add);
          if (entries.length > limit) {
            const more = document.createElement("button"); more.type = "button"; more.className = "penned-collection-button"; more.textContent = `Show More (${entries.length - limit})`;
            more.addEventListener("click", event => { event.preventDefault(); event.stopPropagation(); limit += record.kind === "gallery" ? 40 : 100; render(); }); footer.append(more);
          }
          footerParent.append(footer);
          if (record.kind === "gallery") {
            footerParent.scrollTop = galleryScrollPositions.get(viewStamp) || 0;
            const updateEdges = () => {
              footerParent.style.setProperty("--gallery-start-opacity", footerParent.scrollTop > 1 ? "0" : "1");
              footerParent.style.setProperty("--gallery-end-opacity", footerParent.scrollTop + footerParent.clientHeight < footerParent.scrollHeight - 1 ? "0" : "1");
            };
            footerParent.addEventListener("scroll", updateEdges, { passive: true });
            requestAnimationFrame(updateEdges);
          }
          requestAnimationFrame(reportHeight);
        };
        dom.addEventListener("mousedown", event => { if (!selectionActive()) { event.preventDefault(); event.stopPropagation(); } });
        dom.addEventListener("pointerdown", event => { if (!selectionActive()) event.stopPropagation(); });
        subscribers.add(render); render();
        return {
          dom,
          update(next) { if (next.type !== current.type) return false; current = next; render(); return true; },
          stopEvent: () => !selectionActive(), ignoreMutation: () => true,
          destroy() {
            subscribers.delete(render);
            for (const key of nativeHeights.keys()) if (key.startsWith(`${current.attrs.id}:`)) nativeHeights.delete(key);
          },
        };
      };
    },
  });
}
