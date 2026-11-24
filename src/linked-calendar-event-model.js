// A linked block is a reference to a calendar-owned event. The identity is
// sufficient to resolve the original event (including its occurrence) later.
export function linkedCalendarEventJSON({ id, eventID, identity, title = '', calendarTitle = '', start = '', end = '', isAllDay = false, timeZoneID = null, available = true }) {
  if (!id || !eventID || !identity || !['calendarID', 'sourceID', 'localID'].every(key => typeof identity[key] === 'string' && identity[key].length)) {
    throw new TypeError('Linked event requires its original calendar identity');
  }
  return { type: 'linkedCalendarEvent', attrs: { id, eventID, eventIdentity: structuredClone(identity), title, calendarTitle, start, end, isAllDay, timeZoneID, available } };
}

export function updateLinkedCalendarEventJSON(block, { title, calendarTitle, start, end, isAllDay, timeZoneID, available }) {
  if (block?.type !== 'linkedCalendarEvent') return null;
  return { ...block, attrs: {
    ...block.attrs,
    ...(typeof title === 'string' ? { title } : {}),
    ...(typeof calendarTitle === 'string' ? { calendarTitle } : {}),
    ...(typeof start === 'string' ? { start } : {}),
    ...(typeof end === 'string' ? { end } : {}),
    ...(typeof isAllDay === 'boolean' ? { isAllDay } : {}),
    ...(typeof timeZoneID === 'string' ? { timeZoneID } : {}),
    ...(typeof available === 'boolean' ? { available } : {}),
  } };
}
