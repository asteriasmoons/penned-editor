// Pure date-indexed document model for the Week Strip.
// All visited days remain as child panels in the document, even off-screen.
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
export function validDateKey(value) {
  if (typeof value !== 'string' || !DATE_KEY.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function localDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function dateFromKey(key) {
  if (!validDateKey(key)) throw new RangeError('Invalid calendar date');
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day, 12);
}
export function weekDateKeys(selectedDate = new Date(), firstDayOfWeek = 0) {
  const date = selectedDate instanceof Date ? selectedDate : dateFromKey(selectedDate);
  if (!Number.isInteger(firstDayOfWeek) || firstDayOfWeek < 0 || firstDayOfWeek > 6) throw new RangeError('Invalid first day of week');
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
  start.setDate(start.getDate() - ((start.getDay() - firstDayOfWeek + 7) % 7));
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return localDateKey(day);
  });
}
export function ensureWeekPanels(block, date, firstDayOfWeek, makePanel) {
  const keys = new Set((block.content || []).map(panel => panel.attrs?.date));
  const missing = weekDateKeys(date, firstDayOfWeek).filter(key => !keys.has(key));
  return { ...block, content: [...(block.content || []), ...missing.map(makePanel)] };
}

// Preserve the selected weekday while moving exactly one calendar week.
// Local noon avoids daylight-saving boundary drift.
export function shiftWeekDateKey(key, weeks) {
  if (!Number.isInteger(weeks)) throw new RangeError('Week offset must be an integer');
  const date = dateFromKey(key);
  date.setDate(date.getDate() + weeks * 7);
  return localDateKey(date);
}

// Include years on both ends only when a displayed week spans two years.
export function formatWeekRange(firstKey, lastKey, locale) {
  const first = dateFromKey(firstKey);
  const last = dateFromKey(lastKey);
  const crossesYear = first.getFullYear() !== last.getFullYear();
  const formatter = new Intl.DateTimeFormat(locale, {
    month: 'short', day: 'numeric', ...(crossesYear ? { year: 'numeric' } : {}),
  });
  return `${formatter.format(first)} - ${formatter.format(last)}`;
}
