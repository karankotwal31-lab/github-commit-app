import { describe, expect, test } from "bun:test";
import {
  classifyDanger,
  isBlockedShellCommand,
  parseCommand,
} from "./terminal";

describe("parseCommand", () => {
  test("splits command and args, lowercases the command", () => {
    expect(parseCommand("  STATUS  src/lib/foo.ts ")).toEqual({
      command: "status",
      args: ["src/lib/foo.ts"],
      raw: "STATUS  src/lib/foo.ts",
    });
  });

  test("keeps quoted segments as one arg", () => {
    const cmd = parseCommand('commit -m "fix the thing"');
    expect(cmd.command).toBe("commit");
    expect(cmd.args).toEqual(["-m", "fix the thing"]);
  });

  test("empty input parses to an empty command", () => {
    expect(parseCommand("   ").command).toBe("");
    expect(parseCommand("").raw).toBe("");
  });
});

describe("classifyDanger", () => {
  test("reset is dangerous", () => {
    const r = classifyDanger(parseCommand("reset"));
    expect(r.dangerous).toBe(true);
    expect(r.reason).toContain("local-only commits");
  });

  test("force / --hard / -f are dangerous", () => {
    expect(classifyDanger(parseCommand("push --force")).dangerous).toBe(true);
    expect(classifyDanger(parseCommand("reset --hard")).dangerous).toBe(true);
    expect(classifyDanger(parseCommand("branch -f main")).dangerous).toBe(true);
  });

  test("drop / delete / rm are dangerous", () => {
    expect(classifyDanger(parseCommand("stash drop 0")).dangerous).toBe(true);
    expect(classifyDanger(parseCommand("branch -D feature")).dangerous).toBe(
      true,
    );
  });

  test("safe commands are not dangerous", () => {
    expect(classifyDanger(parseCommand("status")).dangerous).toBe(false);
    expect(classifyDanger(parseCommand('commit -m "hi"')).dangerous).toBe(
      false,
    );
    expect(classifyDanger(parseCommand("stage src/a.ts")).dangerous).toBe(
      false,
    );
    expect(classifyDanger(parseCommand("help")).dangerous).toBe(false);
  });
});

describe("isBlockedShellCommand", () => {
  test("whitelisted git commands are allowed", () => {
    for (const c of [
      "clone",
      "status",
      "log",
      "branch",
      "stage",
      "add",
      "unstage",
      "commit",
      "stash",
      "reset",
      "clear",
      "help",
    ]) {
      expect(isBlockedShellCommand(parseCommand(c))).toBe(false);
    }
  });

  test("arbitrary shell commands are blocked, not faked", () => {
    expect(isBlockedShellCommand(parseCommand("ls"))).toBe(true);
    expect(isBlockedShellCommand(parseCommand("cat package.json"))).toBe(true);
    expect(isBlockedShellCommand(parseCommand("npm test"))).toBe(true);
    expect(isBlockedShellCommand(parseCommand("rm -rf /"))).toBe(true);
  });
});
