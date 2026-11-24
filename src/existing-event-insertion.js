// Capture a stable editor coordinate before opening the native picker; the
// WebView loses focus while a sheet is presented.
export function insertionBookmark(selection) {
  return { from: selection.from, to: selection.to };
}
export function insertionRange(bookmark) {
  return bookmark && Number.isInteger(bookmark.from) && Number.isInteger(bookmark.to)
    ? { from: bookmark.from, to: bookmark.to } : null;
}
