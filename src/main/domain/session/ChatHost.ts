import type {
  ChatState,
  ChatSummary,
  DialogAnswer,
  ModelInfo,
  PromptImage,
  PromptResult,
  QueueState,
} from "@shared/bridge-types";
import { boundedStop } from "../lifecycle/boundedStop";
import type { RpcEvent } from "../rpc/types";
import type { HomeSettings, LauncherLocator, ProcessSpawner, SessionStore } from "../../ports";
import { PiSession } from "./PiSession";
import { toChatSummaries } from "./sessionList";

const NO_HOME_SETTINGS: HomeSettings = { homeArgs: () => [] };

/**
 * Bounds how long `openChat` waits for pi's `get_messages` history response
 * (PiSession.start() sends it automatically for a sessionPath-backed
 * session) before returning anyway, so a slow or missing response never
 * blocks the renderer from opening the chat — see `waitForHistoryResponse`
 * below. Later pushes (the response itself, if it arrives late, or any
 * live event) keep flowing through the normal `onState` subscription
 * either way.
 */
const HISTORY_LOAD_TIMEOUT_MS = 2000;

/**
 * Resolves once `session` reports its `get_messages` history response
 * (success or failure) on its `event` stream. Reused with `boundedStop`
 * (src/main/domain/lifecycle/boundedStop.ts) instead of a bespoke timer,
 * so `performStart` only waits for a session actually started with a
 * sessionPath — `newChat` never sends `get_messages` in the first place,
 * so there is nothing to wait for there.
 */
function waitForHistoryResponse(session: PiSession): Promise<void> {
  return new Promise((resolve) => {
    const onEvent = (event: RpcEvent): void => {
      if (event.type !== "response" || event.command !== "get_messages") return;
      session.off("event", onEvent);
      resolve();
    };
    session.on("event", onEvent);
  });
}

export interface ChatHostDeps {
  readonly spawner: ProcessSpawner;
  readonly locator: LauncherLocator;
  readonly sessionStore: SessionStore;
  readonly env: NodeJS.ProcessEnv;
  /** Resolves the launcher home flags (e.g. `["--link"]`) fresh on every
   * spawned session, from the persisted home choice (T5) instead of a
   * fixed constant, so a choice made mid-session takes effect on the very
   * next open/new. Defaults to no flags when omitted (e.g. plain unit
   * tests that don't care about home). */
  readonly homeSettings?: HomeSettings;
  /** Receives raw child stderr lines from every spawned PiSession, forwarded
   * unchanged from PiSessionOptions.onLog (T5 host follow-up). Defaults to
   * a no-op. */
  readonly log?: (line: string) => void;
}

type StateListener = (state: ChatState) => void;
type ErrorListener = (message: string) => void;

/**
 * Owns the one PiSession the desktop window can have open at a time (M1
 * scope: no multi-chat tabs). openChat/newChat stop whatever session is
 * currently running before starting the next one, so exactly one
 * `gentle-shell --mode rpc` child is ever alive — this is the IPC layer's
 * single point of contact with PiSession, mirroring the shape of
 * GentleBridge so registerHandlers.ts (src/main/ipc/) is a thin pass-through.
 */
export class ChatHost {
  private readonly deps: ChatHostDeps;
  private current: PiSession | undefined;
  private currentPath: string | undefined;
  private readonly stateListeners = new Set<StateListener>();
  private readonly errorListeners = new Set<ErrorListener>();
  /** Serializes startSession calls: a second open/new call queues behind
   * whatever the previous one is still doing (stopping the old session,
   * starting the new one) instead of racing it. Without this, two
   * overlapping calls can both observe `this.current` as unset and both
   * spawn a live child, leaking the first one — see ChatHost.test.ts's
   * "startSession serializes overlapping open/new calls" test. */
  private startChain: Promise<void> = Promise.resolve();

  constructor(deps: ChatHostDeps) {
    this.deps = deps;
  }

  onState(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  onError(listener: ErrorListener): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  async listChats(): Promise<ChatSummary[]> {
    const sessions = await this.deps.sessionStore.listAll();
    return toChatSummaries(sessions);
  }

  /** Reopens an existing chat: looks up its session file path from the
   * store (ChatSummary.id is pi's session id, not a file path) and passes
   * it to PiSession as `sessionPath` (`--session <path>`). */
  async openChat(id: string): Promise<ChatState> {
    const sessions = await this.deps.sessionStore.listAll();
    const match = sessions.find((session) => session.id === id);
    if (!match) throw new Error(`ChatHost: no session found for id "${id}"`);
    return this.startSession(match.path);
  }

  /** Starts a fresh chat: no sessionPath, so PiSession omits `--session`. */
  async newChat(): Promise<ChatState> {
    return this.startSession(undefined);
  }

  /** Sends a prompt; while the agent is working, PiSession queues it as
   * steering instead of declining it. */
  async sendMessage(text: string, images: readonly PromptImage[] = []): Promise<PromptResult> {
    return this.requireCurrent().prompt(text, images);
  }

  async followUp(text: string, images: readonly PromptImage[] = []): Promise<PromptResult> {
    return this.requireCurrent().followUp(text, images);
  }

  async clearQueue(): Promise<QueueState> {
    return this.requireCurrent().clearQueue();
  }

  async listModels(): Promise<ModelInfo[]> {
    return this.requireCurrent().listModels();
  }

  async setModel(provider: string, modelId: string): Promise<ModelInfo | undefined> {
    return this.requireCurrent().setModel(provider, modelId);
  }

  async listThinkingLevels(): Promise<string[]> {
    return this.requireCurrent().listThinkingLevels();
  }

  async setThinkingLevel(level: string): Promise<void> {
    return this.requireCurrent().setThinkingLevel(level);
  }

  async refreshStats(): Promise<void> {
    return this.requireCurrent().refreshStats();
  }

  async refreshSessionInfo(): Promise<void> {
    return this.requireCurrent().refreshSessionInfo();
  }

  /** Renames a chat. The open one goes through pi (so the live session
   * updates immediately); a closed one gets a `session_info` entry appended
   * to its file, exactly what `/name` writes. */
  async renameChat(id: string, name: string): Promise<void> {
    const trimmed = name.trim();
    if (trimmed.length === 0) throw new Error("ChatHost: a chat name cannot be empty");

    const session = await this.findSession(id);
    if (session.path === this.currentPath) {
      this.requireCurrent().setSessionName(trimmed);
      return;
    }
    await this.deps.sessionStore.rename(session.path, trimmed);
  }

  /** Deletes a chat, stopping it first when it is the open one. */
  async deleteChat(id: string): Promise<void> {
    const session = await this.findSession(id);

    if (session.path === this.currentPath) {
      await this.current?.stop();
      this.current = undefined;
      this.currentPath = undefined;
    }

    await this.deps.sessionStore.remove(session.path);
  }

  async abort(): Promise<void> {
    this.requireCurrent().abort();
  }

  async answerDialog(id: string, answer: DialogAnswer): Promise<void> {
    this.requireCurrent().answerDialog(id, answer);
  }

  /** Stops the current session, if any. Called on app quit. Joins
   * `startChain` first (T6 follow-up): quitting right as a queued
   * open/new is still in flight would otherwise act on whatever
   * `current` happens to be at that exact synchronous instant — possibly
   * still unset, or the previous session — leaving the queued session's
   * eventual child unstopped and outliving the app. */
  async stop(): Promise<void> {
    await this.startChain;
    await this.current?.stop();
    this.currentPath = undefined;
  }

  private async findSession(id: string) {
    const sessions = await this.deps.sessionStore.listAll();
    const match = sessions.find((session) => session.id === id);
    if (!match) throw new Error(`ChatHost: no session found for id "${id}"`);
    return match;
  }

  /** Queues this start behind the previous one via `startChain` (see its
   * doc comment) instead of running `performStart` directly. */
  private async startSession(sessionPath: string | undefined): Promise<ChatState> {
    const run = this.startChain.then(() => this.performStart(sessionPath));
    // Keep the chain alive regardless of this step's outcome, so one
    // failed start (e.g. a locator error) never permanently wedges every
    // later open/new call behind a rejected promise.
    this.startChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async performStart(sessionPath: string | undefined): Promise<ChatState> {
    await this.current?.stop();

    const session = new PiSession({
      spawner: this.deps.spawner,
      locator: this.deps.locator,
      homeArgs: (this.deps.homeSettings ?? NO_HOME_SETTINGS).homeArgs(),
      sessionPath,
      env: this.deps.env,
      onLog: this.deps.log,
    });
    session.on("state", (state) => this.emitState(state));
    session.on("error", (error) => this.emitError(error.message));

    this.current = session;
    this.currentPath = sessionPath;

    if (sessionPath) {
      // Attach the listener before start() so it can never miss a response
      // that (in principle) arrived before this line runs.
      const historyLoaded = waitForHistoryResponse(session);
      session.start();
      await boundedStop(() => historyLoaded, HISTORY_LOAD_TIMEOUT_MS);
    } else {
      // newChat: PiSession never sends get_messages without a sessionPath,
      // so there is nothing to wait for.
      session.start();
    }

    return session.getState();
  }

  private requireCurrent(): PiSession {
    if (!this.current) throw new Error("ChatHost: no chat is open (call openChat or newChat first)");
    return this.current;
  }

  private emitState(state: ChatState): void {
    for (const listener of this.stateListeners) listener(state);
  }

  private emitError(message: string): void {
    for (const listener of this.errorListeners) listener(message);
  }
}
