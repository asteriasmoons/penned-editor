export const WEEK_STRIP_DEFAULTS = Object.freeze({
  title: 'Calendar', collapsed: false,
  inactiveTabColor: '#303137', activeTabColor: '#9276dc', navigationColor: '#7c8b80',
  containerBorderColor: '#34343b', backgroundColor: '#121316', contentTextColor: '#f7f7fa',
  borderWidth: 1, borderThickness: 1, cornerRadius: 18, fontSize: 14, fontWeight: 700,
  firstDayOfWeek: 0, selectedDateBehavior: 'remember', padding: 14, spacing: 14,
});
const limits = { borderWidth: [0, 20], borderThickness: [0, 8], cornerRadius: [0, 48], fontSize: [10, 24], fontWeight: [400, 900], firstDayOfWeek: [0, 6], padding: [0, 32], spacing: [0, 32] };
export function sanitizeWeekStripSetting(key, value) {
  if (!(key in WEEK_STRIP_DEFAULTS)) return undefined;
  if (key === 'title') return typeof value === 'string' ? value.slice(0, 240) : undefined;
  if (key === 'collapsed') return value === true || value === 'true' ? true
    : value === false || value === 'false' ? false : undefined;
  if (key.endsWith('Color')) return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : undefined;
  if (key === 'selectedDateBehavior') return ['remember', 'today'].includes(value) ? value : undefined;
  if (value === null || value === undefined || value === '') return undefined;
  const [min, max] = limits[key];
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : undefined;
}
export function weekStripOpenDate(attrs, today) {
  return attrs.selectedDateBehavior === 'today' ? today : attrs.selectedDate || today;
}

// A settings edit must never replace or reconstruct date panels. Keep the
// selection and nested document tree untouched; only the requested attribute
// changes, and other Week Strip instances remain independent.
export function updateWeekStripAppearanceJSON(block, key, input) {
  if (!block || block.type !== 'weekStrip' || key === 'selectedDate') return null;
  const value = sanitizeWeekStripSetting(key, input);
  if (value === undefined) return null;
  if (block.attrs?.[key] === value) return block;
  return { ...block, attrs: { ...block.attrs, [key]: value } };
}
