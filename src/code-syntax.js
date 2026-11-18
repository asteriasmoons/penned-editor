import catalog from "./code-block-catalog.json";

// Load grammars only on first use, in Prism's documented dependency order.
function loadPrism() {
  const Prism = require("prismjs/components/prism-core");
  globalThis.Prism = Prism;
  Prism.manual = true;
  require("prismjs/components/prism-markup");
  require("prismjs/components/prism-clike");
  require("prismjs/components/prism-css");
  require("prismjs/components/prism-javascript");
  require("prismjs/components/prism-c");
  require("prismjs/components/prism-basic");
  require("prismjs/components/prism-markup-templating");
  require("prismjs/components/prism-ada");
  require("prismjs/components/prism-bash");
  require("prismjs/components/prism-cpp");
  require("prismjs/components/prism-csharp");
  require("prismjs/components/prism-dart");
  require("prismjs/components/prism-docker");
  require("prismjs/components/prism-go");
  require("prismjs/components/prism-groovy");
  require("prismjs/components/prism-haskell");
  require("prismjs/components/prism-java");
  require("prismjs/components/prism-json");
  require("prismjs/components/prism-julia");
  require("prismjs/components/prism-kotlin");
  require("prismjs/components/prism-lua");
  require("prismjs/components/prism-markdown");
  require("prismjs/components/prism-matlab");
  require("prismjs/components/prism-objectivec");
  require("prismjs/components/prism-perl");
  require("prismjs/components/prism-php");
  require("prismjs/components/prism-prolog");
  require("prismjs/components/prism-python");
  require("prismjs/components/prism-r");
  require("prismjs/components/prism-ruby");
  require("prismjs/components/prism-rust");
  require("prismjs/components/prism-scala");
  require("prismjs/components/prism-shell-session");
  require("prismjs/components/prism-sql");
  require("prismjs/components/prism-swift");
  require("prismjs/components/prism-typescript");
  require("prismjs/components/prism-vbnet");
  require("prismjs/components/prism-yaml");
  return Prism;
}

let prism;
const grammarIDs = new Map(catalog.languages.map(({ id, grammar }) => [id, grammar || id]));
const roles = new Map(Object.entries({
  keyword: "keyword", atrule: "keyword", boolean: "keyword", important: "keyword", tag: "keyword", directive: "keyword",
  bold: "keyword", italic: "type", "code-snippet": "string", "inline-code": "string",
  string: "string", char: "string", regex: "string", "attr-value": "string", url: "string", cdata: "string",
  comment: "comment", prolog: "comment", doctype: "comment", number: "number", constant: "number", symbol: "number",
  "class-name": "type", builtin: "type", type: "type", namespace: "type", selector: "type", title: "type",
  function: "function", "function-name": "function", method: "function",
  variable: "variable", property: "variable", parameter: "variable", "attr-name": "variable",
  operator: "operator", punctuation: "operator", entity: "operator"
}));

function tokens(source, language) {
  let key = language?.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(catalog.aliases, key)) key = catalog.aliases[key];
  if (!source || !grammarIDs.has(key) || key === "plaintext" || key === "other") return [];
  let Prism;
  try { Prism = prism ??= loadPrism(); } catch { return []; }
  // Shell sessions have prompts; plain shell scripts use the Bash/Unix shell grammar.
  const grammarID = key === "shell" && !/^(?:[\w.-]+@[^\s$]+[#$%]|\$) /m.test(source) ? "bash" : grammarIDs.get(key);
  // Own entries only: do not treat inherited object names as grammars.
  const grammar = grammarID && Object.prototype.hasOwnProperty.call(Prism.languages, grammarID) && Prism.languages[grammarID];
  if (!grammar) return [];
  let offset = 0;
  const result = [];
  function walk(value, role) {
    if (typeof value === "string") {
      if (role && value.length) {
        const last = result[result.length - 1];
        if (last?.role === role && last.start + last.length === offset) last.length += value.length;
        else result.push({ start: offset, length: value.length, role });
      }
      offset += value.length;
    } else if (Array.isArray(value)) {
      for (const child of value) walk(child, role);
    } else {
      const match = roles.get(value.type) || [value.alias].flat().map(alias => roles.get(alias)).find(Boolean);
      walk(value.content, match || role);
    }
  }
  try {
    if (grammarID === "php" && !/<\?(?:php\b|=)/i.test(source)) {
      walk(Prism.tokenize(source, grammar));
    } else {
      const environment = { code: source, grammar, language: grammarID };
      Prism.hooks.run("before-tokenize", environment);
      environment.tokens = Prism.tokenize(environment.code, environment.grammar);
      Prism.hooks.run("after-tokenize", environment);
      walk(environment.tokens);
    }
  } catch { return []; }
  return offset === source.length ? result : [];
}

globalThis.PennedCodeSyntax = { tokens };
