import { MESSAGE_ROLE, type ChatMessage, type MessageBlock } from "@shared/bridge-types";
import { Markdown } from "@renderer/shared/markdown/Markdown";
import { ToolCallCard } from "./ToolCallCard";
import "./MessageBubble.css";

export interface MessageBubbleProps {
  readonly message: ChatMessage;
}

// Presentational only. Assistant replies render through <Markdown>
// (sanitized HTML — see renderMarkdown.ts) since a model naturally replies
// in Markdown; user messages stay literal plain text so nothing the human
// typed is ever reinterpreted as markup.
//
// An assistant message with `blocks` renders them in order: text as
// Markdown, thinking folded behind a disclosure, and each tool call as a
// card. Text-only messages keep the simple Markdown path.
export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === MESSAGE_ROLE.USER;
  const rich = message.blocks !== undefined && message.blocks.length > 0;

  return (
    <div className={`gc-message gc-message--${isUser ? "user" : "assistant"}${rich ? " gc-message--rich" : ""}`}>
      {message.images && message.images.length > 0 && (
        <div className="gc-message__images">
          {message.images.map((image, index) => (
            <img
              key={`${index}-${image.mimeType}`}
              src={`data:${image.mimeType};base64,${image.data}`}
              alt={`Attachment ${index + 1}`}
            />
          ))}
        </div>
      )}
      {isUser ? (
        <p className="gc-message__text">{message.text}</p>
      ) : rich ? (
        <div className="gc-message__blocks">
          {message.blocks?.map((block, index) => (
            <MessageBlockView key={`${block.kind}-${index}`} block={block} />
          ))}
        </div>
      ) : (
        <Markdown text={message.text} />
      )}
    </div>
  );
}

function MessageBlockView({ block }: { readonly block: MessageBlock }) {
  if (block.kind === "thinking") {
    if (block.text.trim().length === 0) return null;
    return (
      <details className="gc-thinking">
        <summary className="gc-thinking__summary">Thinking</summary>
        <p className="gc-thinking__text">{block.text}</p>
      </details>
    );
  }

  if (block.kind === "tool") return <ToolCallCard block={block} />;

  if (block.text.trim().length === 0) return null;
  return <Markdown text={block.text} />;
}
