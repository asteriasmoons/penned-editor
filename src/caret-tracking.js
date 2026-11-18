export function createCaretTracking({ editor, post, verticalOnly = false, selectionActive }) {
  let frame = null;
  let revision = 0;
  let lastRect = null;
  let forceReport = false;
  const report = () => {
    frame = null;
    const forced = forceReport;
    forceReport = false;
    if (editor.isDestroyed || !editor.isEditable || !editor.view.hasFocus() || selectionActive()) { lastRect = null; return; }
    const selection = editor.state.selection;
    if (!selection.empty || !selection.$head.parent.isTextblock) { lastRect = null; return; }
    const coordinates = editor.view.coordsAtPos(selection.head);
    if (![coordinates.left, coordinates.right, coordinates.top, coordinates.bottom].every(Number.isFinite)) return;
    const rect = {
      x: coordinates.left + window.scrollX,
      y: coordinates.top + window.scrollY,
      width: Math.max(1, coordinates.right - coordinates.left),
      height: Math.max(1, coordinates.bottom - coordinates.top),
    };
    if (!forced && lastRect && Math.abs(lastRect.y - rect.y) < 0.5 && Math.abs(lastRect.height - rect.height) < 0.5 &&
        (verticalOnly || (Math.abs(lastRect.x - rect.x) < 0.5 && Math.abs(lastRect.width - rect.width) < 0.5))) return;
    lastRect = rect;
    post("caret", { ...rect, revision: ++revision });
  };
  const schedule = (force = true) => {
    forceReport ||= force === true;
    if (frame === null && !editor.isDestroyed) frame = requestAnimationFrame(report);
  };
  editor.on("transaction", ({ transaction, appendedTransactions = [] }) => {
    if ([transaction, ...appendedTransactions].some(tr => tr.docChanged || tr.selectionSet)) schedule(false);
  });
  editor.on("focus", () => schedule());
  editor.on("destroy", () => { if (frame !== null) cancelAnimationFrame(frame); });
  return { schedule };
}
