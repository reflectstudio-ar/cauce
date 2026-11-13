import { useRef, type ChangeEvent, type FormEvent, type KeyboardEvent } from "react";
import { Button } from "@renderer/shared/ui/atoms/Button";
import { TextField } from "@renderer/shared/ui/atoms/TextField";
import type { Attachment } from "../attachments";
import "./Composer.css";

export interface ComposerProps {
  readonly value: string;
  readonly working: boolean;
  readonly attachments: readonly Attachment[];
  /** Steering/follow-up texts the agent has accepted but not consumed. */
  readonly queued: readonly string[];
  readonly notice?: string;
  readonly onChange: (value: string) => void;
  readonly onAttach: (files: FileList | null) => void;
  readonly onRemoveAttachment: (id: string) => void;
  readonly onSend: () => void;
  readonly onFollowUp: () => void;
  readonly onAbort: () => void;
}

/**
 * Presentational: draft text, attachments and the bridge calls all live in
 * ConversationContainer.
 *
 * While the agent is idle, Enter sends. While it is working, Enter queues
 * the message as steering (delivered after the current turn's tool calls)
 * and the secondary button queues it as a follow-up (delivered only when
 * the agent finishes). The field stays editable in both states: a steer
 * mid-run is exactly the case this composer exists for.
 */
export function Composer({
  value,
  working,
  attachments,
  queued,
  notice,
  onChange,
  onAttach,
  onRemoveAttachment,
  onSend,
  onFollowUp,
  onAbort,
}: ComposerProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const canSend = (value.trim().length > 0 || attachments.length > 0) && !working;

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    onChange(event.target.value);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === "Escape") {
      if (working) onAbort();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (working) onSend();
      else if (canSend) onSend();
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (working || canSend) onSend();
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>): void => {
    onAttach(event.target.files);
    event.target.value = "";
  };

  return (
    <form className="gc-composer" onSubmit={handleSubmit}>
      {queued.length > 0 && (
        <ul className="gc-composer__queue" aria-label="Queued messages">
          {queued.map((text, index) => (
            <li key={`${index}-${text}`} className="gc-composer__queue-item">
              <span className="gc-composer__queue-label">Queued</span>
              {text}
            </li>
          ))}
        </ul>
      )}

      {attachments.length > 0 && (
        <div className="gc-composer__attachments">
          {attachments.map((attachment) => (
            <figure key={attachment.id} className="gc-composer__attachment">
              <img
                src={`data:${attachment.image.mimeType};base64,${attachment.image.data}`}
                alt={attachment.name}
              />
              <button
                type="button"
                className="gc-composer__attachment-remove"
                aria-label={`Remove ${attachment.name}`}
                onClick={() => onRemoveAttachment(attachment.id)}
              >
                ×
              </button>
            </figure>
          ))}
        </div>
      )}

      {notice && <p className="gc-composer__notice">{notice}</p>}

      <div className="gc-composer__row">
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          className="gc-composer__file-input"
          aria-label="Attach images"
          onChange={handleFileChange}
        />
        <Button type="button" variant="ghost" onClick={() => fileInput.current?.click()}>
          Attach
        </Button>
        <TextField
          multiline
          rows={2}
          placeholder={working ? "Steer the agent while it works…" : "Tell Gentle what you need…"}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
        />
        <Button type="submit" disabled={!working && !canSend}>
          {working ? "Steer" : "Send"}
        </Button>
        {working && (
          <Button type="button" variant="ghost" onClick={onFollowUp} disabled={value.trim().length === 0}>
            Follow-up
          </Button>
        )}
      </div>
      <p className="gc-composer__hints">
        {working
          ? "Enter to steer · Follow-up queues after it finishes · Esc to stop"
          : "Enter to send · Shift+Enter for a new line · Esc to stop"}
      </p>
    </form>
  );
}
