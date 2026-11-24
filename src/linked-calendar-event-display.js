export function linkedEventDisplay(attrs, locale = 'en-US', timeZone) {
  const title = attrs.title || 'Untitled Event';
  const calendarTitle = attrs.calendarTitle || ''; 
  const start = new Date(attrs.start);
  if (!Number.isFinite(start.getTime())) return { title, calendarTitle, date: 'Date unavailable', time: '' };
  const zone = timeZone || attrs.timeZoneID || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const date = new Intl.DateTimeFormat(locale, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: zone }).format(start);
  if (attrs.isAllDay) return { title, calendarTitle, date, time: 'All Day' };
  const formatter = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone: zone });
  const end = new Date(attrs.end);
  return { title, calendarTitle, date, time: formatter.format(start) + (Number.isFinite(end.getTime()) ? ` – ${formatter.format(end)}` : '') };
}
