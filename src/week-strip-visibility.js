// Match Tabs' DOM-only active-panel handling. ProseMirror owns each child
// panel; visibility changes must never replace or hide its editable DOM via
// display:none or the native HTML hidden attribute.
export function syncWeekDayPanels(content, date) {
  const panels = [...content.querySelectorAll(':scope > .penned-week-day-panel')];
  let matched = false;
  for (const panel of panels) {
    const active = panel.getAttribute('data-week-date') === date;
    panel.toggleAttribute('data-active', active);
    if (active) matched = true;
  }
  return { mounted: panels.length, matched };
}
