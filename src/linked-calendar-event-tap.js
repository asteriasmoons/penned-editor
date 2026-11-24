export function linkedEventTapPayload(attrs) {
  if (!attrs?.eventID || !attrs?.eventIdentity) return null;
  return { eventID: attrs.eventID, eventIdentity: attrs.eventIdentity, start: attrs.start || '' };
}
