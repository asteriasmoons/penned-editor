import { propertyURL } from "./inline-properties.js";

export function clipSource(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const url = propertyURL(value.url);
  if (!url) return null;
  return { url, title: typeof value.title === "string" && value.title.trim() ? value.title : url,
    file: value.file && typeof value.file === "object" && !Array.isArray(value.file) ? value.file : null };
}

export function clipPreview(source, imageURL) {
  return ["a", { class: "penned-clip-source-link", href: source.url, target: "_blank", rel: "noopener noreferrer",
    contenteditable: "false", title: source.title, "data-penned-clip-link": "" },
    ...(imageURL ? [["img", { src: imageURL, alt: "", draggable: "false", decoding: "async" }]] : []),
    ["span", { class: "penned-clip-source-title" }, source.title]];
}

export function clipSavedDate(value, now = new Date()) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?$/.test(value)) return null;
  const date = new Date(value.length === 10 ? value + "T00:00:00" : value);
  if (!Number.isFinite(date.getTime())) return null;
  const day = date.toDateString(), today = now.toDateString(), yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  return { day: day === today ? "Today" : day === yesterday.toDateString() ? "Yesterday"
    : date.toLocaleDateString(undefined, { dateStyle: "medium" }),
    time: date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) };
}
