export function audioTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "--:--";
  const total = Math.floor(seconds), hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60, remainder = String(total % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${remainder}` : `${minutes}:${remainder}`;
}

export function audioPlayer(audio, file, { iconCSS, menu, canInteract, error }) {
  const pill = document.createElement("div"); pill.className = "penned-audio-pill";
  pill.setAttribute("role", "group"); pill.setAttribute("aria-label", file.name);
  audio.controls = false; audio.hidden = true;
  const icon = name => {
    const span = document.createElement("span"); span.className = "penned-audio-icon";
    span.setAttribute("aria-hidden", "true");
    span.style.maskImage = span.style.webkitMaskImage = iconCSS(name);
    return span;
  };
  const button = (label, className, name) => {
    const control = document.createElement("button"); control.type = "button";
    control.className = className; control.title = label; control.setAttribute("aria-label", label);
    control.appendChild(icon(name)); return control;
  };
  const play = button("Play audio", "penned-audio-play", "play");
  const info = document.createElement("div"); info.className = "penned-audio-info";
  const title = document.createElement("strong"); title.className = "penned-audio-title";
  title.textContent = file.name.replace(/\.[^.]+$/, "") || file.name; title.title = file.name;
  const timeline = document.createElement("div"); timeline.className = "penned-audio-timeline";
  const time = document.createElement("span"); time.className = "penned-audio-time";
  const seek = document.createElement("input"); seek.type = "range"; seek.min = "0"; seek.max = "0"; seek.step = "0.1";
  seek.setAttribute("aria-label", "Seek audio");
  const volume = button("Mute audio", "penned-audio-volume", "sf:speaker.wave.2.fill");
  const more = button("File actions", "penned-audio-more", "ellipsis");
  const sync = () => {
    const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
    const current = Math.max(0, Math.min(audio.currentTime || 0, duration || Infinity));
    const playing = !audio.paused && !audio.ended, muted = audio.muted || audio.volume === 0;
    play.title = playing ? "Pause audio" : "Play audio"; play.setAttribute("aria-label", play.title);
    play.setAttribute("aria-pressed", String(playing));
    const playIcon = iconCSS(playing ? "pausewavy" : "play");
    play.firstChild.style.maskImage = play.firstChild.style.webkitMaskImage = playIcon;
    time.textContent = `${audioTime(current)} / ${audioTime(duration || NaN)}`;
    seek.max = String(duration); seek.value = String(current); seek.disabled = !duration;
    seek.setAttribute("aria-valuetext", time.textContent);
    seek.style.setProperty("--penned-audio-progress", `${duration ? current / duration * 100 : 0}%`);
    volume.title = muted ? "Unmute audio" : "Mute audio"; volume.setAttribute("aria-label", volume.title);
    volume.setAttribute("aria-pressed", String(muted));
    const volumeIcon = iconCSS(muted ? "sf:speaker.slash.fill" : "sf:speaker.wave.2.fill");
    volume.firstChild.style.maskImage = volume.firstChild.style.webkitMaskImage = volumeIcon;
  };
  play.addEventListener("click", async () => {
    if (!canInteract()) return;
    if (!audio.paused) { audio.pause(); return; }
    try {
      if (audio.ended) audio.currentTime = 0;
      await audio.play();
    } catch (failure) {
      if (failure?.name !== "AbortError" && pill.isConnected) error("This audio could not be played. Try opening the original file from File Settings.");
    }
  });
  seek.addEventListener("input", () => {
    if (!canInteract() || seek.disabled) return;
    const value = Number(seek.value);
    if (Number.isFinite(value)) {
      try { audio.currentTime = Math.max(0, Math.min(audio.duration, value)); sync(); }
      catch { /* Some providers cannot seek until media data is available. */ }
    }
  });
  volume.addEventListener("click", () => {
    if (!canInteract()) return;
    audio.muted = !(audio.muted || audio.volume === 0);
    if (!audio.muted && audio.volume === 0) audio.volume = 1;
    sync();
  });
  more.addEventListener("click", event => { if (canInteract()) menu(event); });
  for (const event of ["loadedmetadata", "durationchange", "timeupdate", "play", "pause", "ended", "volumechange", "emptied"]) audio.addEventListener(event, sync);
  timeline.append(time, seek); info.append(title, timeline);
  pill.append(play, info, volume, more, audio); sync(); return pill;
}
