import {
  HELPER_STATUS,
  MESSAGE_ROLE,
  TOOL_STATUS,
  type ChatMessage,
  type ChatState,
  type Dialog,
  type HelperTask,
  type HelpersActivity,
  type MessageBlock,
  type MessageToolBlock,
} from "@shared/bridge-types";
import { emptyHelpersActivity, parseHelpersActivity } from "./helpersActivity";
import type { AssistantMessageEvent, FireAndForgetMethod, RpcEvent, RpcExtensionUIRequest, RpcMessage } from "./types";

/** The fire-and-forget branch of RpcExtensionUIRequest (notify, setStatus, setWidget, setTitle, set_editor_text). */
type FireAndForgetUIRequest = Extract<RpcExtensionUIRequest, { readonly method: FireAndForgetMethod }>;

// ChatState itself now lives in @shared/bridge-types (T3: the renderer
// receives it directly through GentleBridge.onState/openChat/newChat).
// Re-exported here so existing call sites in this main-process domain
// (PiSession.ts, PiSession.test.ts) can keep importing it from the
// reducer without churn.
export type { ChatState };

export const INITIAL_CHAT_STATE: ChatState = {
  messages: [],
  working: false,
  pendingDialogs: [],
  activity: 0,
  helpers: emptyHelpersActivity(),
};

/** The one widgetKey gentle-agents publishes its per-chat helpers activity under (`gentle-agents.activity/v1`). */
const HELPERS_WIDGET_KEY = "gentle-agents";

const ACTIVITY_DELTA_TYPES: ReadonlySet<AssistantMessageEvent["type"]> = new Set([
  "thinking_start",
  "thinking_delta",
  "thinking_end",
  "toolcall_start",
  "toolcall_delta",
  "toolcall_end",
]);

/**
 * Folds one decoded RPC event into chat state. Pure: same inputs, same
 * output, no I/O, no id generation from Date.now()/crypto (message ids are
 * derived from `state.messages.length`, which is unique per open call
 * because each open appends exactly one message). The optional `now` is the
 * one exception: the caller (PiSession) supplies the wall-clock time as an
 * ISO string for the `setWidget` helpers-retention fallback below instead
 * of this file reading the clock itself.
 */
export function reduceChat(state: ChatState, event: RpcEvent, now?: string): ChatState {
  switch (event.type) {
    case "agent_start":
      return { ...state, working: true };
    case "agent_end":
    case "agent_settled":
      return { ...state, working: false };
    case "message_start":
      return openAssistantMessage(state, event.message);
    case "message_update":
      return applyAssistantMessageEvent(state, event.assistantMessageEvent);
    case "message_end":
      return closeAssistantMessage(state, event.message);
    case "queue_update":
      return {
        ...state,
        queue: { steering: [...event.steering], followUp: [...event.followUp] },
      };
    case "thinking_level_changed":
      return { ...state, thinkingLevel: event.level };
    case "tool_execution_start":
    case "tool_execution_update":
    case "tool_execution_end":
      return applyToolExecution(state, event);
    case "extension_ui_request":
      return applyExtensionUIRequest(state, event, now);
    case "extension_error":
      return { ...state, lastError: event.error };
    // turn_start/turn_end and command-response envelopes carry nothing the
    // chat view needs; agent_start/agent_end/agent_settled already drive
    // `working`, and the assistant text is driven by message_*/text_* deltas.
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Assistant messages and their content blocks
// ---------------------------------------------------------------------------

/**
 * A message's blocks. Messages that only ever carried text leave `blocks`
 * undefined and keep that text in `text` (the M1 shape); as soon as a
 * thinking or tool-call part appears, the message switches to an ordered
 * blocks array and `text` becomes the joined text blocks.
 */
function blocksOf(message: ChatMessage): MessageBlock[] {
  if (message.blocks) return [...message.blocks];
  return message.text.length > 0 ? [{ kind: "text", text: message.text }] : [];
}

function setBlockAt(blocks: readonly MessageBlock[], index: number, block: MessageBlock): MessageBlock[] {
  const next = blocks.slice();
  // Gaps should not happen (contentIndex follows pi's content array), but
  // pad defensively so an unexpected index never produces a sparse array.
  while (next.length < index) next.push({ kind: "text", text: "" });
  next[index] = block;
  return next;
}

function joinText(blocks: readonly MessageBlock[]): string {
  return blocks
    .filter((block): block is Extract<MessageBlock, { kind: "text" }> => block.kind === "text")
    .map((block) => block.text)
    .join("");
}

function hasRichBlocks(blocks: readonly MessageBlock[] | undefined): boolean {
  return blocks?.some((block) => block.kind !== "text") ?? false;
}

function lastAssistantIndex(state: ChatState): number {
  const index = state.messages.length - 1;
  const message = state.messages[index];
  return message && message.role === MESSAGE_ROLE.ASSISTANT ? index : -1;
}

function updateLastAssistant(state: ChatState, update: (message: ChatMessage) => ChatMessage): ChatState {
  const index = lastAssistantIndex(state);
  if (index < 0) return state;
  const message = state.messages[index] as ChatMessage;
  return { ...state, messages: replaceAt(state.messages, index, update(message)) };
}

function openAssistantMessage(state: ChatState, message: RpcMessage): ChatState {
  if (message.role !== "assistant") return state;

  const chatMessage: ChatMessage = {
    id: `msg-${state.messages.length}`,
    role: MESSAGE_ROLE.ASSISTANT,
    text: "",
    streaming: true,
  };
  return { ...state, messages: [...state.messages, chatMessage] };
}

function applyAssistantMessageEvent(state: ChatState, delta: AssistantMessageEvent): ChatState {
  const next = applyAssistantBlockEvent(state, delta);
  // Thinking and tool-call activity keeps the counter moving even when the
  // user is looking at a header/status affordance rather than the thread.
  return ACTIVITY_DELTA_TYPES.has(delta.type) ? { ...next, activity: next.activity + 1 } : next;
}

function applyAssistantBlockEvent(state: ChatState, delta: AssistantMessageEvent): ChatState {
  switch (delta.type) {
    case "text_delta":
      return appendTextDelta(state, delta.contentIndex, delta.delta);
    case "text_end":
      return writeTextBlock(state, delta.contentIndex, delta.content);
    case "thinking_start":
      return writeThinkingBlock(state, delta.contentIndex, "");
    case "thinking_delta":
      return appendThinkingDelta(state, delta.contentIndex, delta.delta);
    case "thinking_end":
      return writeThinkingBlock(state, delta.contentIndex, delta.content);
    case "toolcall_start":
      return startToolCall(state, delta.contentIndex, delta.id, delta.toolName);
    case "toolcall_end":
      return finishToolCall(state, delta.contentIndex, delta.toolCall);
    default:
      // text_start opens a block that the first text_delta already creates;
      // toolcall_delta streams serialized arguments we replace wholesale at
      // toolcall_end (the authoritative ToolCall).
      return state;
  }
}

function appendTextDelta(state: ChatState, contentIndex: number, delta: string): ChatState {
  return updateLastAssistant(state, (message) => {
    if (!message.blocks) return { ...message, text: message.text + delta };

    const blocks = message.blocks.slice();
    const existing = blocks[contentIndex];
    blocks[contentIndex] =
      existing?.kind === "text" ? { kind: "text", text: existing.text + delta } : { kind: "text", text: delta };
    return { ...message, blocks, text: joinText(blocks) };
  });
}

function writeTextBlock(state: ChatState, contentIndex: number, content: string): ChatState {
  return updateLastAssistant(state, (message) => {
    if (!message.blocks) return { ...message, text: content };

    const blocks = setBlockAt(message.blocks, contentIndex, { kind: "text", text: content });
    return { ...message, blocks, text: joinText(blocks) };
  });
}

function writeThinkingBlock(state: ChatState, contentIndex: number, text: string): ChatState {
  return updateLastAssistant(state, (message) => {
    const blocks = setBlockAt(blocksOf(message), contentIndex, { kind: "thinking", text });
    return { ...message, blocks, text: joinText(blocks) };
  });
}

function appendThinkingDelta(state: ChatState, contentIndex: number, delta: string): ChatState {
  return updateLastAssistant(state, (message) => {
    const blocks = blocksOf(message);
    const existing = blocks[contentIndex];
    blocks[contentIndex] =
      existing?.kind === "thinking" ? { kind: "thinking", text: existing.text + delta } : { kind: "thinking", text: delta };
    return { ...message, blocks, text: joinText(blocks) };
  });
}

function startToolCall(state: ChatState, contentIndex: number, callId: string, name: string): ChatState {
  return updateLastAssistant(state, (message) => {
    const blocks = setBlockAt(blocksOf(message), contentIndex, {
      kind: "tool",
      callId,
      name,
      status: TOOL_STATUS.RUNNING,
    });
    return { ...message, blocks, text: joinText(blocks) };
  });
}

function finishToolCall(state: ChatState, contentIndex: number, rawToolCall: unknown): ChatState {
  const toolCall = asRecord(rawToolCall);
  if (!toolCall) return state;

  const callId = asString(toolCall.id);
  const name = asString(toolCall.name);
  const args = toolCall.arguments;

  return updateLastAssistant(state, (message) => {
    const blocks = blocksOf(message);
    const atIndex = blocks[contentIndex];
    const target = atIndex?.kind === "tool" && (!callId || atIndex.callId === callId) ? contentIndex : findToolBlock(blocks, callId);
    if (target < 0 && !callId) return message;

    const base: MessageToolBlock =
      target >= 0 && blocks[target]?.kind === "tool"
        ? (blocks[target] as MessageToolBlock)
        : { kind: "tool", callId: callId ?? "", name: name ?? "tool", status: TOOL_STATUS.RUNNING };
    const updated: MessageToolBlock = {
      ...base,
      callId: callId ?? base.callId,
      name: name ?? base.name,
      ...(args !== undefined ? { args } : {}),
    };
    const nextBlocks = setBlockAt(blocks, target >= 0 ? target : contentIndex, updated);
    return { ...message, blocks: nextBlocks, text: joinText(nextBlocks) };
  });
}

function applyToolExecution(
  state: ChatState,
  event: Extract<RpcEvent, { readonly type: "tool_execution_start" | "tool_execution_update" | "tool_execution_end" }>,
): ChatState {
  const withActivity = { ...state, activity: state.activity + 1 };

  for (let index = state.messages.length - 1; index >= 0; index -= 1) {
    const message = state.messages[index] as ChatMessage;
    if (message.role !== MESSAGE_ROLE.ASSISTANT || !message.blocks) continue;

    const blockIndex = findToolBlock(message.blocks, event.toolCallId);
    if (blockIndex < 0) continue;

    const block = message.blocks[blockIndex] as MessageToolBlock;
    const updated = applyToolEventToBlock(block, event);
    const blocks = setBlockAt(message.blocks, blockIndex, updated);
    return { ...withActivity, messages: replaceAt(state.messages, index, { ...message, blocks }) };
  }

  // A tool can run without an open assistant message carrying its call (an
  // extension-initiated tool, or an event reordered ahead of message_end):
  // the activity counter still moves, nothing else to attach it to.
  return withActivity;
}

function applyToolEventToBlock(
  block: MessageToolBlock,
  event: Extract<RpcEvent, { readonly type: "tool_execution_start" | "tool_execution_update" | "tool_execution_end" }>,
): MessageToolBlock {
  if (event.type === "tool_execution_start") {
    return { ...block, status: TOOL_STATUS.RUNNING, ...(block.args !== undefined || event.args === undefined ? {} : { args: event.args }) };
  }
  if (event.type === "tool_execution_update") {
    const output = textFromToolResult(event.partialResult);
    return output === undefined ? block : { ...block, output };
  }
  const output = textFromToolResult(event.result);
  return {
    ...block,
    status: event.isError ? TOOL_STATUS.ERROR : TOOL_STATUS.DONE,
    isError: event.isError,
    ...(output !== undefined && output !== block.output ? { output } : {}),
    ...(event.durationMs !== undefined ? { durationMs: event.durationMs } : {}),
  };
}

function findToolBlock(blocks: readonly MessageBlock[], callId: string | undefined): number {
  if (!callId) return -1;
  return blocks.findIndex((block) => block.kind === "tool" && block.callId === callId);
}

function closeAssistantMessage(state: ChatState, message: RpcMessage): ChatState {
  if (message.role !== "assistant") return state;

  const index = lastAssistantIndex(state);
  if (index < 0) return state;
  const last = state.messages[index] as ChatMessage;

  // message_end.message is authoritative per rpc.md; resync from its
  // content blocks when present, otherwise keep what the deltas accumulated.
  const authoritative = blocksFromContent(message.content);
  const blocks = authoritative ? mergeToolRuntime(authoritative, last.blocks) : last.blocks;
  const text = blocks ? joinText(blocks) : last.text;

  // A message with nothing but whitespace text finalizes as an empty grey
  // bubble: drop it instead of showing it. Rich blocks (thinking or a tool
  // call) are worth showing even with no text at all — a tool-only turn is
  // exactly what Fase 1 exists to surface.
  if (!hasRichBlocks(blocks)) {
    if (text.trim().length === 0) {
      return { ...state, messages: removeLast(state.messages) };
    }
    return { ...state, messages: replaceAt(state.messages, index, { ...last, blocks: undefined, text, streaming: false }) };
  }

  return { ...state, messages: replaceAt(state.messages, index, { ...last, blocks, text, streaming: false }) };
}

/** Carries each tool block's runtime state (output, status, duration, args)
 * over from the streamed blocks into the authoritative ones, which only
 * know the call itself. */
function mergeToolRuntime(authoritative: readonly MessageBlock[], previous: readonly MessageBlock[] | undefined): MessageBlock[] {
  if (!previous) return [...authoritative];

  return authoritative.map((block) => {
    if (block.kind !== "tool") return block;
    const prior = previous.find(
      (candidate): candidate is MessageToolBlock => candidate.kind === "tool" && candidate.callId === block.callId,
    );
    if (!prior) return block;
    return {
      ...block,
      ...(block.args !== undefined || prior.args === undefined ? {} : { args: prior.args }),
      ...(prior.output !== undefined ? { output: prior.output } : {}),
      ...(prior.status === TOOL_STATUS.RUNNING ? {} : { status: prior.status }),
      ...(prior.isError !== undefined ? { isError: prior.isError } : {}),
      ...(prior.durationMs !== undefined ? { durationMs: prior.durationMs } : {}),
    };
  });
}

function blocksFromContent(content: unknown): MessageBlock[] | undefined {
  if (!Array.isArray(content) || content.length === 0) return undefined;

  const blocks: MessageBlock[] = [];
  for (const raw of content) {
    const block = toBlock(raw);
    if (block) blocks.push(block);
  }
  return blocks.length > 0 ? blocks : undefined;
}

function toBlock(raw: unknown): MessageBlock | undefined {
  const value = asRecord(raw);
  if (!value) return undefined;

  if (value.type === "text" && typeof value.text === "string") return { kind: "text", text: value.text };
  if (value.type === "thinking" && typeof value.thinking === "string") {
    return value.redacted === true
      ? { kind: "thinking", text: value.thinking, redacted: true }
      : { kind: "thinking", text: value.thinking };
  }
  if (value.type === "toolCall" && typeof value.id === "string" && typeof value.name === "string") {
    return { kind: "tool", callId: value.id, name: value.name, args: value.arguments, status: TOOL_STATUS.RUNNING };
  }
  return undefined;
}

/** pi tool results carry `content: [{type:"text", text}]`; a plain string is
 * tolerated too. Returns undefined when there is nothing textual. */
function textFromToolResult(result: unknown): string | undefined {
  if (typeof result === "string") return result;
  const value = asRecord(result);
  if (!value) return undefined;

  const content = value.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;

  const parts: string[] = [];
  for (const rawPart of content) {
    const part = asRecord(rawPart);
    if (part && part.type === "text" && typeof part.text === "string") parts.push(part.text);
  }
  return parts.length > 0 ? parts.join("") : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function applyExtensionUIRequest(state: ChatState, event: RpcExtensionUIRequest, now: string | undefined): ChatState {
  switch (event.method) {
    case "select":
      return pushDialog(state, { id: event.id, method: "select", title: event.title, options: event.options });
    case "confirm":
      return pushDialog(state, { id: event.id, method: "confirm", title: event.title, message: event.message });
    case "input":
      return pushDialog(state, {
        id: event.id,
        method: "input",
        title: event.title,
        placeholder: event.placeholder,
      });
    case "editor":
      return pushDialog(state, { id: event.id, method: "editor", title: event.title, prefill: event.prefill });
    case "setWidget":
      return applySetWidget(state, event, now);
    default:
      // Other fire-and-forget methods: notify, setStatus, setTitle, set_editor_text.
      return state;
  }
}

/**
 * `setWidget` is fire-and-forget on the wire like the other widget/status
 * methods, but the one gentle-agents publishes under `widgetKey:
 * "gentle-agents"` carries this chat's per-chat helpers activity (M2), so
 * it folds into `helpers` instead of being dropped. Any other widgetKey
 * (a different extension's own widget) is still ignored — never a global
 * list, per the M2 objective (the parent-child relation stays direct).
 */
function applySetWidget(state: ChatState, event: FireAndForgetUIRequest, now: string | undefined): ChatState {
  if (event.widgetKey !== HELPERS_WIDGET_KEY) return state;

  const widgetLines = Array.isArray(event.widgetLines) ? toStringArray(event.widgetLines) : undefined;
  const parsed = parseHelpersActivity(widgetLines);
  // undefined means "malformed frame": keep the previous helpers state
  // rather than clobbering it with nothing (see helpersActivity.ts).
  if (!parsed) return state;

  const helpers: HelpersActivity = { summary: parsed.summary, tasks: mergeHelperTasks(state.helpers.tasks, parsed.tasks, now) };
  return { ...state, helpers };
}

/**
 * gentle-pi keeps a task's record in its in-memory store only while it is
 * running; once it finishes the record moves to disk and the next
 * `gentle-agents.activity/v1` frame simply omits it (`summary.finished`
 * still counts it, but `tasks` no longer carries it). Without this merge
 * the Helpers tab would show the finished count going up while the task
 * itself vanishes from the list.
 *
 * - A task present in `nextTasks` always replaces its previous record
 *   outright (the frame is authoritative for anything it still reports).
 * - A task from `previousTasks` missing from `nextTasks` is retained with
 *   its last known record: `running`/`waiting`/`queued` is promoted to
 *   `done` with `endedAt` filled from `now` (only if it didn't already have
 *   one), and `failed`/`cancelled`/`done` is kept exactly as it was — a
 *   terminal status is never re-derived.
 */
function mergeHelperTasks(previousTasks: readonly HelperTask[], nextTasks: readonly HelperTask[], now: string | undefined): HelperTask[] {
  const nextIds = new Set(nextTasks.map((task) => task.id));
  const retained = previousTasks.filter((task) => !nextIds.has(task.id)).map((task) => retainDroppedTask(task, now));
  return orderHelperTasks([...nextTasks, ...retained]);
}

const NON_TERMINAL_HELPER_STATUSES: ReadonlySet<HelperTask["status"]> = new Set([
  HELPER_STATUS.RUNNING,
  HELPER_STATUS.WAITING,
  HELPER_STATUS.QUEUED,
]);

function retainDroppedTask(task: HelperTask, now: string | undefined): HelperTask {
  if (!NON_TERMINAL_HELPER_STATUSES.has(task.status)) return task;
  return { ...task, status: HELPER_STATUS.DONE, endedAt: task.endedAt ?? now };
}

/** running, then waiting, then queued, then finished (done/failed/cancelled) sorted by `endedAt` desc. */
function orderHelperTasks(tasks: readonly HelperTask[]): HelperTask[] {
  const running: HelperTask[] = [];
  const waiting: HelperTask[] = [];
  const queued: HelperTask[] = [];
  const finished: HelperTask[] = [];

  for (const task of tasks) {
    switch (task.status) {
      case HELPER_STATUS.RUNNING:
        running.push(task);
        break;
      case HELPER_STATUS.WAITING:
        waiting.push(task);
        break;
      case HELPER_STATUS.QUEUED:
        queued.push(task);
        break;
      default:
        finished.push(task);
    }
  }

  finished.sort(compareEndedAtDesc);
  return [...running, ...waiting, ...queued, ...finished];
}

function compareEndedAtDesc(a: HelperTask, b: HelperTask): number {
  const aEnded = a.endedAt ?? "";
  const bEnded = b.endedAt ?? "";
  if (aEnded === bEnded) return 0;
  return aEnded > bEnded ? -1 : 1;
}

function toStringArray(value: readonly unknown[]): readonly string[] {
  return value.filter((item): item is string => typeof item === "string");
}

function pushDialog(state: ChatState, dialog: Dialog): ChatState {
  return { ...state, pendingDialogs: [...state.pendingDialogs, dialog] };
}

function replaceAt<T>(items: readonly T[], index: number, value: T): T[] {
  const copy = items.slice();
  copy[index] = value;
  return copy;
}

function removeLast<T>(items: readonly T[]): T[] {
  return items.slice(0, -1);
}
