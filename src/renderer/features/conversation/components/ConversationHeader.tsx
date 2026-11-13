import type { ContextUsage, ModelInfo } from "@shared/bridge-types";
import { Pill, PILL_TONE } from "@renderer/shared/ui/atoms/Pill";
import "./ConversationHeader.css";

export const CONVERSATION_PANE = {
  CHAT: "chat",
  HELPERS: "helpers",
} as const;

/** Which pane the conversation view is showing — the plain thread/composer, or the D3 Helpers tab. Owned here (not ConversationContainer) because ConversationHeader owns the tab switch UI it names. */
export type ConversationPane = (typeof CONVERSATION_PANE)[keyof typeof CONVERSATION_PANE];

export interface ConversationHeaderProps {
  readonly title: string;
  readonly working: boolean;
  readonly pane: ConversationPane;
  readonly runningHelpersCount: number;
  readonly onSelectPane: (pane: ConversationPane) => void;
  readonly model?: ModelInfo;
  readonly models?: readonly ModelInfo[];
  readonly thinkingLevel?: string;
  readonly thinkingLevels?: readonly string[];
  readonly context?: ContextUsage;
  readonly onSelectModel?: (model: ModelInfo) => void;
  readonly onSelectThinking?: (level: string) => void;
}

// Presentational: the active chat's title, a "Working…" pill while
// ChatState.working is true, the model/thinking/context controls, and a
// pill-style Chat/Helpers tab switch.
export function ConversationHeader({
  title,
  working,
  pane,
  runningHelpersCount,
  onSelectPane,
  model,
  models = [],
  thinkingLevel,
  thinkingLevels = [],
  context,
  onSelectModel,
  onSelectThinking,
}: ConversationHeaderProps) {
  return (
    <header className="gc-conversation-header">
      <h2 className="gc-conversation-header__title">{title}</h2>
      {working && <Pill tone={PILL_TONE.WORKING}>Working…</Pill>}

      <div className="gc-conversation-header__controls">
        {model && models.length > 0 && (
          <select
            className="gc-text-field gc-conversation-header__select"
            aria-label="Model"
            value={`${model.provider}/${model.id}`}
            onChange={(event) => {
              const selected = models.find((candidate) => `${candidate.provider}/${candidate.id}` === event.target.value);
              if (selected) onSelectModel?.(selected);
            }}
          >
            {models.map((candidate) => (
              <option key={`${candidate.provider}/${candidate.id}`} value={`${candidate.provider}/${candidate.id}`}>
                {candidate.name}
              </option>
            ))}
          </select>
        )}

        {thinkingLevel && thinkingLevels.length > 0 && (
          <select
            className="gc-text-field gc-conversation-header__select"
            aria-label="Thinking level"
            value={thinkingLevel}
            onChange={(event) => onSelectThinking?.(event.target.value)}
          >
            {thinkingLevels.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        )}

        {context && context.percent !== null && (
          <span
            className="gc-conversation-header__context"
            title={`${context.tokens ?? "?"} / ${context.contextWindow} tokens`}
          >
            {context.percent}% ctx
          </span>
        )}
      </div>

      <div className="gc-conversation-header__tabs" role="tablist">
        <PaneTab pane={CONVERSATION_PANE.CHAT} active={pane === CONVERSATION_PANE.CHAT} label="Chat" onSelectPane={onSelectPane} />
        <PaneTab
          pane={CONVERSATION_PANE.HELPERS}
          active={pane === CONVERSATION_PANE.HELPERS}
          label={runningHelpersCount > 0 ? `Helpers (${runningHelpersCount} running)` : "Helpers"}
          onSelectPane={onSelectPane}
        />
      </div>
    </header>
  );
}

interface PaneTabProps {
  readonly pane: ConversationPane;
  readonly active: boolean;
  readonly label: string;
  readonly onSelectPane: (pane: ConversationPane) => void;
}

function PaneTab({ pane, active, label, onSelectPane }: PaneTabProps) {
  const classes = ["gc-conversation-header__tab", active && "gc-conversation-header__tab--active"].filter(Boolean).join(" ");

  return (
    <button type="button" role="tab" aria-selected={active} className={classes} onClick={() => onSelectPane(pane)}>
      {label}
    </button>
  );
}
