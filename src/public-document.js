import { Node, Extension, getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Code from "@tiptap/extension-code";
import { generateHTML } from "@tiptap/html/server";
import FormulaParser from "fast-formula-parser";
import { createTextColor, textColorDependencies } from "./text-color.js";
import { Caption } from "./caption.js";
import { normalizeProperty, propertyURL, PROPERTY_KINDS } from "./inline-properties.js";
import { clipSource, clipPreview, clipSavedDate } from "./clip-source.js";
import { calloutWidth, calloutRowMetrics } from "./callout-layout.js";
import { GRID_CARD_DEFAULTS, gridCardSettings, gridCardDOMAttributes } from "./grid-card.js";
import { ICON_CALLOUT_DEFAULTS, iconCalloutImage, iconCalloutSettings, iconCalloutSurface, plainCalloutSurface } from "./icon-callout.js";
import { createLabelHeading } from "./heading-label.js";
import { richLinkDefaults, richLinkDOM } from "./document-links.js";
import { dividerDOM } from "./divider.js";
import { componentDefinition, componentResponse } from "./template-components.js";
import "./table-formulas.js";

export const documentFonts = {
  rounded: 'ui-rounded,"SF Pro Rounded","Nunito Variable",Nunito,system-ui,sans-serif',
  system: "system-ui,sans-serif", serif: "ui-serif,Georgia,serif", mono: "ui-monospace,monospace",
  hachiMaruPop: '"HachiMaruPop",cursive',
};
export const validColor = value => typeof value === "string" && /^#(?:[\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i.test(value) ? value : null;
const defaults = values => Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { default: value, rendered: false }]));
const text = node => node.type === "text" ? node.text || "" : (node.content || []).map(text).join(["paragraph", "caption", "heading"].includes(node.type) ? "" : "\n");
const noOp = () => {};
const style = (values) => Object.entries(values).filter(([, value]) => value != null).map(([key, value]) => `${key}:${value}`).join(";");

function tablePresentation(root) {
  const records = [], cells = new Map();
  function visit(node) {
    if (node.type === "table") {
      const grid = [], widths = [], id = `reader-table-${records.length}`;
      for (const [rowIndex, row] of (node.content || []).entries()) {
        grid[rowIndex] ||= [];
        let column = 0;
        for (const cell of row.content || []) {
          while (grid[rowIndex][column]) column++;
          const attrs = cell.attrs || {}, item = { value: text(cell), format: attrs.format, formula: attrs.formula || null };
          for (let r = rowIndex; r < rowIndex + (attrs.rowspan || 1); r++) {
            grid[r] ||= [];
            for (let c = column; c < column + (attrs.colspan || 1); c++) grid[r][c] = item;
          }
          if (Array.isArray(attrs.colwidth)) attrs.colwidth.forEach((width, i) => { widths[column + i] = Math.max(widths[column + i] || 0, width); });
          cells.set(cell, { id, row: rowIndex, column });
          column += attrs.colspan || 1;
        }
      }
      node.attrs ||= {};
      node.attrs.readerWidths = Array.from({ length: Math.max(1, ...grid.map(row => row.length)) }, (_, i) => widths[i] || 140);
      records.push({ id, name: node.attrs.name || `Table${records.length + 1}`, cells: grid });
    }
    for (const child of node.content || []) visit(child);
  }
  visit(root);
  if (!records.length) return;
  const formulas = globalThis.VellixTableFormulas, workbook = formulas.createWorkbook(records, FormulaParser);
  for (const [cell, position] of cells) {
    const attrs = cell.attrs || {};
    if (attrs.formula || ["number", "currency", "percent", "date"].includes(attrs.format)) {
      const value = attrs.formula ? workbook.value(position.id, position.row, position.column) : formulas.scalar(text(cell), attrs.format);
      cell.content = [{ type: "paragraph", content: [{ type: "text", text: formulas.display(value, attrs, FormulaParser) || " " }] }];
    }
  }
}

export function publicExtensions(options) {
  const assets = new Map(options.media.map(asset => [asset.id.toLowerCase(), asset]));
  const media = id => {
    if (typeof id !== "string" || !assets.has(id.toLowerCase())) throw new Error("Publication media is not in its manifest");
    return options.mediaURL(id.toLowerCase());
  };
  const icon = name => {
    const source = options.iconURL(name);
    return source ? ["span", { class: "reader-icon", "aria-hidden": "true", style: `--reader-icon:url(${JSON.stringify(source)})` }]
      : ["span", { class: "reader-emoji", "aria-hidden": "true" }, String(name || "")];
  };
  const linked = (record, attributes, children) => {
    const included = record.targetPage === "root" || /^page-[a-f0-9]{32}$/.test(record.targetPage || "");
    const href = included && options.publicationURL ? options.publicationURL + (record.targetPage === "root" ? "" : `?page=${record.targetPage}`)
      : /^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$/.test(record.targetToken || "") ? `/p/${record.targetToken}` : null;
    const canFollow = options.allowFollowLinkedContent && href;
    return [canFollow ? "a" : "div", { ...attributes, ...(canFollow ? { href, "data-reader-linked": "", rel: "noreferrer" } : {}) }, ...children];
  };
  const cover = record => {
    if (record.cover?.mediaID) return ["img", { class: "reader-entry-cover", src: media(record.cover.mediaID), alt: "", loading: "lazy", decoding: "async" }];
    if (safePhoto(record.coverPhoto?.imageURL)) return ["img", { class: "reader-entry-cover", src: safePhoto(record.coverPhoto.imageURL), alt: "", loading: "lazy", decoding: "async" }];
    if (record.coverThemeID) return ["div", { class: "reader-theme-cover", "data-cover-theme": record.coverThemeID }, ["img", { src: options.iconURL(record.coverThemeID === "neonCode" ? "codewindow" : "moonzs"), alt: "", loading: "lazy" }]];
    return null;
  };
  const propertyValue = (value, kind) => {
    if (Array.isArray(value?.chips) && value.chips.length) return value.chips.map(chip => ["span", { class: "penned-collection-chip", style: `--chip-color:${validColor(chip.color) || "#B59AD9"}` }, chip.name]);
    if (kind === "checkbox" && typeof value?.checked === "boolean") return [icon(value.checked ? "checkwavy" : "minuswavy"), ["span", {}, value.text || (value.checked ? "Checked" : "Unchecked")]];
    if (kind === "url" && propertyURL(value?.text)) return [["a", { href: propertyURL(value.text), rel: "noopener noreferrer", target: "_blank" }, value.text]];
    return [["span", { class: value?.empty ? "reader-muted" : "" }, value?.text || "Not set"]];
  };
  const page = record => {
    const card = record.cardStyle;
    if (!card) return linked(record, { class: "vellix-page-reference-button reader-page", id: record.readerAnchor }, [
      ["span", { class: "reader-page-thumbnail", "aria-hidden": "true" }, ...(cover(record) ? [cover(record)] : []), ["strong", {}, record.title], ["span", {}, record.excerpt || ""]],
      ["span", { class: "vellix-page-reference-text" }, ["span", { class: "vellix-page-reference-title" }, record.title], ["span", { class: "vellix-page-reference-excerpt" }, record.excerpt || ""]],
    ]);
    const sizes = { compact: [154, 90], landscape: [154, 90], portrait: [154, 162], wide: [318, 90], large: [318, 154] };
    const [width, height] = sizes[card.size] || sizes.compact;
    const photo = card.mediaID ? media(card.mediaID) : safePhoto(card.remotePhoto?.imageURL);
    const background = card.backdrop === "none" ? "transparent" : card.backdrop === "photo" && photo ? `url(${JSON.stringify(photo)}) center/cover` : card.backdrop === "gradient" ? `linear-gradient(135deg,${validColor(card.startColor)},${validColor(card.endColor)})` : validColor(card.startColor);
    const color = card.backdrop === "photo" ? "#fff" : contrastColor(card.startColor);
    const miniature = second => ["span", { class: `reader-card-page${second ? " is-back" : ""}`, "aria-hidden": "true", style: `color:${validColor(record.textColorHex) || "#f7f7f7"};font-family:${documentFonts[record.fontStyle] || documentFonts.rounded}` },
      ...(!second && cover(record) ? [cover(record)] : []), ...(!second ? [["strong", {}, record.title], ["span", {}, record.excerpt || ""]] : [])];
    const sticky = card.previewStyle === "stickyNote";
    const note = ["span", { class: "reader-sticky-note", "aria-hidden": "true" },
      ["span", { class: "reader-sticky-note-paper" },
        ["span", { class: "reader-sticky-note-content" }, ...(cover(record) ? [cover(record)] : []), ["strong", {}, record.title], ["span", {}, record.excerpt || ""]]]];
    const open = card.previewStyle === "openPage";
    const spread = ["span", { class: "reader-open-page-spread", "aria-hidden": "true", style: `color:${validColor(record.textColorHex) || "#f7f7f7"};font-family:${documentFonts[record.fontStyle] || documentFonts.rounded}` },
      ["span", { class: "reader-open-page-sheet" }], ["span", { class: "reader-open-page-sheet is-right" }],
      ["span", { class: "reader-open-page-flow" }, ...(cover(record) ? [cover(record)] : []), ["span", {}, record.excerpt || ""]]];
    const result = linked(record, { class: "reader-page-card", "data-card-size": card.size, "data-card-pages": String(card.showsPages), "data-card-preview": open ? "openPage" : (sticky ? "stickyNote" : "pages"), "data-card-width": String(width),
      style: style({ "--card-width": `${width}px`, "--card-height": `${height}px`, "aspect-ratio": `${width}/${height}`, color }) },
      [["span", { class: "reader-page-card-face", style: style({ background, "font-family": documentFonts[record.fontStyle] || documentFonts.rounded }) },
        ...(card.showsPages ? (open ? [spread] : (sticky ? [note] : [["span", { class: "reader-card-pages" }, ...(["wide", "large"].includes(card.size) ? [miniature(true)] : []), miniature(false)]])) : []),
        ["span", { class: "reader-page-card-copy" }, ["strong", {}, record.title], ["span", {}, record.excerpt || ""]]]]);
    return ["div", { class: "reader-page-card-block", id: record.readerAnchor }, result, ...photoCredit(card.remotePhoto), ...photoCredit(record.coverPhoto)];
  };
  const collection = record => {
    const views = record.views?.length ? record.views : [{ ...record, key: "view-0" }];
    const active = views.find(view => view.key === record.activeViewKey) || views[0];
    const kindIcon = kind => ({ table: "table", gallery: "layoutgal", kanban: "gridboard" })[kind];
    const readingIcon = (name, className = "") => ["span", { class: `penned-collection-button ${className}`, "aria-hidden": "true" }, icon(name)];
    function viewContent(view) {
      const fields = view.fields || [], entries = view.entries || [];
      const values = row => fields.filter(field => !row.values?.[field.key]?.empty).map(field => ["div", { class: "penned-collection-value reader-collection-value" }, ...propertyValue(row.values?.[field.key], field.kind)]);
      let content;
      if (view.kind === "table") {
        content = ["div", { class: "penned-collection-scroll reader-collection-table-scroll", tabindex: "0", role: "region", "aria-label": `${record.name}, ${view.viewName}` },
          ["div", { class: "penned-collection-table reader-collection-table", role: "table", style: `--collection-tracks:220px ${fields.map(field => ["number", "checkbox"].includes(field.kind) ? "120px" : "180px").join(" ")} 44px` },
            ["div", { class: "penned-collection-row penned-collection-heading", role: "row" }, ["span", { role: "columnheader" }, "Title"],
              ...fields.map(field => ["span", { class: "penned-collection-button", role: "columnheader" }, icon(field.icon), ["span", {}, field.name]]), readingIcon("addwavy")],
            ...entries.map(row => ["div", { class: "penned-collection-row", role: "row" },
              linked(row, { class: "penned-collection-button penned-collection-table-title reader-collection-title", role: "cell" }, [row.title]),
              ...fields.map(field => ["div", { class: "penned-collection-button penned-collection-value reader-collection-value", role: "cell" }, ...propertyValue(row.values?.[field.key], field.kind)]), readingIcon("dotswavy")])]];
      } else if (view.kind === "kanban") {
        content = ["div", { class: "reader-kanban-layout" }, ["div", { class: "reader-kanban", role: "region", "aria-label": `${record.name}, ${view.viewName}`, tabindex: "0" }, ...(view.groups || []).map(group => {
          const rows = entries.filter(row => row.group === group.key);
          return ["details", { class: "reader-kanban-column", ...(group.collapsed ? {} : { open: "" }), style: `--column-color:${validColor(group.color) || "#34363f"};--column-ink:${contrastColor(group.color)}` },
            ["summary", {}, icon("sf:chevron.down"), ["strong", {}, group.name], ["span", { class: "reader-column-count" }, String(rows.length)], readingIcon("sf:plus", "reader-column-add")],
            ["div", { class: "reader-kanban-entries" }, ...rows.map(row => ["div", { class: "reader-kanban-card" },
              linked(row, { class: "reader-kanban-title" }, [["span", {}, row.title], icon("sf:chevron.right")]),
              ...(() => {
                const tags = fields.filter(field => !row.values?.[field.key]?.empty).flatMap(field => {
                const value = row.values?.[field.key];
                return (value?.chips?.length ? value.chips : [{ name: value?.text || "", color: "#87B9D5" }]).map(chip =>
                  ["span", { class: "reader-kanban-tag", style: `--chip-color:${validColor(chip.color) || "#87B9D5"}` }, chip.name]);
                }).filter(tag => tag[2]);
                return tags.length ? [["div", { class: "reader-kanban-values" }, ...tags]] : [];
              })()]), ...(rows.length ? [readingIcon("sf:plus", "reader-kanban-add")] : [])]];
        })], ["div", { class: "reader-kanban-footer", "aria-hidden": "true" }, ["span", {}, icon("addwavy"), "Add Column"], readingIcon("dotswavy")]];
      } else {
        content = ["div", { class: "penned-collection-gallery-scroll", tabindex: "0", role: "region", "aria-label": `${record.name}, ${view.viewName}` },
          ["div", { class: "penned-collection-gallery reader-gallery", style: `--collection-columns:${Math.min(3, Math.max(1, view.galleryColumns || 2))}` }, ...entries.map(row =>
            ["div", { class: "penned-collection-card reader-collection-card" },
              linked(row, { class: "penned-collection-card-open" }, [
                ...(view.showsCover ? [["div", { class: "penned-collection-cover" }, cover(row) || icon("imagesign")]] : []),
                ["span", { class: "penned-collection-card-title" }, row.title]]),
              ["div", { class: "penned-collection-card-values" }, ...values(row)], readingIcon("dotswavy", "penned-collection-entry-actions"), ...photoCredit(row.coverPhoto)])],
          ...(!entries.length ? [["p", { class: "penned-collection-empty" }, "No entries"]] : []),
          ["div", { class: "penned-collection-footer" }, readingIcon("addwavy")]];
      }
      return ["div", { class: `reader-collection-view${view.compactCards ? " penned-collection-compact" : ""}`, "data-collection-view": view.key,
        "data-view-kind": view.kind, "data-view-name": view.viewName, ...(view.key === active.key ? {} : { hidden: "" }) }, content];
    }
    return ["section", { class: "penned-collection reader-collection", id: record.readerAnchor, "data-collection-kind": active.kind, "data-active-view": active.key },
      ["div", { class: "penned-collection-header" }, ["span", { class: "penned-collection-button penned-collection-name" }, record.name],
        ["details", { class: "reader-view-menu" }, ["summary", { class: "penned-collection-button penned-collection-selector", "aria-label": "Collection views" }, ["span", { "data-current-view-name": "" }, active.viewName], icon("chevdown")],
          ["div", { class: "reader-view-options", role: "group", "aria-label": "Saved collection views" }, ...views.map(view =>
            ["button", { type: "button", "data-select-collection-view": view.key, "aria-pressed": String(view.key === active.key) }, icon(kindIcon(view.kind)), ["span", {}, view.viewName], ["span", { class: "reader-view-check", "aria-hidden": "true" }, icon("checkwavy")]])]], readingIcon("dotswavy")],
      ...views.map(viewContent)];
  };
  const atoms = [
    Node.create({ name: "publishedPage", group: "block", atom: true, addAttributes: () => defaults({ preview: null }), renderHTML: ({ node }) => page(node.attrs.preview) }),
    Node.create({ name: "publishedCollection", group: "block", atom: true, addAttributes: () => defaults({ projection: null }), renderHTML: ({ node }) => collection(node.attrs.projection) }),
    ...["privateReference", "privateCollection"].map(name => Node.create({ name, group: "block", atom: true,
      renderHTML: () => ["div", { class: "reader-legacy-reference" }, icon("linedpages"), ["span", {}, name === "privateReference" ? "Linked page unavailable in this saved publication" : "Collection unavailable in this saved publication"]] })),
    Node.create({ name: "divider", group: "block", atom: true,
      addAttributes: () => defaults({ style: "thinLine", color: null, mediaID: null, remotePhoto: null, tapeSize: null }),
      renderHTML: ({ node }) => {
        const { style, mediaID, remotePhoto } = node.attrs;
        return dividerDOM(node.attrs, style === "washiTape" ? (mediaID ? media(mediaID) : safePhoto(remotePhoto?.imageURL)) : null);
      } }),
    Node.create({ name: "pageBreak", group: "block", atom: true, renderHTML: () => ["div", { "data-vellix-page-break": "", "aria-hidden": "true" }] }),
    Node.create({ name: "inlineTag", group: "inline", inline: true, atom: true, addAttributes: () => defaults({ name: "" }),
      renderHTML: ({ node }) => ["span", { class: "penned-inline-tag" }, "#" + node.attrs.name] }),
    Node.create({ name: "attachment", group: "block", atom: true, addAttributes: () => defaults({ file: null, displayMode: "auto", widthPercent: null }), renderHTML: ({ node }) => {
      const file = node.attrs.file, asset = assets.get(file.mediaID.toLowerCase());
      if (!asset) throw new Error("Missing attachment descriptor");
      const url = media(asset.id), isCard = ["card", "file"].includes(node.attrs.displayMode), width = Number(node.attrs.widthPercent);
      const link = ["a", { class: "penned-file-card", href: url, target: "_blank", rel: "noopener noreferrer", "data-reader-file": "" },
        icon(file.kind === "pdf" ? "linedpages" : "pagefold"), ["span", { class: "penned-file-info" }, ["strong", {}, asset.name], ["small", {}, `${asset.mimeType} · ${formatBytes(asset.size)}`]]];
      const attrs = { class: "penned-attachment reader-attachment", style: Number.isFinite(width) && width >= 10 && width <= 100 ? `width:${width}%` : node.attrs.displayMode === "inline" ? "width:fit-content" : "" };
      if (!isCard && asset.mimeType.startsWith("image/")) return ["figure", attrs,
        ["a", { href: url, "data-reader-image": "", "aria-label": `View ${asset.name}` }, ["img", { src: /heic|heif/.test(asset.mimeType) && file.previewMediaID ? media(file.previewMediaID) : url,
          alt: asset.name, ...(file.width && file.height ? { width: file.width, height: file.height, loading: "lazy" } : { loading: "eager" }), decoding: "async" }]]];
      if (!isCard && /^(audio|video)\//.test(asset.mimeType)) return ["figure", attrs,
        [asset.mimeType.startsWith("audio/") ? "audio" : "video", { controls: "", preload: "metadata", playsinline: "", src: url, ...(file.previewMediaID ? { poster: media(file.previewMediaID) } : {}), "aria-label": asset.name }], ["figcaption", {}, link]];
      if (!isCard && asset.mimeType === "application/pdf") return ["figure", attrs,
        ...(file.previewMediaID ? [["a", { href: url, target: "_blank", rel: "noopener noreferrer" }, ["img", { src: media(file.previewMediaID), alt: asset.name, loading: "lazy" }]]] : []), link];
      return ["figure", attrs, link];
    } }),
    Node.create({ name: "inlineProperty", group: "block", atom: true, addAttributes: () => defaults({ property: null, readerClipSaved: false }), renderHTML: ({ node }) => {
      const property = normalizeProperty(node.attrs.property), kind = PROPERTY_KINDS.find(item => item.kind === property.kind);
      const saved = node.attrs.readerClipSaved && property.kind === "date" ? clipSavedDate(property.value) : null;
      if (saved) return ["div", { class: "vellix-property reader-property penned-clip-saved" },
        ["span", { class: "vellix-property-name" }, property.name || "Saved"],
        ["div", { class: "vellix-property-value" }, ["span", { class: "vellix-property-date" }, icon("numcal"), ["span", {}, saved.day]],
          ...(property.includeTime ? [["span", { class: "penned-clip-saved-time" }, "at " + saved.time]] : [])]];
      const value = { text: property.kind === "number" && property.value ? `${property.prefix}${property.value}${property.suffix}` : property.value,
        checked: property.kind === "checkbox" ? property.checked : undefined,
        chips: property.options.filter(option => property.selectedOptionIDs.includes(option.id)) };
      if (property.kind === "date" && property.value) value.text = formatDate(property.value, property.includeTime);
      return ["div", { class: "vellix-property reader-property" }, ["div", { class: "vellix-property-name" }, icon(node.attrs.property?.icon || kind?.icon || "linedpages"), ["span", {}, property.name || kind?.title || "Property"]],
        ["div", { class: "vellix-property-value" }, ...propertyValue(value, property.kind)]];
    } }),
    Node.create({ name: "templateComponent", group: "block", atom: true, addAttributes: () => defaults({ definition: null, response: null }), renderHTML: ({ node }) => {
      const definition = componentDefinition(node.attrs.definition), response = componentResponse(definition, node.attrs.response);
      const { kind, minimum, maximum } = definition;
      const label = definition.label ? [["strong", { class: "reader-component-label" }, definition.label]] : [];
      if (kind === "slider") return ["section", { class: "penned-template-component reader-component" }, ...label,
        ["input", { type: "range", disabled: "", min: minimum, max: maximum, step: definition.step, value: response ?? minimum, "aria-label": definition.label || "Slider" }],
        ["div", { class: "reader-slider-values" }, ["span", {}, definition.minimumLabel || String(minimum)], ["strong", {}, response == null ? "Not set" : String(response)], ["span", {}, definition.maximumLabel || String(maximum)]]];
      const choices = kind === "rating" ? Array.from({ length: maximum - minimum + 1 }, (_, i) => ({ id: minimum + i, label: String(minimum + i) })) : definition.choices;
      return ["section", { class: "penned-template-component reader-component" }, ...label, ["div", { class: "penned-component-choices" }, ...choices.map(choice => {
        const selected = Array.isArray(response) ? response.includes(choice.id) : response === choice.id;
        return ["span", { class: `penned-component-choice reader-component-choice${selected ? " is-selected" : ""}` }, ...(selected ? [icon("checkwavy")] : []), choice.label];
      })]];
    } }),
  ];
  const blocks = [
    Node.create({ name: "richLink", group: "block", content: "inline*", atom: true,
      addAttributes: () => defaults(richLinkDefaults), renderHTML: ({ node, HTMLAttributes }) => richLinkDOM(node, HTMLAttributes) }),
    Node.create({ name: "gridCard", group: "block", content: "block+", defining: true,
      addAttributes: () => defaults(GRID_CARD_DEFAULTS),
      renderHTML: ({ node, HTMLAttributes }) => {
        const card = gridCardSettings(node.attrs);
        return ["div", { ...HTMLAttributes, ...gridCardDOMAttributes(card), class: "vellix-callout penned-grid-card" },
          ["div", { class: "penned-grid-card-header" },
            ["span", { class: "vellix-callout-icon-button", style: `color:${card.iconColor}`, "aria-hidden": "true" }, icon(card.icon)],
            ["div", { class: "penned-grid-card-title" }, card.title]],
          ["div", { class: "vellix-callout-text" }, 0]];
      } }),
    Node.create({ name: "iconCallout", group: "block", content: "block+", defining: true,
      addAttributes: () => defaults({ ...ICON_CALLOUT_DEFAULTS, mediaID: null }),
      renderHTML: ({ node, HTMLAttributes }) => {
        const settings = iconCalloutSettings(node.attrs);
        const url = node.attrs.mediaID ? media(node.attrs.mediaID) : "";
        return ["div", { ...HTMLAttributes, class: "vellix-callout penned-icon-callout", style: iconCalloutSurface(settings) },
          ["span", { class: "vellix-callout-icon-button", style: `color:${settings.iconColor}`, "aria-hidden": "true" },
            url ? iconCalloutImage(url, settings.imageTint) : icon(settings.icon)],
          ["div", { class: "vellix-callout-text" }, 0]];
      } }),
    Node.create({ name: "plainCalloutRow", group: "block", content: "block*",
      renderHTML: ({ node }) => ["div", { class: "penned-callout-row", "data-plain-callout-row": "",
        style: `--penned-callout-gap-share:${calloutRowMetrics(node.content.content).gapShare}px;` },
        ["div", { class: "penned-callout-row-content" }, 0]] }),
    ...["callout", "plainCallout", "blockquote", "toggleItem"].map(name => Node.create({ name, group: "block", content: "block+", defining: true,
      addAttributes: () => defaults({ color: "#ffffff", icon: "sparkle", open: true, clipSource: null,
        ...(name === "plainCallout" ? { widthPercent: null, textColor: null, minimumHeight: null } : {}) }), renderHTML: ({ node, HTMLAttributes }) => {
        const color = validColor(node.attrs.color) || "#ffffff";
        const width = name === "plainCallout" && calloutWidth(node.attrs.widthPercent);
        const widthStyle = width ? `--penned-callout-width:${width}%;` : "";
        const source = name === "plainCallout" ? clipSource(node.attrs.clipSource) : null;
        if (source) return ["div", { ...HTMLAttributes, class: "vellix-plain-callout penned-clip-source", style: widthStyle },
          clipPreview(source, source.file?.mediaID ? media(source.file.previewMediaID || source.file.mediaID) : ""),
          ["div", { class: "vellix-plain-callout-text penned-clip-source-content" }, 0]];
        if (name === "toggleItem") return ["div", { ...HTMLAttributes, class: "reader-toggle", "data-reader-toggle": String(node.attrs.open !== false) }, 0];
        if (name === "blockquote") return ["blockquote", { ...HTMLAttributes, "data-blockquote-color": color, style: `--vellix-blockquote-color:${color}` }, 0];
        if (name === "plainCallout") return ["div", { ...HTMLAttributes, class: "vellix-plain-callout penned-plain-callout",
          "data-callout-width": width || null, style: widthStyle + plainCalloutSurface(node.attrs) +
            "--vellix-primary-text:var(--penned-callout-text,var(--penned-grid-ink));background:var(--penned-grid-bg);" +
            "border:0;align-items:flex-start;padding:10px 12px;min-height:var(--penned-plain-callout-min-height,0px);" },
          ["div", { class: "vellix-plain-callout-text", style: "flex:1 1 0;min-width:0;padding-block:2px;" }, 0]];
        const surface = `--vellix-callout-color:${color};`;
        return ["div", { ...HTMLAttributes, class: name === "callout" ? "vellix-callout" : "vellix-plain-callout", style: widthStyle + surface },
          ...(name === "callout" ? [["span", { class: "vellix-callout-icon-button", "aria-hidden": "true", style: `color:${color}` }, icon(node.attrs.icon)]] : []),
          ["div", { class: name === "callout" ? "vellix-callout-text" : "vellix-plain-callout-text" }, 0]];
      } })),
    Node.create({ name: "taskList", group: "block list", content: "taskItem+", renderHTML: () => ["ul", { "data-type": "taskList" }, 0] }),
    Node.create({ name: "taskItem", content: "paragraph block*", defining: true, addAttributes: () => defaults({ checked: false, crossed: false }), renderHTML: ({ node }) => ["li", { "data-type": "taskItem", "data-crossed": String(node.attrs.crossed) },
      ["label", { "aria-label": node.attrs.crossed ? "Skipped task" : node.attrs.checked ? "Completed task" : "Incomplete task" },
        ["input", { type: "checkbox", disabled: "", ...(node.attrs.checked || node.attrs.crossed ? { checked: "" } : {}) }], ["span", { "aria-hidden": "true" }]], ["div", {}, 0]] }),
    Node.create({ name: "table", group: "block", content: "tableRow*", addAttributes: () => defaults({ name: "Table", readerWidths: [], leftOffset: 0, stripeColor: null, columnless: false, rowless: false, rowCount: 0, columnCount: 0, headerRow: true }),
      renderHTML: ({ node }) => ["div", { class: "vellix-table-wrapper reader-table-scroll", id: node.attrs.readerAnchor, role: "region", tabindex: "0", "aria-label": node.attrs.name },
        ["table", { class: "vellix-table", style: style({ width: `${node.attrs.readerWidths.reduce((sum, width) => sum + width, 0)}px`, "margin-left": `${Math.max(0, Math.min(1000, Number(node.attrs.leftOffset) || 0))}px`, "--vellix-table-stripe": validColor(node.attrs.stripeColor) }),
          "data-columnless": String(node.attrs.columnless), "data-rowless": String(node.attrs.rowless) },
          ["colgroup", {}, ...node.attrs.readerWidths.map(width => ["col", { style: `width:${width}px` }])], ["tbody", 0]]] }),
    Node.create({ name: "tableRow", content: "(tableCell | tableHeader)+", renderHTML: () => ["tr", {}, 0] }),
    ...["tableCell", "tableHeader"].map(name => Node.create({ name, content: "block+", isolating: true,
      addAttributes: () => defaults({ colspan: 1, rowspan: 1, colwidth: null, fillColor: null, textColor: null, formula: null, calculated: null, font: null, bold: null, italic: false, strike: false, code: false, align: "left", format: "text", decimals: 2, currency: "USD" }),
      renderHTML: ({ node }) => {
        const a = node.attrs;
        return [name === "tableHeader" ? "th" : "td", { colspan: a.colspan, rowspan: a.rowspan, style: style({
          "background-color": validColor(a.fillColor), color: validColor(a.textColor), "font-family": a.code && a.font !== "hachiMaruPop" ? "var(--vellix-code-font-family,ui-monospace),monospace" : documentFonts[a.font],
          "font-weight": a.bold == null ? null : a.bold ? 700 : 400, "font-style": a.italic ? "italic" : null,
          "text-decoration": a.strike ? "line-through" : null, "text-align": ["left", "center", "right", "justify"].includes(a.align) ? a.align : "left" }) }, 0];
      } })),
    Node.create({ name: "listGrid", group: "block", content: "listGridRow+", isolating: true, defining: true,
      addAttributes: () => defaults({ cardBackground: "#E8DEF5", cardBorder: "#DBCEEF", leftBackground: "#D3C6E7", rightBorder: "#E4D9F3", leftFraction: 34 }),
      renderHTML: ({ node }) => {
        const a = node.attrs;
        const frac = Math.max(20, Math.min(80, Math.round(Number(a.leftFraction)) || 34));
        return ["div", { class: "penned-list-grid", style: style({
          "box-sizing": "border-box", width: "100%", "max-width": "100%", padding: "12px", "border-radius": "18px",
          background: validColor(a.cardBackground) || "#E8DEF5", border: `1px solid ${validColor(a.cardBorder) || "#DBCEEF"}`,
          display: "flex", "flex-direction": "column", gap: "8px", overflow: "hidden",
          "--lg-left-bg": validColor(a.leftBackground) || "#D3C6E7", "--lg-right-border": validColor(a.rightBorder) || "#E4D9F3",
          "--lg-left-fraction": `${frac}%` }) }, 0];
      } }),
    Node.create({ name: "listGridRow", content: "listGridLabel listGridValue", isolating: true,
      renderHTML: () => ["div", { class: "penned-list-grid-row", style: "display:grid;grid-template-columns:var(--lg-left-fraction,34%) minmax(0,1fr);gap:8px;align-items:stretch" }, 0] }),
    Node.create({ name: "listGridLabel", content: "paragraph", isolating: true, defining: true,
      renderHTML: () => ["div", { class: "penned-list-grid-label", style: "box-sizing:border-box;min-width:0;display:flex;align-items:center;padding:10px 14px;border-radius:12px;background:var(--lg-left-bg,#D3C6E7);font-weight:700;color:var(--vellix-primary-text,#211d29);overflow-wrap:anywhere" }, 0] }),
    Node.create({ name: "listGridValue", content: "paragraph", isolating: true, defining: true,
      renderHTML: () => ["div", { class: "penned-list-grid-value", style: "box-sizing:border-box;min-width:0;display:flex;align-items:center;padding:10px 14px;border-radius:12px;background:#ffffff;border:1px solid var(--lg-right-border,#E4D9F3);color:var(--vellix-primary-text,#211d29);overflow-wrap:anywhere" }, 0] }),
    Node.create({ name: "tabs", group: "block", content: "tabPanel+", isolating: true, defining: true,
      addAttributes: () => defaults({ activeTab: null, showContainer: true, showHeader: false, title: "", subtitle: "", icon: "",
        tabBarStyle: "filled", activeTabBg: "#3A3A3C", activeTabText: "#FFFFFF", inactiveTabBg: "#1C1C1E", inactiveTabText: "#9A9AA0",
        indicatorColor: "#7C5CFF", containerBg: "#111113", containerBorder: "#2A2A2E", borderWidth: 1, cornerRadius: 16, padding: 14,
        outerSpacing: 8, shadow: false, titleColor: "#FFFFFF", subtitleColor: "#9A9AA0", tabCornerRadius: 10, tabSpacing: 8,
        alignment: "leading", dividerVisible: true }),
      renderHTML: ({ node }) => {
        const a = node.attrs;
        const num = (value, lo, hi, fallback) => { const n = Math.round(Number(value)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback; };
        const barStyle = ["filled", "underlined", "segmented", "minimal"].includes(a.tabBarStyle) ? a.tabBarStyle : "filled";
        const align = ["leading", "center", "trailing"].includes(a.alignment) ? a.alignment : "leading";
        const aBg = validColor(a.activeTabBg) || "#3A3A3C", aText = validColor(a.activeTabText) || "#FFFFFF";
        const inBg = validColor(a.inactiveTabBg) || "#1C1C1E", inText = validColor(a.inactiveTabText) || "#9A9AA0";
        const indicator = validColor(a.indicatorColor) || "#7C5CFF";
        const tabCorner = num(a.tabCornerRadius, 0, 24, 10), tabGap = num(a.tabSpacing, 0, 32, 8);
        const container = a.showContainer !== false, divider = a.dividerVisible !== false;
        // Active tab + ordered panels, read from the live children (same as the editor bar).
        const panels = [];
        node.forEach(panel => { if (panel.type.name === "tabPanel") panels.push(panel); });
        const activeId = panels.some(p => p.attrs.id === a.activeTab) ? a.activeTab : (panels[0]?.attrs.id ?? null);
        const button = (panel, index) => {
          const active = panel.attrs.id === activeId;
          const name = panel.attrs.name && String(panel.attrs.name).trim() ? panel.attrs.name : `Tab ${index + 1}`;
          const base = { "font-weight": 600, "font-size": "15px", "line-height": 1.1, cursor: "pointer", border: "0",
            "max-width": "100%", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" };
          let decor;
          if (barStyle === "underlined") decor = { background: "transparent", padding: "8px 10px", "border-radius": "0",
            color: active ? aText : inText, "border-bottom": `2px solid ${active ? indicator : "transparent"}` };
          else if (barStyle === "minimal") decor = { background: "transparent", padding: "6px 8px", color: active ? aText : inText };
          else if (barStyle === "segmented") decor = { flex: "1 1 0", padding: "9px 16px", "border-radius": `${tabCorner}px`,
            background: active ? aBg : "transparent", color: active ? aText : inText };
          else decor = { padding: "9px 16px", "border-radius": `${tabCorner}px`, background: active ? aBg : inBg, color: active ? aText : inText };
          return ["button", { type: "button", class: "penned-tab", "data-select-tab": panel.attrs.id || "", "aria-pressed": String(active),
            style: style({ ...base, ...decor }) }, name];
        };
        const justify = align === "center" ? "center" : align === "trailing" ? "flex-end" : "flex-start";
        const barWrap = barStyle === "segmented"
          ? { display: "flex", "flex-wrap": "nowrap", gap: "4px", padding: "4px", background: inBg, "border-radius": `${tabCorner + 4}px` }
          : { display: "flex", "flex-wrap": "wrap", "align-items": "center", gap: `${tabGap}px`, "justify-content": justify,
              ...(divider ? { "border-bottom": `1px solid ${validColor(a.containerBorder) || "#2A2A2E"}`, "padding-bottom": "10px" } : {}) };
        const header = a.showHeader
          ? [["div", { class: "penned-tabs-header", style: "display:flex;align-items:center;gap:12px;min-width:0" },
              ...(a.icon ? [["span", { class: "penned-tabs-header-icon", "aria-hidden": "true",
                style: style({ display: "inline-block", width: "24px", height: "24px", flex: "0 0 24px", color: indicator }) }, icon(a.icon)]] : []),
              ["div", { style: "min-width:0;display:flex;flex-direction:column;gap:2px" },
                ["div", { class: "penned-tabs-title", style: style({ color: validColor(a.titleColor) || "#FFFFFF", "font-weight": 800, "font-size": "20px", "line-height": 1.15 }) }, a.title || "Untitled"],
                ...(a.subtitle ? [["div", { class: "penned-tabs-subtitle", style: style({ color: validColor(a.subtitleColor) || "#9A9AA0", "font-size": "13px", "line-height": 1.25 }) }, a.subtitle]] : [])]]]
          : [];
        const wrapStyle = style({ "box-sizing": "border-box", width: "100%", "max-width": "100%", "min-width": 0,
          display: "flex", "flex-direction": "column", gap: "12px", margin: `${num(a.outerSpacing, 0, 40, 8)}px 0`,
          ...(container ? { background: validColor(a.containerBg) || "#111113",
            border: `${num(a.borderWidth, 0, 8, 1)}px solid ${validColor(a.containerBorder) || "#2A2A2E"}`,
            "border-radius": `${num(a.cornerRadius, 0, 40, 16)}px`, padding: `${num(a.padding, 0, 40, 14)}px`,
            ...(a.shadow ? { "box-shadow": "0 12px 34px rgba(0,0,0,0.34)" } : {}) } : {}) });
        return ["div", { class: "penned-tabs", "data-tabs": "", "data-active-tab": activeId || undefined,
          "data-pt-style": barStyle, style: wrapStyle }, ...header,
          ["div", { class: "penned-tabs-bar", role: "tablist" },
            ["div", { style: style(barWrap) }, ...panels.map(button)]],
          ["div", { class: "penned-tab-panels", style: "min-width:0" }, 0]];
      } }),
    Node.create({ name: "tabPanel", content: "block+", isolating: true, defining: true,
      addAttributes: () => defaults({ id: null, name: "", readerActive: false }),
      renderHTML: ({ node }) => ["div", { class: "penned-tab-panel", role: "tabpanel",
        "data-tab-id": typeof node.attrs.id === "string" ? node.attrs.id : undefined,
        ...(node.attrs.readerActive ? {} : { hidden: "" }),
        style: "min-width:0" }, 0] }),
    Node.create({ name: "minimalFields", group: "block", content: "minimalRecord+", isolating: true, defining: true,
      addAttributes: () => defaults({ outerSpacing: 8 }),
      renderHTML: ({ node }) => {
        const n = Math.round(Number(node.attrs.outerSpacing));
        const outer = Number.isFinite(n) ? Math.max(0, Math.min(40, n)) : 8;
        return ["div", { class: "penned-minimal-fields", "data-minimal-fields": "",
          style: style({ "box-sizing": "border-box", width: "100%", "max-width": "100%", "min-width": 0,
            display: "flex", "flex-direction": "column", margin: `${outer}px 0` }) }, 0];
      } }),
    Node.create({ name: "minimalRecord", content: "minimalRecordTitle minimalField+", isolating: true, defining: true,
      addAttributes: () => defaults({ mf: null, mfFirst: false }),
      renderHTML: ({ node }) => {
        const num = (v, lo, hi, fb) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fb; };
        const a = node.attrs.mf || {};
        const s = { position: "relative", "box-sizing": "border-box", "min-width": 0, "padding-left": "16px",
          "border-left": `${num(a.accentWidth, 1, 8, 3)}px solid ${validColor(a.accentColor) || "#7C5CFF"}` };
        if (!node.attrs.mfFirst) {
          s["margin-top"] = `${num(a.recordSpacing, 0, 48, 18)}px`;
          if (a.dividerVisible !== false) {
            s["border-top"] = `1px solid ${validColor(a.dividerColor) || "#2A2A2E"}`;
            s["padding-top"] = `${num(a.recordSpacing, 0, 48, 18)}px`;
          }
        }
        return ["div", { class: "penned-minimal-record", style: style(s) }, 0];
      } }),
    Node.create({ name: "minimalRecordTitle", content: "inline*", defining: true,
      addAttributes: () => defaults({ mf: null }),
      renderHTML: ({ node }) => {
        const num = (v, lo, hi, fb) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fb; };
        const a = node.attrs.mf || {};
        return ["div", { class: "penned-minimal-title", style: style({ color: validColor(a.titleColor) || "#FFFFFF",
          "font-weight": 800, "font-size": `${num(a.titleSize, 14, 32, 20)}px`, "line-height": 1.2,
          "min-width": 0, "overflow-wrap": "anywhere" }) }, 0];
      } }),
    Node.create({ name: "minimalField", content: "minimalFieldLabel minimalFieldValue", isolating: true, defining: true,
      addAttributes: () => defaults({ mf: null }),
      renderHTML: ({ node }) => {
        const num = (v, lo, hi, fb) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fb; };
        const a = node.attrs.mf || {};
        return ["div", { class: "penned-minimal-field",
          style: style({ "min-width": 0, "margin-top": `${num(a.fieldSpacing, 0, 32, 12)}px` }) }, 0];
      } }),
    Node.create({ name: "minimalFieldLabel", content: "inline*", defining: true,
      addAttributes: () => defaults({ mf: null }),
      renderHTML: ({ node }) => {
        const num = (v, lo, hi, fb) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fb; };
        const a = node.attrs.mf || {};
        const s = { color: validColor(a.labelColor) || "#B98CFF", "font-weight": 700,
          "font-size": `${num(a.labelSize, 9, 18, 12)}px`, "line-height": 1.3, "letter-spacing": "0.04em",
          "min-width": 0, "overflow-wrap": "anywhere" };
        if (a.labelUppercase !== false) s["text-transform"] = "uppercase";
        return ["div", { class: "penned-minimal-label", style: style(s) }, 0];
      } }),
    Node.create({ name: "minimalFieldValue", content: "block+", isolating: true, defining: true,
      addAttributes: () => defaults({ mf: null }),
      renderHTML: ({ node }) => {
        const num = (v, lo, hi, fb) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fb; };
        const a = node.attrs.mf || {};
        return ["div", { class: "penned-minimal-value", style: style({ color: validColor(a.valueColor) || "#E4E4EA",
          "font-size": `${num(a.valueSize, 11, 22, 15)}px`, "line-height": 1.4, "margin-top": "2px", "min-width": 0 }) }, 0];
      } }),
  ];
  const global = Extension.create({ name: "pennedReadingAttributes", addGlobalAttributes: () => [{ types: ["paragraph", "caption", "heading", "blockquote", "callout", "gridCard", "iconCallout", "plainCallout", "toggleItem", "table", "attachment", "inlineProperty", "templateComponent", "publishedPage", "publishedCollection"],
    attributes: { readerAnchor: { default: null, renderHTML: attrs => attrs.readerAnchor ? { id: attrs.readerAnchor } : {} },
      textAlign: { default: null, renderHTML: attrs => ["left", "center", "right", "justify"].includes(attrs.textAlign) ? { "data-vellix-align": attrs.textAlign } : {} },
      indent: { default: 0, renderHTML: attrs => ({ "data-vellix-indent": String(Math.min(6, Math.max(0, Number(attrs.indent) || 0))) }) } } }] });
  const textStyle = createTextColor({ ...textColorDependencies, post: noOp, snapshot: noOp, selectionActive: () => false }).mark;
  return [StarterKit.configure({ document: false, heading: false, blockquote: false, horizontalRule: false, code: false, undoRedo: false, dropcursor: false, gapcursor: false,
    link: { openOnClick: true, HTMLAttributes: { target: "_blank", rel: "noopener noreferrer" } } }),
    createLabelHeading({ iconMask: name => {
      const source = options.iconURL(name);
      return source ? `url(${JSON.stringify(source)})` : null;
    } }),
    Node.create({ name: "doc", topNode: true, content: "block*" }), Caption, Code.extend({ excludes: "" }), textStyle, global, ...blocks, ...atoms];
}

export function renderPublicContent(document, options) {
  const root = structuredClone(document.content), toc = [];
  let count = 0;
  function headings(node, depth, inSource = false) {
    if (++count > 20000 || depth > 64) throw new Error("Publication content exceeds its limits");
    const section = node.type === "publishedCollection" ? node.attrs?.projection?.name
      : node.type === "publishedPage" ? node.attrs?.preview?.title : node.type === "table" ? node.attrs?.name : null;
    if (node.type === "heading" || (typeof section === "string" && section.trim())) {
      const id = `penned-heading-${toc.length}`;
      node.attrs = { ...node.attrs, readerAnchor: id };
      if (node.type === "publishedCollection") node.attrs.projection.readerAnchor = id;
      if (node.type === "publishedPage") node.attrs.preview.readerAnchor = id;
      toc.push({ id, level: node.attrs.level || 1, text: section || text(node) });
    }
    if (inSource && node.type === "inlineProperty") node.attrs = { ...node.attrs, readerClipSaved: true };
    if (node.type === "tabs") {
      const panels = (node.content || []).filter(child => child.type === "tabPanel");
      const activeId = panels.some(p => p.attrs && p.attrs.id === node.attrs?.activeTab)
        ? node.attrs.activeTab : (panels[0]?.attrs?.id ?? null);
      for (const panel of panels) panel.attrs = { ...(panel.attrs || {}), readerActive: panel.attrs?.id === activeId };
    }
    if (node.type === "minimalFields") {
      // Carry the block's appearance down to every descendant so each reader
      // node can render self-contained inline styles, and flag the first record
      // so only inner records draw a divider.
      const mf = node.attrs || {};
      const records = (node.content || []).filter(child => child.type === "minimalRecord");
      records.forEach((record, index) => {
        record.attrs = { ...(record.attrs || {}), mf, mfFirst: index === 0 };
        for (const child of record.content || []) {
          if (child.type === "minimalRecordTitle") child.attrs = { ...(child.attrs || {}), mf };
          else if (child.type === "minimalField") {
            child.attrs = { ...(child.attrs || {}), mf };
            for (const inner of child.content || []) {
              if (inner.type === "minimalFieldLabel" || inner.type === "minimalFieldValue") {
                inner.attrs = { ...(inner.attrs || {}), mf };
              }
            }
          }
        }
      });
    }
    const source = node.type === "plainCallout" && !!clipSource(node.attrs?.clipSource);
    for (const child of node.content || []) headings(child, depth + 1, source);
  }
  headings(root, 0); tablePresentation(root);
  const extensions = publicExtensions({ ...options, media: document.media });
  getSchema(extensions).nodeFromJSON(root).check();
  const segments = [[]];
  for (const node of root.content || []) {
    if (node.type === "pageBreak") segments.push([]); else segments.at(-1).push(node);
  }
  return { toc, segments: segments.map(content => generateHTML({ type: "doc", content }, extensions)) };
}

export function safePhoto(value) {
  try { const url = new URL(value); return url.protocol === "https:" && url.hostname === "images.unsplash.com" && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}
function photoCredit(photo) {
  if (!safePhoto(photo?.imageURL)) return [];
  const link = (label, raw) => {
    try { const url = new URL(raw); if (url.protocol === "https:" && url.hostname === "unsplash.com") return ["a", { href: url.href, rel: "noopener noreferrer", target: "_blank" }, label]; } catch {}
    return ["span", {}, label];
  };
  return [["small", { class: "reader-photo-credit" }, "Photo by ", link(photo.photographer || "Photographer", photo.photographerURL), " on ", link("Unsplash", photo.sourceURL)]];
}
export function contrastColor(hex) {
  const value = (validColor(hex) || "#34363f").slice(1);
  const normalized = value.length === 3 ? [...value].map(c => c + c).join("") : value;
  const rgb = [0, 2, 4].map(i => parseInt(normalized.slice(i, i + 2), 16));
  return rgb[0] * .299 + rgb[1] * .587 + rgb[2] * .114 > 165 ? "#181821" : "#ffffff";
}
function formatBytes(size) { return size < 1024 ? `${size} B` : size < 1048576 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1048576).toFixed(1)} MB`; }
function formatDate(value, includeTime) {
  const date = new Date(value.length === 10 ? value + "T12:00:00" : value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", ...(includeTime ? { timeStyle: "short", hour12: true } : {}) }).format(date) : value;
}
