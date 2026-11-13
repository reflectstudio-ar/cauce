import { useState, type FormEvent, type KeyboardEvent } from "react";
import { CHAT_STATE, type ChatSummary } from "@shared/bridge-types";
import { formatRelativeTime, projectName } from "@shared/relativeTime";
import { Pill, PILL_TONE, type PillTone } from "@renderer/shared/ui/atoms/Pill";
import "./ChatListItem.css";

const STATE_PILL_TONE: Record<ChatSummary["state"], PillTone> = {
  [CHAT_STATE.IDLE]: PILL_TONE.NEUTRAL,
  [CHAT_STATE.WORKING]: PILL_TONE.WORKING,
  [CHAT_STATE.NEEDS_YOU]: PILL_TONE.NEEDS_YOU,
};

const STATE_LABEL: Record<ChatSummary["state"], string> = {
  [CHAT_STATE.IDLE]: "idle",
  [CHAT_STATE.WORKING]: "working",
  [CHAT_STATE.NEEDS_YOU]: "needs you",
};

export interface ChatListItemProps {
  readonly chat: ChatSummary;
  readonly selected?: boolean;
  readonly onSelect: (chat: ChatSummary) => void;
  readonly onRename: (chat: ChatSummary, name: string) => void;
  readonly onDelete: (chat: ChatSummary) => void;
  /** Injected for deterministic relative times in tests. */
  readonly now?: Date;
}

// Presentational only — receives props, talks to nothing. ChatsContainer
// (through ChatList) owns the bridge calls and passes ChatSummary values
// down. A <button> (not a clickable <div>) so the list is keyboard- and
// screen-reader-navigable without extra ARIA plumbing. Rename happens
// inline (an input replaces the row) so it never blocks on a modal.
export function ChatListItem({ chat, selected = false, onSelect, onRename, onDelete, now }: ChatListItemProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(chat.title);

  const classes = ["gc-chat-list-item", selected && "gc-chat-list-item--selected"].filter(Boolean).join(" ");
  const project = projectName(chat.cwd);

  const startRename = (): void => {
    setDraft(chat.title);
    setEditing(true);
  };

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const name = draft.trim();
    if (name.length > 0 && name !== chat.title) onRename(chat, name);
    setEditing(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      setEditing(false);
    }
  };

  if (editing) {
    return (
      <li>
        <form className="gc-chat-list-item__rename" onSubmit={submit}>
          <input
            autoFocus
            className="gc-text-field"
            aria-label="Chat name"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button type="submit" className="gc-chat-list-item__action">
            Save
          </button>
          <button type="button" className="gc-chat-list-item__action" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </form>
      </li>
    );
  }

  return (
    <li className="gc-chat-list-item__row">
      <button
        type="button"
        className={classes}
        aria-current={selected || undefined}
        onClick={() => onSelect(chat)}
      >
        <span className="gc-chat-list-item__title">{chat.title}</span>
        <Pill tone={STATE_PILL_TONE[chat.state]}>{STATE_LABEL[chat.state]}</Pill>
        <span className="gc-chat-list-item__meta">
          {project} · {formatRelativeTime(chat.updatedAt, now)}
        </span>
      </button>
      <div className="gc-chat-list-item__actions">
        <button
          type="button"
          className="gc-chat-list-item__action"
          aria-label={`Rename ${chat.title}`}
          title="Rename"
          onClick={startRename}
        >
          ✎
        </button>
        <button
          type="button"
          className="gc-chat-list-item__action"
          aria-label={`Delete ${chat.title}`}
          title="Delete"
          onClick={() => onDelete(chat)}
        >
          ×
        </button>
      </div>
    </li>
  );
}
