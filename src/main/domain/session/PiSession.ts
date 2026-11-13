import {
  MESSAGE_ROLE,
  type ChatMessage,
  type ChatState,
  type ContextUsage,
  type DialogAnswer,
  type ModelInfo,
  type PromptImage,
  type PromptResult,
  type QueueState,
} from "@shared/bridge-types";
import { INITIAL_CHAT_STATE, reduceChat } from "../rpc/chatReducer";
import { decodeLine, encodeCommand } from "../rpc/codec";
import { extractHistoryMessages, historyToMessages } from "../rpc/history";
import type { RpcCommand, RpcEvent, RpcResponse } from "../rpc/types";
import type { LauncherLocator, ProcessSpawner, SpawnedProcess } from "../../ports";

export interface PiSessionOptions {
  readonly spawner: ProcessSpawner;
  readonly locator: LauncherLocator;
  /** e.g. `["--link"]` or `["--isolated"]`; empty means gentle-shell's own default. */
  readonly homeArgs?: readonly string[];
  readonly sessionPath?: string;
  readonly env: NodeJS.ProcessEnv;
  readonly cwd?: string;
  /**
   * Receives raw child stderr lines (diagnostics, warnings) for logging.
   * Defaults to a no-op. Stderr output is not, by itself, evidence of a
   * failure (see handleStderrLine) so it no longer sets `lastError`.
   */
  readonly onLog?: (line: string) => void;
}

// PromptResult and DialogAnswer now live in @shared/bridge-types (T5, T3: the renderer
// constructs these too, answering a Dialog card through
// GentleBridge.answerDialog).

interface PiSessionEventMap {
  readonly state: ChatState;
  readonly event: RpcEvent;
  readonly error: Error;
}

type Listener<T> = (payload: T) => void;

/** Minimal typed pub/sub — PiSession only needs on/off/emit, not a full EventEmitter. */
class TypedEmitter<Events> {
  private readonly listeners: { [K in keyof Events]?: Array<Listener<Events[K]>> } = {};

  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): void {
    const list = this.listeners[event] ?? [];
    list.push(listener);
    this.listeners[event] = list;
  }

  off<K extends keyof Events>(event: K, listener: Listener<Events[K]>): void {
    const list = this.listeners[event];
    if (!list) return;
    this.listeners[event] = list.filter((registered) => registered !== listener);
  }

  protected emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    for (const listener of this.listeners[event] ?? []) listener(payload);
  }
}

const STOP_GRACE_PERIOD_MS = 3000;

/** How long `clearQueue` waits for its response before resolving empty. */
const CLEAR_QUEUE_TIMEOUT_MS = 1500;

/**
 * Set on every spawned pi process (M2 prerequisite, see
 * odd/tasks/desktop-m2-helpers.md): only with this flag does gentle-pi
 * enable RPC dialogs for ask_user_question/ask_user_choice and publish
 * subagent activity via the gentle-agents setWidget widget. Applied last
 * in start()'s env merge so neither `this.env` nor a launcher's own env
 * (e.g. ELECTRON_RUN_AS_NODE) can accidentally suppress it.
 */
const GENTLE_SHELL_INTERACTIVE_HOST_ENV = { GENTLE_SHELL_INTERACTIVE_HOST: "1" } as const;

/**
 * Owns one `gentle-shell --mode rpc` child process: spawns it through a
 * ProcessSpawner (resolved via a LauncherLocator), decodes its stdout into
 * RpcEvents, folds them into ChatState with the pure reducer, and emits
 * both out. Only depends on ports (ProcessSpawner, LauncherLocator), so it
 * needs no Node import itself and is testable with fakes — see
 * src/README.md's hexagonal main process note.
 *
 * Never throws from a public method: spawn/decode/stream failures surface
 * as `lastError` on the emitted state plus an ("error", Error) event
 * instead, because this runs inside Electron's main process, where an
 * uncaught exception takes down the whole app.
 */
export class PiSession extends TypedEmitter<PiSessionEventMap> {
  private readonly spawner: ProcessSpawner;
  private readonly locator: LauncherLocator;
  private readonly homeArgs: readonly string[];
  private readonly sessionPath: string | undefined;
  private readonly env: NodeJS.ProcessEnv;
  private readonly cwd: string | undefined;
  private readonly onLog: (line: string) => void;

  private state: ChatState = INITIAL_CHAT_STATE;
  private process: SpawnedProcess | undefined;
  private stopping = false;
  private historyRequestCounter = 0;
  /** Set right after a `get_messages` history request is sent (reopening a
   * session with a `sessionPath`); cleared once its matching response
   * arrives. Lets `applyHistoryResponse` correlate the response by `id`
   * and ignore anything else that happens to carry `command: "get_messages"`
   * (a stale or unrelated response). */
  private pendingHistoryRequestId: string | undefined;
  private clearQueueCounter = 0;
  private pendingClearQueue: { id: string; resolve: (queue: QueueState) => void } | undefined;
  private requestCounter = 0;
  private pendingRequests = new Map<string, (response: RpcResponse) => void>();

  constructor(options: PiSessionOptions) {
    super();
    this.spawner = options.spawner;
    this.locator = options.locator;
    this.homeArgs = options.homeArgs ?? [];
    this.sessionPath = options.sessionPath;
    this.env = options.env;
    this.cwd = options.cwd;
    this.onLog = options.onLog ?? (() => undefined);
  }

  /**
   * Resolves the launcher, spawns it with `--mode rpc`, and starts streaming
   * events. Guarded against a double start: while a process is already
   * active, a second call surfaces an error instead of spawning a second
   * child (which would silently orphan the first one's stdin/stdout wiring).
   */
  start(): void {
    if (this.process) {
      this.surfaceError(new Error("PiSession: already started (a session is already active)"));
      return;
    }

    try {
      const launcher = this.locator.locate();
      const args = [
        ...launcher.args,
        ...this.homeArgs,
        "--mode",
        "rpc",
        ...(this.sessionPath ? ["--session", this.sessionPath] : []),
      ];
      const env = { ...this.env, ...(launcher.env ?? {}), ...GENTLE_SHELL_INTERACTIVE_HOST_ENV };
      const proc = this.spawner.spawn(launcher.command, args, env, this.cwd);
      this.process = proc;

      proc.onStdoutLine((line) => this.handleLine(line));
      proc.onStderrLine((line) => this.handleStderrLine(line));
      proc.onError((error) => this.surfaceError(error));
      proc.exited.then(({ code, signal, error }) => this.handleExit(code, signal, error)).catch(() => undefined);

      // Reopening an existing chat (sessionPath set): the child already has
      // this session's prior messages, but the renderer starts with an
      // empty thread until we ask for them. A fresh chat has no history to
      // load, so this is skipped entirely when sessionPath is unset.
      if (this.sessionPath) this.requestHistory();
    } catch (error) {
      this.surfaceError(toError(error));
    }
  }

  /** Sends `get_messages` with a fresh correlation id, tracked in
   * `pendingHistoryRequestId` so the matching response (handled in
   * `applyHistoryResponse`) can be told apart from any other response. */
  private requestHistory(): void {
    const id = `history-${this.historyRequestCounter++}`;
    this.pendingHistoryRequestId = id;
    this.send({ type: "get_messages", id });
  }

  /**
   * Sends a prompt. While the agent is already working the message is
   * queued as steering (pi's `steer` command) instead of being declined:
   * steering is delivered after the current turn's tool calls, before the
   * next model call, which is what a person typing mid-run expects. Images
   * ride along with either command.
   */
  prompt(text: string, images: readonly PromptImage[] = []): PromptResult {
    if (this.state.working) {
      this.send({ type: "steer", message: text, ...(images.length > 0 ? { images } : {}) });
      return { queued: true };
    }

    this.state = appendUserMessage(this.state, text, images);
    this.emit("state", this.state);
    this.send({ type: "prompt", message: text, ...(images.length > 0 ? { images } : {}) });
    return { queued: true };
  }

  /** Queues a message that is delivered only once the agent finishes. */
  followUp(text: string, images: readonly PromptImage[] = []): PromptResult {
    this.send({ type: "follow_up", message: text, ...(images.length > 0 ? { images } : {}) });
    return { queued: true };
  }

  /**
   * Drops queued steering/follow-up messages and resolves with the texts
   * pi had queued, so the composer can put them back in the draft. Bounded
   * by CLEAR_QUEUE_TIMEOUT_MS: a missing response never strands the caller.
   */
  clearQueue(): Promise<QueueState> {
    const empty: QueueState = { steering: [], followUp: [] };
    if (!this.process || this.stopping) return Promise.resolve(empty);

    const id = `clear-${this.clearQueueCounter++}`;
    return new Promise((resolve) => {
      this.pendingClearQueue = { id, resolve };
      this.send({ type: "clear_queue", id });
      setTimeout(() => {
        if (this.pendingClearQueue?.id !== id) return;
        this.pendingClearQueue = undefined;
        resolve(empty);
      }, CLEAR_QUEUE_TIMEOUT_MS);
    });
  }

  async abort(): Promise<void> {
    this.send({ type: "abort" });
  }

  /** Renames the live session through pi, which appends its own
   * `session_info` entry so the new name survives a reload. */
  setSessionName(name: string): void {
    this.send({ type: "set_session_name", name });
  }

  // -------------------------------------------------------------------------
  // Model, thinking level and context usage
  // -------------------------------------------------------------------------

  listModels(): Promise<ModelInfo[]> {
    return this.requestWithFallback(
      { type: "get_available_models" },
      (response) => (response.success ? parseModels(response.data) : []),
      [],
    );
  }

  async setModel(provider: string, modelId: string): Promise<ModelInfo | undefined> {
    const model = await this.requestWithFallback(
      { type: "set_model", provider, modelId },
      (response) => (response.success ? parseModel(asRecord(response.data)) : undefined),
      undefined,
    );
    if (model) {
      this.state = { ...this.state, model };
      this.emit("state", this.state);
    }
    return model;
  }

  listThinkingLevels(): Promise<string[]> {
    return this.requestWithFallback(
      { type: "get_available_thinking_levels" },
      (response) => (response.success ? parseLevels(response.data) : []),
      [],
    );
  }

  async setThinkingLevel(level: string): Promise<void> {
    const applied = await this.requestWithFallback(
      { type: "set_thinking_level", level },
      (response) => (response.success ? level : undefined),
      undefined,
    );
    if (applied) {
      this.state = { ...this.state, thinkingLevel: applied };
      this.emit("state", this.state);
    }
  }

  /** Asks pi for current context usage and folds it into state. */
  refreshStats(): Promise<void> {
    return this.requestWithFallback(
      { type: "get_session_stats" },
      (response) => {
        if (response.success) this.applyContextUsage(response.data);
        return undefined;
      },
      undefined,
    );
  }

  private applyContextUsage(data: unknown): void {
    const usage = asRecord(asRecord(data)?.contextUsage);
    if (!usage || typeof usage.contextWindow !== "number" || usage.contextWindow <= 0) return;

    const context: ContextUsage = {
      tokens: typeof usage.tokens === "number" ? usage.tokens : null,
      contextWindow: usage.contextWindow,
      percent: typeof usage.percent === "number" ? usage.percent : null,
    };
    this.state = { ...this.state, context };
    this.emit("state", this.state);
  }

  /** Reads the session's current model and thinking level. The renderer
   * calls this once a chat is open, so opening never writes on its own. */
  refreshSessionInfo(): Promise<void> {
    return this.requestWithFallback(
      { type: "get_state" },
      (response) => {
        if (response.success) this.applySessionState(response.data);
        return undefined;
      },
      undefined,
    );
  }

  private applySessionState(data: unknown): void {
    const record = asRecord(data);
    if (!record) return;

    const model = parseModel(record.model);
    const thinkingLevel = typeof record.thinkingLevel === "string" ? record.thinkingLevel : undefined;
    this.state = {
      ...this.state,
      ...(model ? { model } : {}),
      ...(thinkingLevel ? { thinkingLevel } : {}),
    };
    this.emit("state", this.state);
  }

  /**
   * Sends a command with a correlation id and resolves with `parse`'s result
   * when the matching response arrives, or with `fallback` after a bound —
   * a missing or slow response never strands a UI control.
   */
  private requestWithFallback<T>(
    command: RpcCommand,
    parse: (response: RpcResponse) => T,
    fallback: T,
    timeoutMs = 4000,
  ): Promise<T> {
    if (!this.process || this.stopping) return Promise.resolve(fallback);

    const id = `req-${this.requestCounter++}`;
    return new Promise<T>((resolve) => {
      let settled = false;
      const finish = (value: T): void => {
        if (settled) return;
        settled = true;
        this.pendingRequests.delete(id);
        resolve(value);
      };

      this.pendingRequests.set(id, (response) => finish(parse(response)));
      this.send({ ...command, id } as RpcCommand);
      setTimeout(() => finish(fallback), timeoutMs);
    });
  }

  /** Answers a pending extension_ui_request dialog and drops it from `pendingDialogs`. */
  answerDialog(id: string, answer: DialogAnswer): void {
    this.state = {
      ...this.state,
      pendingDialogs: this.state.pendingDialogs.filter((dialog) => dialog.id !== id),
    };
    this.emit("state", this.state);

    if ("cancelled" in answer) {
      this.send({ type: "extension_ui_response", id, cancelled: true });
    } else if ("confirmed" in answer) {
      this.send({ type: "extension_ui_response", id, confirmed: answer.confirmed });
    } else {
      this.send({ type: "extension_ui_response", id, value: answer.value });
    }
  }

  getState(): ChatState {
    return this.state;
  }

  /** Graceful shutdown: close stdin, wait up to 3s for exit, then kill. */
  async stop(): Promise<void> {
    const proc = this.process;
    if (!proc) return;

    this.stopping = true;
    proc.endStdin();

    const timedOut = Symbol("stop-timeout");
    const outcome = await Promise.race([
      proc.exited.then(() => "exited" as const),
      new Promise<typeof timedOut>((resolve) => {
        setTimeout(() => resolve(timedOut), STOP_GRACE_PERIOD_MS);
      }),
    ]);

    if (outcome === timedOut) {
      proc.kill();
      await proc.exited.catch(() => undefined);
    }

    this.process = undefined;
  }

  private send(command: RpcCommand): void {
    if (!this.process || this.stopping) {
      this.surfaceError(new Error("PiSession: cannot send a command (no active process)"));
      return;
    }
    this.process.writeStdin(encodeCommand(command));
  }

  private handleLine(line: string): void {
    try {
      const decoded = decodeLine(line);
      if ("kind" in decoded) return; // unknown/unmodeled line: nothing to fold or emit

      if (decoded.type === "response" && decoded.id) {
        const handler = this.pendingRequests.get(decoded.id);
        if (handler) {
          this.pendingRequests.delete(decoded.id);
          handler(decoded);
        }
      }

      // `now` feeds reduceChat's setWidget helpers-retention fallback
      // (endedAt for a task gentle-pi drops after it finishes); PiSession
      // is the impure boundary, reduceChat itself stays pure.
      this.state = reduceChat(this.state, decoded, new Date().toISOString());
      // reduceChat has no case for "response" (its default arm returns
      // state unchanged), so folding the get_messages history response in
      // here, right after, never fights it.
      if (decoded.type === "response") {
        this.state = this.applyHistoryResponse(this.state, decoded);
        // A successful clear leaves both queues empty; the returned texts go
        // to the caller's promise, not back into state.
        if (this.applyClearQueueResponse(decoded)) {
          this.state = { ...this.state, queue: { steering: [], followUp: [] } };
        }
      }
      // Fresh context usage once a run is truly settled.
      if (decoded.type === "agent_settled") void this.refreshStats();
      this.emit("event", decoded);
      this.emit("state", this.state);
    } catch (error) {
      this.surfaceError(toError(error));
    }
  }

  /**
   * Folds the `get_messages` history response into `state.messages`, once:
   * a response for any other command, or one whose `id` does not match
   * `pendingHistoryRequestId` (stale or unrelated), is ignored outright.
   * Never throws: a failed response surfaces as `lastError` instead of an
   * empty thread with no explanation.
   */
  private applyHistoryResponse(state: ChatState, response: RpcResponse): ChatState {
    if (response.command !== "get_messages" || response.id !== this.pendingHistoryRequestId) return state;
    this.pendingHistoryRequestId = undefined;

    if (!response.success) {
      return { ...state, lastError: "Could not load this chat's history" };
    }
    // Never clobber messages a live prompt already appended while the
    // history request was still in flight.
    if (state.messages.length > 0) return state;

    return { ...state, messages: historyToMessages(extractHistoryMessages(response.data)) };
  }

  /**
   * Resolves a pending `clearQueue` promise when its response arrives and
   * returns the queue to store (empty after a successful clear). A response
   * with any other command, a mismatched id, or no outstanding request is
   * ignored.
   */
  private applyClearQueueResponse(response: RpcResponse): QueueState | undefined {
    const pending = this.pendingClearQueue;
    if (!pending || response.command !== "clear_queue" || response.id !== pending.id) return undefined;

    this.pendingClearQueue = undefined;
    const queue = response.success ? parseQueueState(response.data) : { steering: [], followUp: [] };
    pending.resolve(queue);
    return queue;
  }

  /**
   * Child stderr is diagnostics/warnings, not by itself evidence of a
   * failure (pi logs there routinely) — route it to the injectable logger
   * instead of surfacing it as `lastError`, which previously made routine
   * stderr output look like a fatal error to the UI.
   */
  private handleStderrLine(line: string): void {
    if (line.trim().length === 0) return;
    this.onLog(line);
  }

  /**
   * Clears `this.process` unconditionally so the next `send()` never
   * writes to a dead child's stdin (R4-001), whether the exit was clean,
   * a crash, or a spawn failure. ANY exit not requested via `stop()` —
   * including a clean `code === 0` self-exit — resets `working` and drops
   * any pending dialogs: the child that would have resolved them is gone
   * either way, so a stale "working" pill or an unanswerable dialog card
   * would otherwise strand the UI regardless of how the child exited. An
   * error is only surfaced for a non-zero exit: a spawn failure already
   * surfaced its real error via `onError` (not re-reported here), and a
   * clean self-exit is not, by itself, evidence of a failure.
   */
  private handleExit(code: number | null, signal: NodeJS.Signals | null, spawnError?: Error): void {
    this.process = undefined;
    if (this.stopping) return;

    this.state = { ...this.state, working: false, pendingDialogs: [] };

    if (spawnError) {
      this.emit("state", this.state);
      return;
    }
    if (code !== 0) {
      this.surfaceError(new Error(`gentle-shell exited unexpectedly (code ${code ?? "null"}${signal ? `, signal ${signal}` : ""})`));
      return;
    }
    this.emit("state", this.state);
  }

  private surfaceError(error: Error): void {
    this.state = { ...this.state, lastError: error.message };
    this.emit("error", error);
    this.emit("state", this.state);
  }
}

function appendUserMessage(state: ChatState, text: string, images: readonly PromptImage[] = []): ChatState {
  const message: ChatMessage = {
    id: `msg-${state.messages.length}`,
    role: MESSAGE_ROLE.USER,
    text,
    ...(images.length > 0 ? { images } : {}),
  };
  return { ...state, messages: [...state.messages, message] };
}

/** Reads a `clear_queue` response's `{steering, followUp}` data defensively. */
function parseQueueState(data: unknown): QueueState {
  const value = typeof data === "object" && data !== null && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  return { steering: toStringArray(value.steering), followUp: toStringArray(value.followUp) };
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Reads pi's model object conservatively: only the fields the header uses. */
function parseModel(value: unknown): ModelInfo | undefined {
  const record = asRecord(value);
  if (!record) return undefined;

  const id = asString(record.id);
  const name = asString(record.name);
  const provider = asString(record.provider);
  if (!id || !name || !provider) return undefined;

  const contextWindow = typeof record.contextWindow === "number" ? record.contextWindow : undefined;
  return { id, name, provider, ...(contextWindow ? { contextWindow } : {}) };
}

function parseModels(data: unknown): ModelInfo[] {
  const models = asRecord(data)?.models;
  if (!Array.isArray(models)) return [];
  return models.map(parseModel).filter((model): model is ModelInfo => model !== undefined);
}

function parseLevels(data: unknown): string[] {
  const levels = asRecord(data)?.levels;
  return Array.isArray(levels) ? levels.filter((level): level is string => typeof level === "string") : [];
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
