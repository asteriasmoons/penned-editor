// Capture holds before player controls can consume them or suppress contextmenu.
export function attachmentActions({ root, enabled, request }) {
  const document = root.ownerDocument, window = document.defaultView;
  const pointers = new Set(), listeners = [];
  let gesture = null, suppressed = null;
  const hostAt = target => enabled() && target instanceof window.Element && root.contains(target)
    ? target.closest(".penned-attachment") : null;
  const cancelHold = () => {
    if (gesture) window.clearTimeout(gesture.timer);
    gesture = null;
  };
  const cancel = () => { cancelHold(); pointers.clear(); suppressed = null; };
  const suppress = event => { event.preventDefault(); event.stopPropagation(); };
  const present = host => {
    if (!enabled() || !root.contains(host)) return;
    cancelHold(); suppressed = { host, until: Infinity }; request(host);
  };
  const start = (target, x, y, source, pointerID) => {
    cancelHold(); suppressed = null;
    const host = hostAt(target);
    if (!host || target.closest("input, textarea, select")) return;
    gesture = { host, x, y, source, pointerID, timer: window.setTimeout(() => present(host), 500) };
  };
  const move = (x, y) => {
    if (gesture && Math.hypot(x - gesture.x, y - gesture.y) > 10) cancelHold();
  };
  const finish = event => {
    cancelHold();
    if (suppressed && Date.now() <= suppressed.until && suppressed.host.contains(event.target)) {
      suppressed.until = Date.now() + 700; suppress(event);
    }
  };
  const listen = (target, name, handler, passive = true) => {
    target.addEventListener(name, handler, { capture: true, passive });
    listeners.push(() => target.removeEventListener(name, handler, true));
  };
  listen(document, "pointerdown", event => {
    pointers.add(event.pointerId); cancelHold();
    if (pointers.size !== 1 || event.isPrimary === false || event.button !== 0) return;
    start(event.target, event.clientX, event.clientY, "pointer", event.pointerId);
  });
  listen(document, "pointermove", event => {
    if (gesture?.source === "pointer" && gesture.pointerID === event.pointerId) move(event.clientX, event.clientY);
  });
  for (const name of ["pointerup", "pointercancel"]) listen(document, name, event => {
    pointers.delete(event.pointerId); finish(event);
  }, false);
  listen(document, "touchstart", event => {
    if (event.touches.length !== 1) { cancelHold(); return; }
    if (gesture?.source === "pointer") return;
    const touch = event.touches[0]; start(event.target, touch.clientX, touch.clientY, "touch");
  });
  listen(document, "touchmove", event => {
    if (event.touches.length !== 1) { cancelHold(); return; }
    if (gesture?.source === "touch") move(event.touches[0].clientX, event.touches[0].clientY);
  });
  for (const name of ["touchend", "touchcancel"]) listen(document, name, finish, false);
  listen(document, "click", event => {
    if (suppressed && Date.now() <= suppressed.until && suppressed.host.contains(event.target)) suppress(event);
  }, false);
  listen(document, "contextmenu", event => {
    const host = hostAt(event.target);
    if (!host) return;
    suppress(event);
    if (!suppressed || suppressed.host !== host || Date.now() > suppressed.until) present(host);
  }, false);
  for (const name of ["scroll", "dragstart", "keydown"]) listen(document, name, cancelHold);
  listen(window, "blur", () => { pointers.clear(); cancelHold(); });
  listen(document, "visibilitychange", () => { if (document.hidden) cancel(); });
  return { cancel, destroy() { cancel(); listeners.forEach(remove => remove()); } };
}
