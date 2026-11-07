import { closeHistory } from "@tiptap/pm/history";
import { listGridSurface } from "./list-grid.js";

const protectedTypes = new Set(["table", "tableRow", "tableCell", "tableHeader", "collection", "pageReference"]);

function canRemove(block) {
  if (protectedTypes.has(block.type)) return false;
  let protectedContent = false;
  block.node.descendants(node => {
    if (protectedTypes.has(node.type.name)) protectedContent = true;
    return !protectedContent;
  });
  return !protectedContent;
}

// A request belongs to one immutable document, never whatever occupies the
// same position after an edit or a page switch.
export function createBlockActions({ editor, blocks, elementForBlock, selectionActive, post, snapshot }) {
  const root = editor.view.dom;
  const document = root.ownerDocument;
  const window = document.defaultView;
  let gesture = null;
  let gridTouch = null;
  let lastGridTap = null;
  let gridMouseMenu = null;
  let request = null;
  let suppressedClick = null;
  const pointers = new Set();
  const enabled = () => editor.isEditable && !selectionActive();
  // While a long-press is being resolved (and while the delete request is up),
  // stop iOS from turning the hold into a caret / selection loupe / callout, which
  // is what was dropping the block into edit mode instead of deleting it.
  const suppressText = () => {
    root.style.webkitUserSelect = "none";
    root.style.userSelect = "none";
    root.style.webkitTouchCallout = "none";
  };
  const restoreText = () => {
    root.style.webkitUserSelect = "";
    root.style.userSelect = "";
    root.style.webkitTouchCallout = "";
  };
  const cancelHold = () => {
    if (gesture) window.clearTimeout(gesture.timer);
    gesture = null;
    if (!request) restoreText();
  };
  const clearGridTouch = () => {
    if (!gridTouch) return;
    window.clearTimeout(gridTouch.timer);
    gridTouch.block.setTouchPending(false);
    gridTouch = null;
  };
  const cancelGridHold = () => {
    if (!gridTouch) return;
    window.clearTimeout(gridTouch.timer);
    gridTouch.moved = true;
    if (!gridTouch.held) gridTouch.block.setTouchPending(false);
  };
  const reset = () => { clearGridTouch(); lastGridTap = null; gridMouseMenu = null; cancelHold(); request = null; restoreText(); };
  const eligibleSurface = target => enabled() && target instanceof window.Element && root.contains(target) &&
    !target.closest("table, .tableWrapper, .penned-collection, .vellix-page-reference, .penned-attachment, input, textarea, select, a");
  const blockAt = target => {
    if (!eligibleSurface(target)) return null;
    // A List Grid is one block: pressing either cell must target the grid,
    // not a nested paragraph or row.
    const gridElement = target.closest("[data-list-grid]");
    if (gridElement && root.contains(gridElement)) {
      const surface = listGridSurface(gridElement);
      const pos = surface?.getPos();
      const node = Number.isInteger(pos) ? editor.state.doc.nodeAt(pos) : null;
      if (node?.type.name !== "listGrid" || node.attrs.id !== gridElement.dataset.vellixBlockId) return null;
      return { node, pos, type: "listGrid", path: [], element: gridElement, setTouchPending: surface.setTouchPending };
    }
    return blocks().filter(canRemove).sort((a, b) => b.path.length - a.path.length).find(block => {
      const element = elementForBlock(block);
      return element && (element === target || element.contains(target));
    }) || null;
  };
  const present = (block, doc) => {
    if (!enabled() || editor.state.doc !== doc || request) return false;
    cancelHold();
    const token = window.crypto.randomUUID();
    request = { token, block, doc };
    suppressedClick = { element: block.element || elementForBlock(block), until: Infinity };
    if (block.type === "listGrid") root.blur();
    else { suppressText(); editor.commands.blur(); }
    window.getSelection()?.removeAllRanges();
    post("haptic", { style: "light" });
    post("blockActionsRequest", { token, blockType: block.node.type.name, blockId: block.node.attrs.id || "" });
    return true;
  };
  // Width of the invisible right-hand handle gutter on each block. The long-press
  // to delete arms ONLY here, never over the block's text, so it can't fight editing.
  const HANDLE_ZONE = 44;
  const HOLD_MS = 500;
  const DOUBLE_TAP_MS = 450;
  const TOUCH_SLOP = 10;
  const gridCellAt = target => target.closest("[data-list-grid-label], [data-list-grid-value]");
  const showGridActions = contact => {
    if (gridTouch !== contact || !contact.allowsHold || contact.moved || contact.held || !enabled() ||
        request || editor.state.doc !== contact.doc) return;
    window.clearTimeout(contact.timer);
    contact.held = true;
    contact.block.setTouchPending(true, true);
    present(contact.block, contact.doc);
  };

  // Suppress selection while a hold is pending, but leave the editing host
  // intact until a hold is claimed. Short taps keep their native activation.
  document.addEventListener("touchstart", event => {
    if (event.touches.length !== 1) { cancelGridHold(); return; }
    // A native menu can consume the old release. A new single touch must not
    // inherit that contact's editing lock or compatibility-click suppression.
    clearGridTouch();
    gridMouseMenu = null;
    if (request?.block.type === "listGrid") request = null;
    if (suppressedClick?.element?.matches?.("[data-list-grid]")) suppressedClick = null;
    const target = event.target;
    if (!(target instanceof window.Element) || !target.closest("[data-list-grid]")) return;
    const block = blockAt(target);
    if (block?.type !== "listGrid") return;
    const touch = event.touches[0];
    const cell = gridCellAt(target);
    const started = window.performance.now();
    const selection = window.getSelection();
    const editingGrid = cell && editor.view.hasFocus() && selection?.anchorNode && block.element.contains(selection.anchorNode);
    const followingTap = cell && lastGridTap?.cell === cell && started - lastGridTap.at <= DOUBLE_TAP_MS;
    const contact = { block, doc: editor.state.doc, id: touch.identifier, x: touch.clientX, y: touch.clientY,
      started, cell, allowsHold: !editingGrid && !followingTap, moved: false, held: false };
    gridTouch = contact;
    if (contact.allowsHold) {
      block.setTouchPending(true);
      contact.timer = window.setTimeout(() => showGridActions(contact), HOLD_MS);
    }
  }, { capture: true, passive: true });
  document.addEventListener("touchmove", event => {
    if (!gridTouch) return;
    if (event.touches.length !== 1) { cancelGridHold(); return; }
    const touch = event.touches[0];
    if (touch.identifier !== gridTouch.id || Math.hypot(touch.clientX - gridTouch.x, touch.clientY - gridTouch.y) > TOUCH_SLOP) {
      cancelGridHold();
    }
  }, { capture: true, passive: true });
  document.addEventListener("touchend", event => {
    const contact = gridTouch;
    if (!contact) return;
    const touch = Array.from(event.changedTouches || []).find(point => point.identifier === contact.id);
    if (!touch) return;
    const stationary = !contact.moved && Math.hypot(touch.clientX - contact.x, touch.clientY - contact.y) <= TOUCH_SLOP;
    const ended = window.performance.now();
    if (stationary && event.cancelable && ended - contact.started >= HOLD_MS) showGridActions(contact);
    clearGridTouch();
    if (!contact.held) {
      if (stationary && contact.cell && ended - contact.started < HOLD_MS) lastGridTap = { cell: contact.cell, at: ended };
      return;
    }
    lastGridTap = null;
    suppressedClick = { element: contact.block.element, until: Date.now() + 600 };
    event.preventDefault();
    event.stopImmediatePropagation();
  }, { capture: true, passive: false });
  document.addEventListener("touchcancel", clearGridTouch, { capture: true, passive: true });
  document.addEventListener("selectstart", event => {
    if (gridTouch?.allowsHold && !gridTouch.moved && gridTouch.block.element.contains(event.target)) event.preventDefault();
  }, true);
  document.addEventListener("pointerdown", event => {
    const target = event.target;
    const grid = target instanceof window.Element ? target.closest("[data-list-grid]") : null;
    gridMouseMenu = event.pointerType === "mouse" && (event.button === 2 || (event.button === 0 && event.ctrlKey)) ? grid : null;
    if (event.pointerType === "touch" && grid) {
      cancelHold();
      request = null;
      suppressedClick = null;
      return;
    }
    pointers.add(event.pointerId);
    cancelHold();
    request = null;
    if (pointers.size !== 1 || event.isPrimary === false || event.button !== 0) return;
    suppressedClick = null;
    if (!eligibleSurface(target)) return;
    const block = blockAt(target);
    if (!block) return;
    if (block.type === "listGrid" && (gridCellAt(target) || gridMouseMenu === grid)) return;
    const element = block.element || elementForBlock(block);
    if (!element) return;
    const rect = element.getBoundingClientRect();
    // List Grid settings are available by holding anywhere on the card;
    // other blocks retain their existing right-edge handle gesture.
    if (block.type !== "listGrid" && event.clientX < rect.right - HANDLE_ZONE) return;
    const doc = editor.state.doc;
    gesture = { pointerID: event.pointerId, x: event.clientX, y: event.clientY,
      timer: window.setTimeout(() => {
        gesture = null;
        present(block, doc);
      }, HOLD_MS) };
  }, { capture: true, passive: true });
  document.addEventListener("pointermove", event => {
    if (gesture && (event.pointerId !== gesture.pointerID ||
        Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 10)) cancelHold();
  }, { capture: true, passive: true });
  for (const name of ["pointerup", "pointercancel"]) {
    document.addEventListener(name, event => {
      pointers.delete(event.pointerId);
      cancelHold();
      if (suppressedClick) suppressedClick.until = Date.now() + 600;
    }, { capture: true, passive: true });
  }
  document.addEventListener("scroll", () => { cancelHold(); cancelGridHold(); }, { capture: true, passive: true });
  document.addEventListener("dragstart", cancelHold, true);
  document.addEventListener("keydown", cancelHold, true);
  window.addEventListener("blur", () => { pointers.clear(); cancelHold(); clearGridTouch(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) { pointers.clear(); reset(); } });
  document.addEventListener("contextmenu", event => {
    const target = event.target;
    const grid = (target instanceof window.Element ? target : target?.parentElement)?.closest("[data-list-grid]");
    if (grid) {
      const contact = gridTouch?.block.element === grid ? gridTouch : null;
      if (contact?.held || (contact?.allowsHold && !contact.moved)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      // WebKit can emit a context menu for text selection. It is not proof
      // of a hold; only the timer or a deliberate mouse click opens actions.
      if (gridMouseMenu !== grid) return;
      gridMouseMenu = null;
    }
    const block = blockAt(event.target);
    if (!block) return;
    event.preventDefault();
    event.stopPropagation();
    present(block, editor.state.doc);
  }, true);
  document.addEventListener("mousedown", event => {
    const heldGrid = gridTouch?.held ? gridTouch.block.element : (request?.block.type === "listGrid" ? request.block.element : null);
    const gridClick = suppressedClick?.element?.matches?.("[data-list-grid]") && Date.now() <= suppressedClick.until;
    if (!heldGrid?.contains(event.target) && !(gridClick && suppressedClick.element.contains(event.target))) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  document.addEventListener("click", event => {
    if (!suppressedClick || Date.now() > suppressedClick.until) return;
    if (!suppressedClick.element?.contains(event.target)) return;
    suppressedClick = null;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  editor.on("transaction", ({ transaction }) => {
    if (!transaction.docChanged) return;
    // Invalidate the action's saved document, but don't re-enable editing
    // underneath a finger that is still down.
    cancelGridHold();
    cancelHold();
    request = null;
    restoreText();
  });

  return {
    reset,
    dismiss(token) {
      if (request?.token !== token) return false;
      if (request.block.type === "listGrid") clearGridTouch();
      request = null;
      restoreText();
      return true;
    },
    remove(token) {
      const pending = request;
      if (!pending || pending.token !== token) return false;
      request = null;
      restoreText();
      if (!enabled() || editor.state.doc !== pending.doc ||
          !canRemove(pending.block)) return false;
      const { block } = pending;
      let from = block.pos;
      let to = from + block.node.nodeSize;
      const $from = editor.state.doc.resolve(from);
      if (["bulletList", "orderedList", "taskList"].includes($from.parent.type.name) && $from.parent.childCount === 1) {
        // Remove an emptied list too, instead of leaving a phantom bullet.
        from = $from.before();
        to = $from.after();
      }
      const transaction = closeHistory(editor.state.tr).delete(from, to);
      transaction.setMeta("pennedPlaceholderDeletion", [{ from, to }]);
      if (!transaction.doc.childCount) transaction.insert(0, editor.schema.nodes.paragraph.create());
      editor.view.dispatch(transaction);
      editor.view.dispatch(closeHistory(editor.state.tr));
      post("snapshot", snapshot());
      return true;
    },
  };
}
