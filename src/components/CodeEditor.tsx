import Editor from "@monaco-editor/react";
import "@/lib/monaco";
import { languageForPath } from "@/lib/monaco";

/**
 * The Aria code editor: Monaco with the app's turquoise "aria" theme and
 * per-file language detection. Mirrors the current file content via `value`
 * and reports edits through `onChange`, so the surrounding commit/stage
 * flows keep working exactly as before.
 */
export function CodeEditor({
  path,
  value,
  onChange,
}: {
  path: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Editor
      language={languageForPath(path)}
      value={value}
      onChange={(next) => onChange(next ?? "")}
      theme="aria"
      options={{
        minimap: { enabled: false },
        fontSize: 13,
        fontFamily:
          "ui-monospace, SFMono-Regular, Menlo, Monaco, 'Cascadia Code', monospace",
        lineHeight: 21,
        wordWrap: "off",
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 2,
        renderWhitespace: "none",
        smoothScrolling: true,
        padding: { top: 16, bottom: 16 },
        scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
        fixedOverflowWidgets: true,
        overviewRulerLanes: 0,
        hideCursorInOverviewRuler: true,
      }}
    />
  );
}
