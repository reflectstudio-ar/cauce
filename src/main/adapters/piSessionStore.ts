import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFile, readFile, rm } from "node:fs/promises";
import { promisify } from "node:util";
import type { SessionInfoLike, SessionStore } from "../ports";

const execFileAsync = promisify(execFile);

/**
 * SessionStore backed by pi's own SessionManager.listAll(). The
 * `@earendil-works/pi-coding-agent` import is dynamic to isolate whatever
 * load-time cost/side effects the package graph has from call sites that
 * never list sessions (e.g. plain unit tests of unrelated main-process
 * code, or a future Electron bundle path that only spawns gentle-shell).
 *
 * Deviates from a literal "pass `<home>/sessions` as the session dir"
 * design: `SessionManager.listAll(sessionDir)` treats a passed sessionDir
 * as ONE flat directory of `.jsonl` files, but pi actually stores sessions
 * one subdirectory per project cwd, under
 * `<agentDir>/sessions/--<encoded-cwd>--/*.jsonl` (see
 * getDefaultSessionDirPath in pi's src/core/session-manager.ts) — passing
 * `<home>/sessions` directly would find zero sessions for any real
 * multi-project home. Only the zero-argument overload,
 * `SessionManager.listAll()`, recurses across those per-project
 * subdirectories — but it reads its agent dir from the `PI_CODING_AGENT_DIR`
 * env var (`getAgentDir()` in pi's src/config.ts), not from a parameter.
 * So this adapter sets that env var for the duration of the call instead
 * of passing `home` as an argument, and restores the previous value
 * afterward (a real, accepted M1 limitation: concurrent listAll() calls
 * against two different homes would race on this global; only one
 * SessionStore/home is ever in play in M1).
 */
export function createPiSessionStore(home: string): SessionStore {
  return {
    async listAll(): Promise<SessionInfoLike[]> {
      const { SessionManager } = await import("@earendil-works/pi-coding-agent");

      const previous = process.env.PI_CODING_AGENT_DIR;
      process.env.PI_CODING_AGENT_DIR = home;
      try {
        return await SessionManager.listAll();
      } finally {
        if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
        else process.env.PI_CODING_AGENT_DIR = previous;
      }
    },

    /**
     * pi reads a session's display name from the newest `session_info`
     * entry (see session-format.md), the same entry `/name` appends. Doing
     * it at the file level renames a closed session without spawning a
     * process for it; a live session is renamed over RPC instead.
     */
    async rename(path: string, name: string): Promise<void> {
      const raw = await readFile(path, "utf8");
      const entry = {
        type: "session_info",
        id: randomBytes(4).toString("hex"),
        parentId: lastEntryId(raw),
        timestamp: new Date().toISOString(),
        name,
      };
      await appendFile(path, `${JSON.stringify(entry)}\n`, "utf8");
    },

    async remove(path: string): Promise<void> {
      // pi prefers the OS trash too (docs/sessions.md). `trash` is not
      // installed by default on macOS, so fall back to a permanent delete
      // after the renderer's explicit confirmation.
      try {
        await execFileAsync("trash", [path]);
      } catch {
        await rm(path, { force: true });
      }
    },
  };
}

/** The id of the last entry in a session file, used as the new entry's
 * parent so the tree stays connected. Null when the file has no entries. */
function lastEntryId(raw: string): string | null {
  const lines = raw.split("\n").filter((line) => line.trim().length > 0);
  for (let index = lines.length - 1; index >= 1; index -= 1) {
    try {
      const entry = JSON.parse(lines[index] ?? "") as { id?: unknown };
      if (typeof entry.id === "string") return entry.id;
    } catch {
      // A malformed trailing line should not stop the rename.
    }
  }
  return null;
}

/**
 * A SessionStore that re-resolves the current home directory (via
 * `homeDirFor(configStore.read().home ?? "isolated", ...)`, T5) on every
 * `listAll()` call instead of the fixed home createPiSessionStore closes
 * over. Without this, the sidebar's session list would keep reading the
 * home the app started with even after first-run persists a different
 * choice, until the app was restarted.
 */
export function createDynamicPiSessionStore(resolveCurrentHome: () => string): SessionStore {
  return {
    listAll(): Promise<SessionInfoLike[]> {
      return createPiSessionStore(resolveCurrentHome()).listAll();
    },
    rename(path: string, name: string): Promise<void> {
      return createPiSessionStore(resolveCurrentHome()).rename(path, name);
    },
    remove(path: string): Promise<void> {
      return createPiSessionStore(resolveCurrentHome()).remove(path);
    },
  };
}
