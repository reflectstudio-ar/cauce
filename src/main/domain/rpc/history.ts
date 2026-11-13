import { MESSAGE_ROLE, TOOL_STATUS, type ChatMessage, type MessageBlock, type MessageToolBlock, type ToolStatus } from "@shared/bridge-types";
import type { RpcMessage } from "./types";

/**
 * Converts a `get_messages` response's `data.messages` (pi's `AgentMessage[]`
 * on the wire — `UserMessage | AssistantMessage | ToolResultMessage | ...`,
 * decoded here defensively as `RpcMessage` like the rest of this file) into
 * the `ChatMessage[]` the renderer's thread understands.
 *
 * - `user`: keeps `content` as-is when it is a plain string, or the joined
 *   `text` of its `{ type: "text", text }` content parts when it is an
 *   array (image parts are skipped).
 * - `assistant`: rebuilds its ordered blocks — text, thinking and tool
 *   calls — and attaches each tool call's result from the matching
 *   `toolResult` message. A message that only ever carried text keeps the
 *   `blocks` field undefined (the same shape the live reducer produces).
 * - `toolResult` is consumed into its tool block, never rendered as a
 *   message of its own.
 *
 * ids are `msg-<index>`, assigned by POSITION IN THE RETURNED ARRAY (not
 * the raw index into `messages`, since a skipped entry never occupies a
 * slot) so they stay consistent with chatReducer's own
 * `msg-${state.messages.length}` scheme: seeding a chat's history with N
 * `ChatMessage`s first means the next live message the reducer appends
 * gets `msg-${N}`, continuing the same sequence with no collision or gap.
 */
export function historyToMessages(messages: readonly RpcMessage[]): ChatMessage[] {
  const toolResults = collectToolResults(messages);
  const result: ChatMessage[] = [];

  for (const message of messages) {
    if (message.role === "toolResult") continue;
    const chatMessage = toChatMessage(message, result.length, toolResults);
    if (chatMessage) result.push(chatMessage);
  }
  return result;
}

interface ToolResultInfo {
  readonly output?: string;
  readonly isError: boolean;
}

function collectToolResults(messages: readonly RpcMessage[]): Map<string, ToolResultInfo> {
  const results = new Map<string, ToolResultInfo>();
  for (const message of messages) {
    if (message.role !== "toolResult") continue;
    const callId = typeof message.toolCallId === "string" ? message.toolCallId : undefined;
    if (!callId) continue;
    results.set(callId, { output: extractToolResultText(message), isError: message.isError === true });
  }
  return results;
}

function toChatMessage(
  message: RpcMessage,
  index: number,
  toolResults: ReadonlyMap<string, ToolResultInfo>,
): ChatMessage | undefined {
  if (message.role === MESSAGE_ROLE.USER) {
    return { id: `msg-${index}`, role: MESSAGE_ROLE.USER, text: extractText(message) };
  }
  if (message.role === MESSAGE_ROLE.ASSISTANT) {
    const blocks = blocksFromContent(message.content, toolResults);
    const text = blocks ? joinText(blocks) : extractText(message);

    if (blocks && blocks.some((block) => block.kind !== "text")) {
      return { id: `msg-${index}`, role: MESSAGE_ROLE.ASSISTANT, text, blocks, streaming: false };
    }
    // Nothing but whitespace text: skip it like a toolResult message would
    // be, instead of rendering an empty bubble. `result.length` in
    // historyToMessages still assigns the next id, so this never leaves a gap.
    if (text.trim().length === 0) return undefined;
    return { id: `msg-${index}`, role: MESSAGE_ROLE.ASSISTANT, text, streaming: false };
  }
  return undefined;
}

function blocksFromContent(
  content: unknown,
  toolResults: ReadonlyMap<string, ToolResultInfo>,
): MessageBlock[] | undefined {
  if (!Array.isArray(content) || content.length === 0) return undefined;

  const blocks: MessageBlock[] = [];
  for (const raw of content) {
    const block = toBlock(raw, toolResults);
    if (block) blocks.push(block);
  }
  return blocks.length > 0 ? blocks : undefined;
}

function toBlock(raw: unknown, toolResults: ReadonlyMap<string, ToolResultInfo>): MessageBlock | undefined {
  if (!isRecord(raw)) return undefined;

  if (raw.type === "text" && typeof raw.text === "string") return { kind: "text", text: raw.text };

  if (raw.type === "thinking" && typeof raw.thinking === "string") {
    return raw.redacted === true
      ? { kind: "thinking", text: raw.thinking, redacted: true }
      : { kind: "thinking", text: raw.thinking };
  }

  if (raw.type === "toolCall" && typeof raw.id === "string" && typeof raw.name === "string") {
    const result = toolResults.get(raw.id);
    const status: ToolStatus = result?.isError ? TOOL_STATUS.ERROR : TOOL_STATUS.DONE;
    return {
      kind: "tool",
      callId: raw.id,
      name: raw.name,
      args: raw.arguments,
      status,
      ...(result?.output !== undefined ? { output: result.output } : {}),
      ...(result?.isError !== undefined ? { isError: result.isError } : {}),
    } satisfies MessageToolBlock;
  }

  return undefined;
}

function joinText(blocks: readonly MessageBlock[]): string {
  return blocks
    .filter((block): block is Extract<MessageBlock, { kind: "text" }> => block.kind === "text")
    .map((block) => block.text)
    .join("");
}

/** Plain string content is kept as-is; array content keeps only `text` parts, joined. */
function extractText(message: RpcMessage): string {
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter(isTextBlock).map((block) => block.text).join("");
}

/** A toolResult message's textual content, joined. */
function extractToolResultText(message: RpcMessage): string | undefined {
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  const parts = content.filter(isTextBlock).map((block) => block.text);
  return parts.length > 0 ? parts.join("") : undefined;
}

function isTextBlock(value: unknown): value is { type: "text"; text: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).type === "text" &&
    typeof (value as Record<string, unknown>).text === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Safely pulls `data.messages` off a `get_messages` response's `data`
 * (typed `unknown` in `RpcResponse`). Tolerant like the rest of this
 * codec/domain layer: malformed or missing data decodes to an empty array
 * instead of throwing, and entries without a string `role` are dropped.
 */
export function extractHistoryMessages(data: unknown): readonly RpcMessage[] {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return [];
  const messages = (data as Record<string, unknown>).messages;
  if (!Array.isArray(messages)) return [];
  return messages.filter(isRpcMessage);
}

function isRpcMessage(value: unknown): value is RpcMessage {
  return typeof value === "object" && value !== null && !Array.isArray(value) && typeof (value as Record<string, unknown>).role === "string";
}
