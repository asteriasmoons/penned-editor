export function videoPlayer(video, file, { posterURL, iconCSS, canInteract, reportHeight, error }) {
  video.controls = false;
  const frame = document.createElement("div"); frame.className = "penned-video-frame";
  const cover = document.createElement("div"); cover.className = "penned-video-cover";
  let hasVideoSize = false, frameRequest = null;
  const resize = (width, height) => {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
    frame.style.aspectRatio = `${width} / ${height}`; reportHeight();
  };
  resize(file.width, file.height);
  if (posterURL) {
    // Keep the poster in the document layer rather than WebKit's native video layer.
    const poster = document.createElement("img"); poster.className = "penned-video-poster";
    poster.alt = ""; poster.draggable = false;
    poster.addEventListener("load", () => { if (!hasVideoSize) resize(poster.naturalWidth, poster.naturalHeight); reportHeight(); }, { once: true });
    poster.addEventListener("error", () => { poster.remove(); reportHeight(); }, { once: true });
    poster.src = posterURL; cover.appendChild(poster);
  }
  const play = document.createElement("button"); play.type = "button"; play.className = "penned-video-play";
  play.title = "Play video"; play.setAttribute("aria-label", `Play video: ${file.name}`);
  const icon = document.createElement("span"); icon.setAttribute("aria-hidden", "true");
  icon.style.maskImage = icon.style.webkitMaskImage = iconCSS("play"); play.appendChild(icon);
  const preventFocus = event => {
    if (!canInteract()) return;
    event.preventDefault(); event.stopPropagation();
  };
  const startPlayback = async event => {
    if (!canInteract()) return;
    event.preventDefault(); event.stopPropagation();
    try { await video.play(); }
    catch (failure) {
      if (failure?.name !== "AbortError" && frame.isConnected) error("This video could not be played. Try opening the original file from File Settings.");
    }
  };
  play.addEventListener("pointerdown", preventFocus);
  play.addEventListener("mousedown", preventFocus);
  play.addEventListener("touchstart", preventFocus, { passive: false });
  play.addEventListener("touchend", startPlayback, { passive: false });
  play.addEventListener("click", startPlayback);
  const firstFrame = () => { frameRequest = null; cover.hidden = true; video.controls = true; reportHeight(); };
  const decodedFrame = () => {
    // Idle previews must remain snapshot-safe rather than relying on AV compositing.
    if (video.paused) return;
    if (typeof video.requestVideoFrameCallback === "function") {
      if (frameRequest == null) frameRequest = video.requestVideoFrameCallback(firstFrame);
    } else if (!video.paused) firstFrame();
  };
  const metadata = () => {
    hasVideoSize = video.videoWidth > 0 && video.videoHeight > 0;
    if (hasVideoSize) resize(video.videoWidth, video.videoHeight);
  };
  video.addEventListener("loadedmetadata", metadata);
  video.addEventListener("resize", metadata);
  video.addEventListener("loadeddata", decodedFrame);
  video.addEventListener("playing", decodedFrame);
  video.addEventListener("emptied", () => {
    if (frameRequest != null) video.cancelVideoFrameCallback?.(frameRequest);
    frameRequest = null; cover.hidden = false; video.controls = false;
  });
  cover.appendChild(play); frame.append(video, cover);
  metadata();
  if (video.readyState >= 2) decodedFrame();
  return frame;
}
