// Bundled Monaco setup for Vite: wires the npm-installed monaco-editor into
// @monaco-editor/react and registers web workers so the editor works offline
// in the app bundle (no CDN dependency).
import * as monaco from "monaco-editor";
import { loader } from "@monaco-editor/react";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";

(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
  getWorker(_moduleId: string, label: string) {
    if (label === "json") return new jsonWorker();
    if (label === "css" || label === "scss" || label === "less") {
      return new cssWorker();
    }
    if (label === "html" || label === "handlebars" || label === "razor") {
      return new htmlWorker();
    }
    if (label === "typescript" || label === "javascript") {
      return new tsWorker();
    }
    return new editorWorker();
  },
};

loader.config({ monaco });

// Aria theme — calm turquoise ink on white, matching the app's sea-glass look.
monaco.editor.defineTheme("aria", {
  base: "vs",
  inherit: true,
  rules: [
    { token: "comment", foreground: "8AA6A6", fontStyle: "italic" },
    { token: "keyword", foreground: "00676B", fontStyle: "bold" },
    { token: "string", foreground: "0F6B3D" },
    { token: "number", foreground: "9A5B00" },
    { token: "type", foreground: "00739A" },
    { token: "type.identifier", foreground: "00739A" },
    { token: "identifier", foreground: "0D3B3E" },
    { token: "delimiter", foreground: "5D7777" },
    { token: "tag", foreground: "00739A" },
    { token: "attribute.name", foreground: "0F6B3D" },
    { token: "attribute.value", foreground: "9A5B00" },
    { token: "regexp", foreground: "9A5B00" },
  ],
  colors: {
    "editor.background": "#FFFFFF",
    "editor.foreground": "#0D3B3E",
    "editorLineNumber.foreground": "#A9C4C4",
    "editorLineNumber.activeForeground": "#5D7777",
    "editor.selectionBackground": "#CFECEC",
    "editor.inactiveSelectionBackground": "#E2F2F2",
    "editor.selectionHighlightBackground": "#D9EEEE",
    "editorCursor.foreground": "#00676B",
    "editor.lineHighlightBackground": "#F2FBFB",
    "editorIndentGuide.background1": "#E2EFEF",
    "editorIndentGuide.activeBackground1": "#C4DBDB",
    "editorWidget.background": "#FFFFFF",
    "editorWidget.border": "#D7E7E7",
    "editorWidget.foreground": "#0D3B3E",
    "editorSuggestWidget.selectedBackground": "#D9EEEE",
    "editorSuggestWidget.highlightForeground": "#00676B",
    "scrollbarSlider.background": "#C4DBDB99",
    "scrollbarSlider.hoverBackground": "#A9C4C499",
    "editorBracketMatch.background": "#CFECEC",
    "editorBracketMatch.border": "#5D7777",
  },
});

const EXTENSION_LANGUAGES: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  jsonc: "json",
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  less: "less",
  md: "markdown",
  yml: "yaml",
  yaml: "yaml",
  py: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  java: "java",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  sql: "sql",
  xml: "xml",
  svg: "xml",
  toml: "ini",
  ini: "ini",
  conf: "ini",
  env: "ini",
  dockerfile: "dockerfile",
  dockerignore: "plaintext",
  gitignore: "plaintext",
  txt: "plaintext",
  diff: "diff",
  patch: "diff",
};

export function languageForPath(path: string): string {
  const name = path.split("/").pop() ?? path;
  const lower = name.toLowerCase();
  if (lower === "dockerfile") return "dockerfile";
  const dot = name.lastIndexOf(".");
  if (dot === -1) return "plaintext";
  const ext = name.slice(dot + 1).toLowerCase();
  return EXTENSION_LANGUAGES[ext] ?? "plaintext";
}
