import { describe, expect, it } from "vitest";
import { TOOL_STATUS, type MessageToolBlock } from "@shared/bridge-types";
import { diffLines, fileChangeLines, formatArgs, toolSummary } from "./toolDisplay";

function tool(name: string, args?: Record<string, unknown>): MessageToolBlock {
  return { kind: "tool", callId: "call_1", name, args, status: TOOL_STATUS.DONE };
}

describe("toolSummary", () => {
  it("shows the command for bash and the path for file tools", () => {
    expect(toolSummary(tool("bash", { command: "git status --short" }))).toBe("git status --short");
    expect(toolSummary(tool("read", { path: "src/App.tsx" }))).toBe("src/App.tsx");
    expect(toolSummary(tool("edit", { file_path: "README.md" }))).toBe("README.md");
  });

  it("falls back to the first string argument for an unknown tool", () => {
    expect(toolSummary(tool("custom_tool", { count: 2, query: "needle" }))).toBe("needle");
  });

  it("returns undefined when no argument is a string", () => {
    expect(toolSummary(tool("bash", {}))).toBeUndefined();
    expect(toolSummary(tool("bash"))).toBeUndefined();
  });
});

describe("diffLines", () => {
  it("keeps identical text as same lines", () => {
    expect(diffLines("a\nb", "a\nb")).toEqual([
      { kind: "same", text: "a" },
      { kind: "same", text: "b" },
    ]);
  });

  it("trims the common prefix and suffix and marks the changed middle", () => {
    expect(diffLines("one\ntwo\nthree", "one\nTWO\nthree")).toEqual([
      { kind: "same", text: "one" },
      { kind: "del", text: "two" },
      { kind: "add", text: "TWO" },
      { kind: "same", text: "three" },
    ]);
  });

  it("handles pure insertions and pure deletions", () => {
    expect(diffLines("a", "a\nb")).toEqual([
      { kind: "same", text: "a" },
      { kind: "add", text: "b" },
    ]);
    expect(diffLines("a\nb", "a")).toEqual([
      { kind: "same", text: "a" },
      { kind: "del", text: "b" },
    ]);
  });
});

describe("fileChangeLines", () => {
  it("builds a diff for an edit's oldText/newText", () => {
    const lines = fileChangeLines(tool("edit", { path: "a.ts", oldText: "const a = 1;", newText: "const a = 2;" }));
    expect(lines).toEqual([
      { kind: "del", text: "const a = 1;" },
      { kind: "add", text: "const a = 2;" },
    ]);
  });

  it("renders a write's content as added lines", () => {
    expect(fileChangeLines(tool("write", { path: "a.ts", content: "one\ntwo" }))).toEqual([
      { kind: "add", text: "one" },
      { kind: "add", text: "two" },
    ]);
  });

  it("returns undefined for tools that do not change a file", () => {
    expect(fileChangeLines(tool("bash", { command: "ls" }))).toBeUndefined();
    expect(fileChangeLines(tool("edit", { path: "a.ts" }))).toBeUndefined();
  });
});

describe("formatArgs", () => {
  it("pretty-prints arguments", () => {
    expect(formatArgs(tool("bash", { command: "ls" }))).toBe('{\n  "command": "ls"\n}');
  });

  it("returns undefined when the tool has no arguments", () => {
    expect(formatArgs(tool("bash"))).toBeUndefined();
  });
});
