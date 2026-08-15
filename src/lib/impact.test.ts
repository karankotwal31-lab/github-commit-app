import { describe, expect, test } from "bun:test";
import {
  analyzeImpact,
  extractImports,
  matchModulePath,
  resolveRelative,
} from "./impact";

const FILES = [
  "src/lib/utils.ts",
  "src/lib/format.ts",
  "src/lib/format.test.ts",
  "src/components/Button.tsx",
  "src/components/Card.tsx",
  "src/App.tsx",
  "src/hooks/useAuth.ts",
  "src/pages/Home.tsx",
  "convex/schema.ts",
  "package.json",
];

describe("extractImports", () => {
  test("finds ESM, export-from, dynamic, and require imports", () => {
    const src = `
import { a } from "./a";
import type { B } from "./b";
import "./styles.css";
export { c } from "./c";
const d = await import("./d");
const e = require("./e");
`;
    const specs = extractImports(src);
    expect(specs).toContain("./a");
    expect(specs).toContain("./b");
    expect(specs).toContain("./styles.css");
    expect(specs).toContain("./c");
    expect(specs).toContain("./d");
    expect(specs).toContain("./e");
  });

  test("strips query/hash suffixes", () => {
    expect(extractImports(`import x from "./data.json?raw"`)).toEqual([
      "./data.json",
    ]);
  });

  test("dedupes repeated specifiers", () => {
    const specs = extractImports(
      `import x from "./a"; import y from "./a";`,
    );
    expect(specs).toEqual(["./a"]);
  });
});

describe("resolveRelative", () => {
  test("resolves . and .. against the importing file's directory", () => {
    expect(resolveRelative("./lib/utils", "src/pages/Home.tsx")).toBe(
      "src/pages/lib/utils",
    );
    expect(resolveRelative("../lib/utils", "src/pages/Home.tsx")).toBe(
      "src/lib/utils",
    );
    expect(resolveRelative("./a", "src/a.ts")).toBe("src/a");
  });

  test("bare specifiers (node_modules) are not relative", () => {
    expect(resolveRelative("react", "src/App.tsx")).toBe(null);
    expect(resolveRelative("lodash/fp", "src/App.tsx")).toBe(null);
  });
});

describe("matchModulePath", () => {
  test("matches exact path and extensionless imports", () => {
    expect(matchModulePath("./utils", "src/lib/format.ts", FILES)).toBe(
      "src/lib/utils.ts",
    );
    expect(matchModulePath("../lib/format", "src/components/Button.tsx", FILES)).toBe(
      "src/lib/format.ts",
    );
    expect(matchModulePath("./Button", "src/components/Card.tsx", FILES)).toBe(
      "src/components/Button.tsx",
    );
  });

  test("returns null for bare specifiers", () => {
    expect(matchModulePath("react", "src/App.tsx", FILES)).toBe(null);
  });
});

describe("analyzeImpact", () => {
  const contents: Record<string, string> = {
    "src/lib/format.ts": `export const fmt = (x: number) => x.toFixed(2);`,
    "src/lib/format.test.ts": `import { fmt } from "./format";\nfmt(1);`,
    "src/components/Button.tsx": `import React from "react";\nimport { fmt } from "../lib/format";\nimport { cn } from "../lib/utils";\n`,
    "src/App.tsx": `import { Button } from "./components/Button";\nimport { useAuth } from "./hooks/useAuth";\n`,
    "src/hooks/useAuth.ts": `export const useAuth = () => {};`,
    "src/components/Card.tsx": `import { Button } from "./Button";\n`,
  };

  test("finds dependents including tests", () => {
    const result = analyzeImpact({
      targetPath: "src/lib/format.ts",
      allFiles: FILES,
      fileContents: contents,
    });
    expect(result.dependents.sort()).toEqual([
      "src/components/Button.tsx",
      "src/lib/format.test.ts",
    ]);
    expect(result.testDependents).toEqual(["src/lib/format.test.ts"]);
    expect(result.risk).toBe("MEDIUM");
    expect(result.imports).toEqual([]);
  });

  test("leaf component with one dependent is MEDIUM", () => {
    const result = analyzeImpact({
      targetPath: "src/components/Button.tsx",
      allFiles: FILES,
      fileContents: contents,
      targetContent: contents["src/components/Button.tsx"],
    });
    expect(result.dependents).toContain("src/components/Card.tsx");
    expect(result.dependents).toContain("src/App.tsx");
    expect(result.imports).toContain("src/lib/format.ts");
    expect(result.unresolvedImports).toContain("react");
    expect(result.risk).toBe("MEDIUM");
    expect(result.evidence.length).toBeGreaterThan(0);
  });

  test("infrastructure paths are CRITICAL", () => {
    const result = analyzeImpact({
      targetPath: "convex/schema.ts",
      allFiles: FILES,
      fileContents: contents,
    });
    expect(result.risk).toBe("CRITICAL");
    expect(result.evidence[0]).toContain("auth/config/schema");
  });

  test("many dependents raise risk", () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < 12; i++) {
      many[`src/comp${i}.ts`] = `import { fmt } from "./lib/format";`;
    }
    const result = analyzeImpact({
      targetPath: "src/lib/format.ts",
      allFiles: ["src/lib/format.ts", ...Object.keys(many)],
      fileContents: many,
    });
    expect(result.dependents.length).toBe(12);
    expect(result.risk).toBe("CRITICAL");
  });

  test("leaf file with no imports is LOW", () => {
    const result = analyzeImpact({
      targetPath: "src/pages/Home.tsx",
      allFiles: FILES,
      fileContents: contents,
    });
    expect(result.risk).toBe("LOW");
  });
});
