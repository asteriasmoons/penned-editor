export const blockFontFamilies = Object.freeze({
  system: "system-ui, sans-serif",
  serif: "ui-serif, Georgia, serif",
  mono: "ui-monospace, monospace",
  rounded: "ui-rounded, system-ui, sans-serif",
});

export function blockFontAttribute() {
  return {
    default: null,
    parseHTML: element => {
      const font = element.getAttribute("data-penned-block-font");
      return Object.hasOwn(blockFontFamilies, font) ? font : null;
    },
    renderHTML: ({ blockFont }) => {
      if (!Object.hasOwn(blockFontFamilies, blockFont)) return {};
      const family = blockFontFamilies[blockFont];
      return { "data-penned-block-font": blockFont, style: `--vellix-font-family: ${family}; font-family: ${family}` };
    },
  };
}
