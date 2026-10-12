import { Node, getRenderedAttributes, mergeAttributes } from "@tiptap/core";

const pages = new Map();
const subscribers = new Set();

export function normalizePageReferenceStarters(content) {
  // A legacy reference occupies the empty editing slot directly after its page break.
  return content.filter((node, index, nodes) => !(
    node.type === "paragraph" && !node.content?.length && !node.marks?.length &&
    !node.attrs?.indent && !node.attrs?.textAlign &&
    nodes[index - 1]?.type === "pageBreak" && nodes[index + 1]?.type === "pageReference"
  ));
}

// Presentation is supplied from live saved records; only the page ID is stored in the block.
export function setPageReferences(records) {
  pages.clear();
  for (const record of records || []) {
    if (typeof record.documentID === "string") pages.set(record.documentID, record);
  }
  for (const render of subscribers) render();
}

export function pageReferenceNode({ post, selectionActive }) {
  return Node.create({
    name: "pageReference",
    group: "block",
    atom: true,
    selectable: true,
    addAttributes() {
      return {
        documentID: {
          default: "",
          parseHTML: (element) => element.getAttribute("data-page-id") || "",
          renderHTML: (attrs) => ({ "data-page-id": attrs.documentID }),
        },
      };
    },
    parseHTML() { return [{ tag: "div[data-page-id]" }]; },
    renderHTML({ HTMLAttributes }) {
      return ["div", mergeAttributes(HTMLAttributes, { class: "vellix-page-reference" }), "Page"];
    },
    addNodeView() {
      return ({ node, editor }) => {
        let current = node;
        const dom = document.createElement("div");
        dom.className = "vellix-page-reference";
        dom.contentEditable = "false";
        const button = document.createElement("button");
        button.type = "button";
        button.className = "vellix-page-reference-button";
        const thumbnail = document.createElement("img");
        thumbnail.className = "vellix-page-thumbnail";
        thumbnail.alt = "";
        thumbnail.draggable = false;
        const text = document.createElement("span");
        text.className = "vellix-page-reference-text";
        const title = document.createElement("span");
        title.className = "vellix-page-reference-title";
        const excerpt = document.createElement("span");
        excerpt.className = "vellix-page-reference-excerpt";
        text.append(title, excerpt);
        const cardImage = document.createElement("img");
        cardImage.className = "vellix-page-card-image";
        cardImage.alt = "";
        cardImage.draggable = false;
        const credit = document.createElement("span");
        credit.className = "vellix-page-card-credit";
        button.append(thumbnail, text, cardImage);
        dom.append(button, credit);
        const safeURL = (value, host) => {
          try { const url = new URL(value); return url.protocol === "https:" && url.hostname === host ? url.href : null; }
          catch { return null; }
        };
        const creditLink = (label, value) => {
          const link = document.createElement("a");
          link.textContent = label;
          link.href = safeURL(value, "unsplash.com") || "https://unsplash.com/?utm_source=vellix&utm_medium=referral";
          link.addEventListener("click", event => {
            event.preventDefault(); event.stopPropagation();
            if (!selectionActive()) post("propertyURLRequest", { url: link.href });
          });
          return link;
        };
        const render = () => {
          const record = pages.get(current.attrs.documentID);
          dom.hidden = Boolean(current.attrs.documentID) && !record;
          for (const [key, value] of Object.entries(getRenderedAttributes(current, editor.extensionManager.attributes))) {
            dom.setAttribute(key, value);
          }
          title.textContent = record?.title || "Page";
          excerpt.textContent = record?.previewText || "Empty page";
          button.setAttribute("aria-label", `Open ${title.textContent}. ${excerpt.textContent}`);
          const isCard = Boolean(record?.cardImage);
          dom.classList.toggle("vellix-page-card", isCard);
          thumbnail.hidden = isCard || !record?.thumbnail;
          text.hidden = isCard;
          cardImage.hidden = !isCard;
          button.style.width = isCard ? `${Number(record.cardWidth) || 154}px` : "";
          button.style.aspectRatio = isCard ? `${Number(record.cardWidth) || 154} / ${Number(record.cardHeight) || 90}` : "";
          const backgroundURL = safeURL(record?.cardBackgroundURL, "images.unsplash.com");
          button.style.backgroundImage = isCard && backgroundURL ? `url(${JSON.stringify(backgroundURL)})` : "";
          if (isCard && cardImage.getAttribute("src") !== record.cardImage) cardImage.src = record.cardImage;
          credit.hidden = !isCard || !backgroundURL;
          credit.replaceChildren();
          if (!credit.hidden) credit.append("Photo by ", creditLink(record.photographer || "Photographer", record.photographerURL), " on ", creditLink("Unsplash", record.sourceURL));
          if (record?.thumbnail && thumbnail.getAttribute("src") !== record.thumbnail) thumbnail.src = record.thumbnail;
        };
        const preventFocus = (event) => {
          if (selectionActive()) return;
          event.stopPropagation();
          // Keep mouse activation out of the editor, but let touch scrolling remain native.
          if (event.type === "mousedown" || event.pointerType === "mouse") event.preventDefault();
        };
        dom.addEventListener("pointerdown", preventFocus);
        dom.addEventListener("mousedown", preventFocus);
        dom.addEventListener("touchstart", preventFocus, { passive: true });
        let pressTimer = null;
        let pressStart = null;
        let menuRequested = false;
        let suppressClick = false;
        const cancelPress = () => {
          clearTimeout(pressTimer);
          pressTimer = null;
          pressStart = null;
        };
        const requestActions = () => {
          cancelPress();
          if (menuRequested || selectionActive() || !pages.has(current.attrs.documentID)) return;
          menuRequested = true;
          suppressClick = true;
          editor.commands.blur();
          post("pageActionsRequest", { documentId: current.attrs.documentID });
        };
        button.addEventListener("pointerdown", (event) => {
          if (!event.isPrimary || selectionActive()) return;
          cancelPress();
          menuRequested = false;
          suppressClick = false;
          if (event.button !== 0) return;
          pressStart = { x: event.clientX, y: event.clientY, id: event.pointerId };
          pressTimer = setTimeout(requestActions, 550);
        });
        button.addEventListener("pointermove", (event) => {
          if (pressStart && (event.pointerId !== pressStart.id ||
              Math.hypot(event.clientX - pressStart.x, event.clientY - pressStart.y) > 10)) cancelPress();
        });
        button.addEventListener("pointerup", cancelPress);
        button.addEventListener("pointercancel", cancelPress);
        button.addEventListener("pointerleave", cancelPress);
        button.addEventListener("contextmenu", (event) => {
          if (selectionActive()) return;
          event.preventDefault();
          event.stopPropagation();
          requestActions();
        });
        const open = (event) => {
          if (selectionActive()) return;
          event.preventDefault(); event.stopPropagation();
          if (suppressClick) { suppressClick = false; return; }
          if (!pages.has(current.attrs.documentID)) return;
          editor.commands.blur();
          post("pageOpenRequest", { documentId: current.attrs.documentID });
        };
        button.addEventListener("click", open);
        subscribers.add(render);
        render();
        return {
          dom,
          update(next) {
            if (next.type !== current.type) return false;
            current = next; render();
            return true;
          },
          stopEvent() { return !selectionActive(); },
          ignoreMutation() { return true; },
          destroy() { cancelPress(); subscribers.delete(render); },
        };
      };
    },
  });
}
