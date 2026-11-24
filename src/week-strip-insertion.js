// Use the active panel as the insertion boundary, not its outer container.
// This preserves Penned's normal editor/toolbar inside date-specific content.
export function insertionPanelDepth($cursor) {
  for (let depth = $cursor.depth - 1; depth > 0; depth--) {
    if (['weekDayPanel', 'tabPanel', 'informationCardBody'].includes($cursor.node(depth).type.name)) return depth + 1;
  }
  return 1;
}
