// Diagnostics intentionally exclude card titles, body text, icon names, and
// user-selected colors. Only the fields and types involved in save validation
// are sent to the Xcode console.
export function gridCardSettingDifferences(expected, actual) {
  if (!expected || !actual || typeof expected !== 'object' || typeof actual !== 'object') return [];
  return [...new Set([...Object.keys(expected), ...Object.keys(actual)])]
    .filter(key => JSON.stringify(expected[key]) !== JSON.stringify(actual[key]))
    .sort();
}

export function gridCardSettingTypes(settings) {
  if (!settings || typeof settings !== 'object') return {};
  return Object.fromEntries(Object.entries(settings).map(([key, value]) => [
    key, value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value,
  ]));
}
