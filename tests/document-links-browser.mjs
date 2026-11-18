import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ||
  resolve(homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs"));
const root = resolve(process.env.PENNED_EDITOR_BUNDLE || "dist");
const selectionSource = await readFile(new URL("../../Vellix/Vellix/Editor/MobileBlockSelection.swift", import.meta.url), "utf8");
const selectionScript = selectionSource.match(/static let script = #"""\n([\s\S]*?)\n"""#/)[1].replaceAll("\\#(selectionGutter)", "6");
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const href = "https://example.test/journal/";
const metadata = { title: "Journal · Example", description: "A preview of the latest journal entries and ideas worth revisiting.",
  site: "Example", image: "https://example.test/image.svg", favicon: "https://example.test/icon.svg" };

try {
  for (const width of [390, 834]) {
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => {
      window.events = [];
      window.webkit = { messageHandlers: { tiptap: { postMessage: event => window.events.push(event) } } };
    });
    await page.addInitScript(selectionScript);
    await page.route("https://example.test/**", route => route.fulfill({ contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 80"><rect width="160" height="80" fill="#322a53"/><circle cx="80" cy="40" r="24" fill="#92d7cf"/></svg>' }));
    await page.goto(pathToFileURL(resolve(root, "tiptap.html")).href);
    const result = await page.evaluate(async ({ href, metadata }) => {
      const command = window.tiptapCommand;
      const editor = document.querySelector(".tiptap-editor").editor;
      document.documentElement.style.setProperty("background", "#09080d", "important");
      const p = (id, text, marks) => ({ type: "paragraph", attrs: { id }, content: text ? [{ type: "text", text, marks }] : [] });
      const load = content => command("setContent", { document: { type: "doc", content } });
      const json = () => command("getDocument");
      const current = async () => (await json()).content[0];
      const check = (predicate, label) => { if (!predicate) throw Error(label); };
      const info = () => events.filter(event => event.kind === "formattingState").at(-1)?.payload;
      const select = async blockID => {
        await command("setSelectionMode", { mode: "multi" });
        const record = PennedBlockSelection.records(editor.state.doc).find(record => record.node.attrs.id === blockID);
        const element = editor.view.nodeDOM(record.pos);
        (element.querySelector("a[href]") || element).click();
        check(PennedBlockSelection.selectionFacade().has(record.key), "tapping a block in selection mode selects it");
      };
      await load([p("words", "Words stay the same", [{ type: "bold" }]), p("neighbor", "Do not touch")]);
      editor.commands.setTextSelection({ from: 1, to: 6 });
      check(info().canLinkText, "Link is offered for a text range");
      const first = await command("linksBegin", { mode: "text" });
      editor.commands.setTextSelection(8);
      check(await command("linksApply", { token: first.token, href }), "held range applies");
      const linked = await current();
      check(linked.content[0].text === "Words" && linked.content[1].text === " stay the same", "words unchanged");
      check(linked.content[0].marks.some(mark => mark.type === "bold") && linked.content[0].marks.some(mark => mark.attrs?.href === href), "bold and link coexist");
      editor.commands.setTextSelection(2);
      const removal = await command("linksBegin", { mode: "text" });
      check(removal.href === href && removal.existing, "a caret inside a link edits the complete linked range");
      check(await command("linksApply", { token: removal.token, remove: true }), "remove link");
      check((await current()).content[0].marks.every(mark => mark.type !== "link"), "link removed");
      editor.commands.setTextSelection({ from: 1, to: 5 });
      const stale = await command("linksBegin", { mode: "text" });
      editor.commands.insertContentAt(8, "!");
      check(!await command("linksApply", { token: stale.token, href }), "stale range rejected");
      check(!await command("linksApply", { token: stale.token, href: "javascript:alert(1)" }), "unsafe URL rejected");

      const parsed = await command("linksMetadata", { href, html: '<base href="https://other.test/"><title>Fallback</title>' +
        '<meta property="og:title" content="Journal &amp; Notes"><meta name="description" content="A description">' +
        '<meta property="og:image" content="/image.svg"><link rel="shortcut icon" href="icon.svg"><script>window.untrustedRan = true</script>' });
      check(parsed.title === "Journal & Notes" && parsed.description === "A description" && parsed.image === metadata.image, "metadata and entities parsed");
      check(parsed.favicon === href + "icon.svg" && !window.untrustedRan, "relative favicon and inert parsing");

      for (const kind of ["text", "label", "rich"]) {
        await load([p("insertion", "")]);
        const request = await command("linksBegin", { mode: "insert" });
        check(!await command("linksApply", { token: request.token, kind, href: "javascript:alert(1)" }), "insertion rejects unsafe URL");
        check(await command("linksApply", { token: request.token, href, kind, label: "My Journal", metadata }), "standalone insertion");
        const node = await current();
        check(node.type === (kind === "rich" ? "richLink" : "paragraph"), "standalone link type");
        check(node.content[0].text === (kind === "label" ? "My Journal" : href), "standalone display text");
      }

      const heading = { ...p("bookmark", "My Journal", [{ type: "link", attrs: { href } }, { type: "bold" }]),
        type: "heading", attrs: { id: "bookmark", level: 3 } };

      await load([heading, p("neighbor", "Do not touch")]);
      await select("bookmark");
      check(info().selectedBlocksStyle?.type === "heading3" && info().selectedBlocksStyle.marks.includes("bold") &&
        !info().bold, "the Style sheet reports block marks without changing caret toolbar state");
      await command("formatSelectedBlocks", { action: "underline" });
      await command("formatSelectedBlocks", { action: "align", value: "center" });
      check(info().selectedBlocksStyle?.alignment === "center" && info().selectedBlocksStyle.marks.includes("underline"),
        "additional formatting updates the selected block and its active controls");
      const selectionEvents = events.length;
      const neighbor = document.querySelector('[data-vellix-block-id="neighbor"]');
      for (const [value, family] of [["system", "system-ui"], ["serif", "ui-serif"], ["rounded", "ui-rounded"], ["mono", "ui-monospace"]]) {
        check(await command("formatSelectedBlocks", { action: "font", value }), "font tile applies a real style");
        const target = document.querySelector('[data-vellix-block-id="bookmark"]');
        check(getComputedStyle(target.querySelector("a")).fontFamily.includes(family) && (await current()).attrs.blockFont === value &&
          info().selectedBlocksStyle.font === value, "font renders through inline marks and is saved on the block");
      }
      check(!await command("formatSelectedBlocks", { action: "font", value: "inherit; color: red" }), "arbitrary font styles are rejected");
      check(neighbor === document.querySelector('[data-vellix-block-id="neighbor"]') && !neighbor.dataset.pennedBlockFont,
        "unselected blocks are not replaced or restyled");
      for (const [blockType, level] of [["heading", 1], ["heading", 2], ["heading", 3], ["heading", 4], ["paragraph"], ["caption"]]) {
        await command("setSelectedBlockType", { blockType, level });
        const block = await current();
        const style = info().selectedBlocksStyle;
        check(block.type === blockType && (!level || block.attrs.level === level) && block.attrs.id === "bookmark" &&
          style?.type === (level ? `heading${level}` : blockType), "each text style applies to the same selected block");
        check(block.content[0].marks.some(mark => mark.type === "link" && mark.attrs.href === href) && block.attrs.blockFont === "mono" &&
          style.alignment === "center" && style.marks.includes("bold") && style.marks.includes("underline"),
          "changing text style preserves the URL, font, inline formatting, and alignment");
      }
      check(!events.slice(selectionEvents).some(event => (event.kind === "selection" && event.payload.count === 0) ||
        (event.kind === "selectionMode" && event.payload.mode === "off")), "formatting must never publish a transient empty selection");
      await command("setSelectionMode", { mode: "off" });
      check(!info().selectedBlocksStyle, "block style is cleared when leaving selection");

      await load([p("already-bold", "Keep bold", [{ type: "bold" }]), p("not-bold", "Add bold"), p("other", "Do not format")]);
      await select("already-bold");
      await select("not-bold");
      const bold = async () => (await json()).content.map(node => !!node.content?.[0]?.marks?.some(mark => mark.type === "bold"));
      await command("formatSelectedBlocks", { action: "bold" });
      check(JSON.stringify(await bold()) === "[true,true,false]", "one tap enables Bold uniformly on a mixed selection");
      await command("formatSelectedBlocks", { action: "bold" });
      check(JSON.stringify(await bold()) === "[false,false,false]", "one tap removes Bold when all selected text is bold");

      const target = info().selectedBlocksStyle?.target;
      const beforePause = events.length;
      await command("setEditable", { editable: false, preservingBlockSelection: true });
      check(!await command("formatSelectedBlocks", { action: "align", value: "right", selectionTarget: target }),
        "formatting is blocked while the document is suspended for import");
      await command("setEditable", { editable: true });
      check(target && info().selectedBlocksStyle?.target === target && PennedBlockSelection.selectedRecords().length === 2 &&
        !events.slice(beforePause).some(event => event.kind === "selectionMode" && event.payload.mode === "off"),
        "suspending and resuming an unchanged document does not clear the active Style selection");
      await command("setSelectionMode", { mode: "off" });
      await select("other");
      check(!await command("formatSelectedBlocks", { action: "align", value: "right", selectionTarget: target }) &&
        !await command("setSelectedBlockType", { blockType: "heading", level: 1, selectionTarget: target }),
        "a delayed tap must not apply to a different selection");
      check((await json()).content[2].type === "paragraph" && !(await json()).content[2].attrs.textAlign,
        "the new selection is untouched by the stale controls");

      for (const [blockType, list] of [["checkListItem", "taskList"], ["bulletListItem", "bulletList"], ["numberedListItem", "orderedList"]]) {
        await load([p("list-target", "Format this item"), p("next", "Leave this alone")]);
        await select("list-target");
        const selectionTarget = info().selectedBlocksStyle.target;
        const start = events.length;
        check(await command("setSelectedBlockType", { blockType, selectionTarget }) && (await current()).type === list,
          "list conversion applies");
        check(PennedBlockSelection.selectedRecords().length === 1 && info().selectedBlocksStyle?.list === list &&
          info().selectedBlocksStyle.target === selectionTarget, "wrapping text keeps the same Style target");
        check(await command("formatSelectedBlocks", { action: "align", value: "right", selectionTarget }),
          "the selected nested item can still be aligned from the original panel");
        check(PennedBlockSelection.selectedRecords()[0].node.attrs.textAlign === "right" &&
          !events.slice(start).some(event => event.kind === "selection" && event.payload.count === 0),
          "list conversion and nested formatting do not clear selection");
      }

      const savedFont = { ...heading, attrs: { ...heading.attrs, blockFont: "serif" } };
      await load([savedFont, p("next", "Leave this alone")]);
      check(document.querySelector('[data-vellix-block-id="bookmark"]').dataset.pennedBlockFont === "serif", "font survives reopening");

      await load([savedFont, p("neighbor", "Do not touch")]);
      await select("bookmark");
      check(info().selectedLink?.kind === "text", "single text link selection reported");
      const act = (kind, action, extra) => command("linksSelected", { blockID: "bookmark", href, kind, action, ...extra });
      check(await act("text", "convert", { metadata }), "convert to Rich Link");
      check(info().selectedLink?.kind === "rich", "conversion keeps block selected");
      for (const layout of ["small", "regular", "card"]) {
        check(await act("rich", "layout", { layout }), "set Rich Link layout");
        check((await current()).attrs.layout === layout, "layout saved immediately");
      }
      check(await act("rich", "convert"), "convert back to text");
      const text = await current();
      check(text.type === "heading" && text.attrs.level === 3 && text.content[0].text === "My Journal", "heading and wording restored");
      check(text.attrs.blockFont === "serif" && text.content[0].marks.some(mark => mark.type === "bold"),
        "font and inline formatting survive Rich Link conversion");
      check(await act("text", "convert"), "convert back with cached metadata");
      const restored = await current();
      check(restored.attrs.layout === "card" && restored.attrs.metadata.title === metadata.title, "layout and metadata survive round-trip");
      check((await json()).content[1].content[0].text === "Do not touch", "neighbor preserved");
      check(await act("rich", "reload", { metadata: { ...metadata, title: "Updated Journal" } }), "metadata reload");
      const updated = await current();
      check(updated.attrs.layout === "card" && updated.attrs.metadata.title === "Updated Journal", "reload preserves layout");
      const removeCard = await command("linksBegin", { mode: "block", blockID: "bookmark" });
      check(removeCard.kind === "rich" && await command("linksApply", { token: removeCard.token, remove: true }), "remove a Rich Link without losing its label");
      const unlinked = await current();
      check(unlinked.type === "heading" && unlinked.content[0].text === "My Journal" &&
        unlinked.content[0].marks.every(mark => mark.type !== "link"), "removed card returns to unlinked text");
      await command("setSelectionMode", { mode: "off" });
      await load(["small", "regular", "card"].map(layout => ({ ...updated, attrs: { ...updated.attrs, id: layout, layout } })));
      const reopened = await json();
      check(reopened.content.every(node => node.attrs.href === href && node.attrs.metadata.image === metadata.image), "saved document reload");
      const openCount = events.filter(event => event.kind === "documentLinkOpen").length;
      await select("small");
      check(info().selectedLink?.kind === "rich" && events.filter(event => event.kind === "documentLinkOpen").length === openCount,
        "selection-mode taps on Rich Links do not open them");
      await command("setSelectionMode", { mode: "off" });
      document.querySelector(".penned-rich-link-preview").click();
      check(events.some(event => event.kind === "documentLinkOpen" && event.payload.url === href), "Rich Link opens through native bridge");

      const breakBlock = id => ({ type: "pageBreak", attrs: { id } });
      await load([p("margin-reference", "Content margin"), ...reopened.content.flatMap(node => [
        breakBlock(`before-${node.attrs.layout}`), { ...node, attrs: { ...node.attrs, indent: 2 } },
      ]), breakBlock("after-card"), p("last", "Final page")]);
      const geometry = () => {
        const margin = document.querySelector('[data-vellix-block-id="margin-reference"]').getBoundingClientRect();
        return [...document.querySelectorAll(".penned-rich-link")].map(link => {
          const bounds = link.getBoundingClientRect();
          const preview = link.querySelector(".penned-rich-link-preview").getBoundingClientRect();
          const css = getComputedStyle(link);
          check(Math.abs(bounds.left - margin.left) < 0.5, `${link.dataset.linkLayout} aligns with paragraph even with stored indent`);
          check(bounds.width <= margin.width, "link fits content width");
          check(Math.abs(bounds.top + 1 - preview.top) < 0.5 && Math.abs(bounds.bottom - 1 - preview.bottom) < 0.5,
            `${link.dataset.linkLayout} has no empty strip inside its frame`);
          const edge = link.dataset.linkLayout === "card" ? getComputedStyle(link.nextElementSibling).marginTop : css.marginBottom;
          check(css.marginTop === "20px" && edge === "20px", "page spacing remains outside link frame");
          if (link.dataset.linkLayout === "small") {
            check(bounds.height <= 31 && link.querySelector(".penned-rich-link-site").getBoundingClientRect().height === 0,
              "Small is a compact thumbnail and title row");
          }
          return [bounds.left, bounds.top, bounds.width, bounds.height];
        });
      };
      const editing = geometry();
      await select("card");
      check(JSON.stringify(geometry()) === JSON.stringify(editing), "selection mode does not move link previews");
      await command("setSelectionMode", { mode: "off" });
      await command("setEditable", { editable: false });
      check(JSON.stringify(geometry()) === JSON.stringify(editing), "reading and editing use the same link geometry");
      check(!await command("linksBegin", { mode: "insert" }), "locked document rejects editing");

      await command("setEditable", { editable: true });
      const link = (id, layout) => ({ ...updated, attrs: { ...updated.attrs, id, layout } });
      await load([p("margin-reference", "Content margin"), breakBlock("before-pair"), link("a", "card"),
        link("b", "regular"), link("c", "card"), link("d", "card"), link("s", "small"), link("r", "regular"), link("e", "card")]);
      await select("b");
      check(await command("linksSelected", { blockID: "b", href, kind: "rich", action: "layout", layout: "card" }),
        "changing the adjacent link into a Card makes a pair");
      const pairedDocument = await json();
      const cards = () => [...document.querySelectorAll(".penned-rich-link")].map(el => el.getBoundingClientRect().toJSON());
      const [a, b, c, d, s, r, e] = cards();
      const pageWidth = document.querySelector('[data-vellix-block-id="margin-reference"]').getBoundingClientRect().width;
      check(a.y === b.y && c.y === d.y && c.y >= a.bottom && b.x - a.right === 12 && d.x - c.right === 12,
        "consecutive cards form two aligned pairs with a consistent gap");
      check(a.x === c.x && a.x === e.x && a.width === b.width && b.right === s.right && s.width === pageWidth && r.width === pageWidth,
        "cards and full-width links respect the same document margins");
      check(PennedBlockSelection.selectedRecords().map(record => record.node.attrs.id).join() === "b",
        "only the second card is selected");
      await command("setSelectionMode", { mode: "off" });
      await command("setEditable", { editable: false });
      check(JSON.stringify(cards()) === JSON.stringify([a, b, c, d, s, r, e]), "pairs do not move between selection and reading");
      await command("setEditable", { editable: true });
      await select("b");
      await command("deleteSelectedBlocks");
      check((await json()).content.filter(node => node.type === "richLink").map(node => node.attrs.id).join() === "a,c,d,s,r,e" &&
        cards()[0].y === cards()[1].y, "removing one card leaves its partner intact and reflows the row");
      const short = link("short", "card");
      short.attrs.metadata = { title: "Short preview", site: "Example" };
      await load([link("tall", "card"), short, breakBlock("after-pair"), p("last", "Final page")]);
      const [tallBox, shortBox] = cards();
      const pageBreak = document.querySelector("[data-vellix-page-break]").getBoundingClientRect();
      check(tallBox.y === shortBox.y && tallBox.height > shortBox.height && pageBreak.top - tallBox.bottom >= 20,
        "page-edge spacing follows the tallest card in the row");
      await load(reopened.content);
      return { layouts: reopened.content.map(node => node.attrs.layout), pairedDocument };
    }, { href, metadata });
    assert.deepEqual(result.layouts, ["small", "regular", "card"]);
    const boxes = await Promise.all(result.layouts.map(layout => page.locator(`[data-link-layout="${layout}"]`).boundingBox()));
    assert(boxes[0].height < boxes[1].height && boxes[1].height < boxes[2].height);
    assert(boxes[0].width === boxes[1].width && boxes[2].width < boxes[1].width);
    await page.locator(".penned-rich-link-image").first().evaluate(image => image.decode());
    assert.deepEqual(errors, []);
    if (width === 390 && process.env.LINK_SCREENSHOT) {
      await page.evaluate(document => window.tiptapCommand("setContent", { document }), result.pairedDocument);
      await page.locator(".penned-rich-link-image").first().evaluate(image => image.decode());
      await page.screenshot({ path: process.env.LINK_SCREENSHOT });
    }
    await page.close();
  }
  console.log("Links: editing, conversion, persisted fonts, selection retention and Card pairing passed at both widths.");
} finally { await browser.close(); }
