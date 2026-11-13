import type { MessageToolBlock } from "@shared/bridge-types";

/** One line of a rendered diff. */
export interface DiffLine {
  readonly kind: "same" | "add" | "del";
  readonly text: string;
}

/** The tool's arguments as a plain record, when they are an object. */
export function argsRecord(block: MessageToolBlock): Record<string, unknown> | undefined {
  const args = block.args;
  return typeof args === "object" && args !== null && !Array.isArray(args) ? (args as Record<string, unknown>) : undefined;
}

function stringArg(block: MessageToolBlock, keys: readonly string[]): string | undefined {
  const args = argsRecord(block);
  if (!args) return undefined;
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

/**
 * A one-line, human summary of what a tool call is doing: the command for
 * bash, the path for file tools, the pattern for searches. Falls back to
 * the first string argument, then to nothing (just the tool name in the
 * header).
 */
export function toolSummary(block: MessageToolBlock): string | undefined {
  switch (block.name) {
    case "bash":
    case "shell":
      return stringArg(block, ["command", "cmd"]);
    case "read":
    case "write":
    case "edit":
    case "multi_edit":
      return stringArg(block, ["path", "file_path", "filePath"]);
    case "grep":
    case "search":
      return stringArg(block, ["pattern", "query"]);
    case "glob":
    case "find":
      return stringArg(block, ["pattern", "glob"]);
    case "web_search":
    case "web_fetch":
      return stringArg(block, ["query", "url"]);
    default: {
      const args = argsRecord(block);
      if (!args) return undefined;
      const first = Object.values(args).find((value) => typeof value === "string" && value.length > 0);
      return typeof first === "string" ? first : undefined;
    }
  }
}

/**
 * A compact line diff for an edit: trims the common prefix and suffix and
 * renders the changed middle as removed lines then added lines. Enough to
 * read a change at a glance without pulling in a diff library; identical
 * input produces only `same` lines.
 */
export function diffLines(oldText: string, newText: string): DiffLine[] {
  const before = oldText.split("\n");
  const after = newText.split("\n");

  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1;

  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const lines: DiffLine[] = [];
  for (const text of before.slice(0, prefix)) lines.push({ kind: "same", text });
  for (const text of before.slice(prefix, before.length - suffix)) lines.push({ kind: "del", text });
  for (const text of after.slice(prefix, after.length - suffix)) lines.push({ kind: "add", text });
  for (const text of before.slice(before.length - suffix)) lines.push({ kind: "same", text });
  return lines;
}

/** The before/after pair for tools that change a file, when the arguments
 * carry it (edit: oldText/newText; write: content as all-added lines). */
export function fileChangeLines(block: MessageToolBlock): DiffLine[] | undefined {
  const args = argsRecord(block);
  if (!args) return undefined;

  if (block.name === "edit" || block.name === "multi_edit") {
    const oldText = typeof args.oldText === "string" ? args.oldText : typeof args.old_string === "string" ? args.old_string : undefined;
    const newText = typeof args.newText === "string" ? args.newText : typeof args.new_string === "string" ? args.new_string : undefined;
    if (oldText === undefined || newText === undefined) return undefined;
    return diffLines(oldText, newText);
  }

  if (block.name === "write") {
    const content = typeof args.content === "string" ? args.content : undefined;
    if (content === undefined) return undefined;
    return content.split("\n").map((text) => ({ kind: "add" as const, text }));
  }

  return undefined;
}

/** Pretty-printed arguments for the details pane, or undefined when empty. */
export function formatArgs(block: MessageToolBlock): string | undefined {
  if (block.args === undefined) return undefined;
  try {
    return JSON.stringify(block.args, null, 2);
  } catch {
    return String(block.args);
  }
}
