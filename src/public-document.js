import { Node, Extension, getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Code from "@tiptap/extension-code";
import { generateHTML } from "@tiptap/html/server";
import FormulaParser from "fast-formula-parser";
import { createTextColor, textColorDependencies } from "./text-color.js";
import { Caption } from "./caption.js";
import { normalizeProperty, propertyURL, PROPERTY_KINDS } from "./inline-properties.js";
import { componentDefinition, componentResponse } from "./template-components.js";
import "./table-formulas.js";

export const documentFonts = {
  rounded: 'ui-rounded,"SF Pro Rounded","Nunito Variable",Nunito,system-ui,sans-serif',
  system: "system-ui,sans-serif", serif: "ui-serif,Georgia,serif", mono: "ui-monospace,monospace",
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
    const result = linked(record, { class: "reader-page-card", "data-card-size": card.size, "data-card-pages": String(card.showsPages), "data-card-width": String(width),
      style: style({ "--card-width": `${width}px`, "--card-height": `${height}px`, "aspect-ratio": `${width}/${height}`, color }) },
      [["span", { class: "reader-page-card-face", style: style({ background, "font-family": documentFonts[record.fontStyle] || documentFonts.rounded }) },
        ...(card.showsPages ? [["span", { class: "reader-card-pages" }, ...(["wide", "large"].includes(card.size) ? [miniature(true)] : []), miniature(false)]] : []),
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
    Node.create({ name: "divider", group: "block", atom: true, addAttributes: () => defaults({ style: "thinLine" }), renderHTML: ({ node }) => {
      const type = ["thinLine", "thickLine", "dottedCircles", "fourCircles"].includes(node.attrs.style) ? node.attrs.style : "thinLine";
      return ["div", { "data-vellix-divider": "", "data-divider-style": type, role: "separator" }, type === "fourCircles"
        ? ["span", { class: "vellix-divider-four-circles" }, ...Array.from({ length: 4 }, () => ["i", { class: "vellix-divider-circle" }])]
        : ["span", { class: type === "dottedCircles" ? "vellix-divider-dots" : "vellix-divider-line" }]];
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
    Node.create({ name: "inlineProperty", group: "block", atom: true, addAttributes: () => defaults({ property: null }), renderHTML: ({ node }) => {
      const property = normalizeProperty(node.attrs.property), kind = PROPERTY_KINDS.find(item => item.kind === property.kind);
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
    ...["callout", "plainCallout", "blockquote", "toggleItem"].map(name => Node.create({ name, group: "block", content: "block+", defining: true,
      addAttributes: () => defaults({ color: "#ffffff", icon: "sparkle", open: true }), renderHTML: ({ node, HTMLAttributes }) => {
        const color = validColor(node.attrs.color) || "#ffffff";
        if (name === "toggleItem") return ["div", { ...HTMLAttributes, class: "reader-toggle", "data-reader-toggle": String(node.attrs.open !== false) }, 0];
        if (name === "blockquote") return ["blockquote", { ...HTMLAttributes, "data-blockquote-color": color, style: `--vellix-blockquote-color:${color}` }, 0];
        return ["div", { ...HTMLAttributes, class: name === "callout" ? "vellix-callout" : "vellix-plain-callout", style: `--vellix-callout-color:${color}` },
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
          "background-color": validColor(a.fillColor), color: validColor(a.textColor), "font-family": a.code ? documentFonts.mono : documentFonts[a.font],
          "font-weight": a.bold == null ? null : a.bold ? 700 : 400, "font-style": a.italic ? "italic" : null,
          "text-decoration": a.strike ? "line-through" : null, "text-align": ["left", "center", "right", "justify"].includes(a.align) ? a.align : "left" }) }, 0];
      } })),
  ];
  const global = Extension.create({ name: "pennedReadingAttributes", addGlobalAttributes: () => [{ types: ["paragraph", "caption", "heading", "blockquote", "callout", "plainCallout", "toggleItem", "table", "attachment", "inlineProperty", "templateComponent", "publishedPage", "publishedCollection"],
    attributes: { readerAnchor: { default: null, renderHTML: attrs => attrs.readerAnchor ? { id: attrs.readerAnchor } : {} },
      textAlign: { default: null, renderHTML: attrs => ["left", "center", "right", "justify"].includes(attrs.textAlign) ? { "data-vellix-align": attrs.textAlign } : {} },
      indent: { default: 0, renderHTML: attrs => ({ "data-vellix-indent": String(Math.min(6, Math.max(0, Number(attrs.indent) || 0))) }) } } }] });
  const textStyle = createTextColor({ ...textColorDependencies, post: noOp, snapshot: noOp, selectionActive: () => false }).mark;
  return [StarterKit.configure({ document: false, blockquote: false, horizontalRule: false, code: false, undoRedo: false, dropcursor: false, gapcursor: false,
    link: { openOnClick: true, HTMLAttributes: { target: "_blank", rel: "noopener noreferrer" } } }),
    Node.create({ name: "doc", topNode: true, content: "block*" }), Caption, Code.extend({ excludes: "" }), textStyle, global, ...blocks, ...atoms];
}

export function renderPublicContent(document, options) {
  const root = structuredClone(document.content), toc = [];
  let count = 0;
  function headings(node, depth) {
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
    for (const child of node.content || []) headings(child, depth + 1);
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
