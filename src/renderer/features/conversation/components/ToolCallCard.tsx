import { useState } from "react";
import { TOOL_STATUS, type MessageToolBlock } from "@shared/bridge-types";
import { fileChangeLines, formatArgs, toolSummary } from "./toolDisplay";
import "./ToolCallCard.css";

export interface ToolCallCardProps {
  readonly block: MessageToolBlock;
  /** Streams open while running; historical cards start collapsed. */
  readonly defaultOpen?: boolean;
}

const STATUS_LABEL: Record<MessageToolBlock["status"], string> = {
  [TOOL_STATUS.RUNNING]: "Running…",
  [TOOL_STATUS.DONE]: "Done",
  [TOOL_STATUS.ERROR]: "Failed",
};

/**
 * One tool call in the thread: a single-line header (name, target, status)
 * that expands into arguments, a compact diff for file edits, and the
 * tool's output. Collapsed by default so a long agent run stays readable;
 * the card is the difference between "the agent did something" and "the
 * agent did exactly this".
 */
export function ToolCallCard({ block, defaultOpen = false }: ToolCallCardProps) {
  const [open, setOpen] = useState(defaultOpen || block.status === TOOL_STATUS.RUNNING);
  const summary = toolSummary(block);
  const change = fileChangeLines(block);
  const args = formatArgs(block);

  return (
    <div className={`gc-tool gc-tool--${block.status}`} data-testid="gc-tool-call">
      <button
        type="button"
        className="gc-tool__header"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="gc-tool__dot" aria-hidden="true" />
        <span className="gc-tool__name">{block.name}</span>
        {summary && <span className="gc-tool__summary">{summary}</span>}
        <span className="gc-tool__status">
          {STATUS_LABEL[block.status]}
          {block.durationMs !== undefined && block.status !== TOOL_STATUS.RUNNING && (
            <span className="gc-tool__duration"> · {formatDuration(block.durationMs)}</span>
          )}
        </span>
        <span className={`gc-tool__chevron${open ? " gc-tool__chevron--open" : ""}`} aria-hidden="true">
          ⌄
        </span>
      </button>

      {open && (
        <div className="gc-tool__body">
          {change ? (
            <pre className="gc-tool__diff">
              {change.map((line, index) => (
                <span key={`${line.kind}-${index}`} className={`gc-tool__diff-line gc-tool__diff-line--${line.kind}`}>
                  {line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "} {line.text}
                  {"\n"}
                </span>
              ))}
            </pre>
          ) : (
            args && (
              <div className="gc-tool__section">
                <p className="gc-tool__label">Arguments</p>
                <pre className="gc-tool__pre">{args}</pre>
              </div>
            )
          )}

          {block.output !== undefined && block.output.length > 0 && (
            <div className="gc-tool__section">
              <p className="gc-tool__label">Output</p>
              <pre className="gc-tool__pre gc-tool__pre--output">{block.output}</pre>
            </div>
          )}

          {block.status === TOOL_STATUS.RUNNING && <p className="gc-tool__running">Waiting for the result…</p>}
        </div>
      )}
    </div>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}
