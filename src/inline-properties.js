export const PROPERTY_KINDS = [
  { kind: "text", title: "Text", icon: "linedpages" },
  { kind: "number", title: "Number", icon: "numcal" },
  { kind: "date", title: "Date", icon: "numcal" },
  { kind: "select", title: "Select", icon: "listcircle" },
  { kind: "multiSelect", title: "Multi Select", icon: "listcircle" },
  { kind: "checkbox", title: "Checkbox", icon: "checkwavy" },
  { kind: "url", title: "URL", icon: "linkcircle" },
];

const string = (value) => typeof value === "string" ? value : "";
const decimal = (value) => {
  const clean = string(value).trim();
  return clean && Number.isFinite(Number(clean)) ? clean : "";
};

export function normalizeProperty(raw = {}) {
  raw = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const kind = PROPERTY_KINDS.some((item) => item.kind === raw.kind) ? raw.kind : "text";
  const seen = new Set();
  const options = (Array.isArray(raw.options) ? raw.options : []).flatMap((option) => {
    if (!option || typeof option.id !== "string" || !option.id || seen.has(option.id)) return [];
    seen.add(option.id);
    return [{
      id: option.id,
      name: string(option.name).trim() || "Option",
      color: /^#[0-9a-f]{6}$/i.test(option.color) ? option.color : "#2EC5F4",
    }];
  });
  const selectedOptionIDs = [...new Set(Array.isArray(raw.selectedOptionIDs) ? raw.selectedOptionIDs : [])]
    .filter((id) => seen.has(id));
  return {
    kind,
    name: string(raw.name).trim(),
    value: string(raw.value),
    checked: raw.checked === true,
    options,
    selectedOptionIDs: kind === "select" ? selectedOptionIDs.slice(0, 1) : selectedOptionIDs,
    placeholder: string(raw.placeholder),
    prefix: string(raw.prefix),
    suffix: string(raw.suffix),
    minimum: decimal(raw.minimum),
    maximum: decimal(raw.maximum),
    step: Number(raw.step) > 0 ? decimal(raw.step) : "",
    includeTime: raw.includeTime === true,
    urlLabel: string(raw.urlLabel),
  };
}

export function propertyURL(value) {
  const clean = string(value).trim();
  if (!clean || /[\s\u0000-\u001f]/.test(clean)) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(clean) ? clean : `https://${clean}`);
    return ["https:", "http:"].includes(url.protocol) && url.hostname && !url.username && !url.password
      ? url.href : null;
  } catch { return null; }
}

export function propertyNumberValid(property, value) {
  if (!value.trim()) return true;
  const number = Number(value);
  if (!Number.isFinite(number)) return false;
  if (property.minimum && number < Number(property.minimum)) return false;
  if (property.maximum && number > Number(property.maximum)) return false;
  if (property.step) {
    const steps = (number - Number(property.minimum || 0)) / Number(property.step);
    if (Math.abs(steps - Math.round(steps)) > 1e-8) return false;
  }
  return true;
}

export function propertyText(raw) {
  const property = normalizeProperty(raw);
  let value = property.value;
  if (["select", "multiSelect"].includes(property.kind)) {
    value = property.options.filter((option) => property.selectedOptionIDs.includes(option.id))
      .map((option) => option.name).join(", ");
  } else if (property.kind === "checkbox") {
    value = property.checked ? "Checked" : "Unchecked";
  } else if (property.kind === "number" && value) {
    value = `${property.prefix}${value}${property.suffix}`;
  } else if (property.kind === "url" && property.urlLabel) {
    value = `${property.urlLabel} ${value}`.trim();
  }
  return `${property.name ? `${property.name}: ` : ""}${value}`.trim();
}
