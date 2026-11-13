import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChatSummary } from "@shared/bridge-types";
import { projectName } from "@shared/relativeTime";
import { useBridge } from "@renderer/shared/bridge/useBridge";
import { Button } from "@renderer/shared/ui/atoms/Button";
import { ChatList } from "./components/ChatList";
import "./ChatsContainer.css";

export interface ChatsContainerProps {
  /** Notifies the parent (App) that a sidebar chat was picked; App owns the currentChat state. */
  readonly onSelectChat: (chat: ChatSummary) => void;
  /** Notifies the parent that "New chat" was clicked. */
  readonly onNewChat: () => void;
  /** Notifies the parent that a chat was deleted, so an open one can be replaced. */
  readonly onChatDeleted?: (id: string) => void;
  /** The currently open chat's id, for highlighting; undefined while a fresh chat is open. */
  readonly selectedChatId?: string;
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Sidebar container: owns the bridge list and the search/project filters,
 * and hands plain ChatSummary props to the presentational ChatList
 * (container/presentational split). Rename and delete go through the
 * bridge and reload the list; deleting the open chat is reported up so App
 * can fall back to a new chat.
 */
export function ChatsContainer({ onSelectChat, onNewChat, onChatDeleted, selectedChatId }: ChatsContainerProps) {
  const bridge = useBridge();
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [project, setProject] = useState("all");

  const load = useCallback(
    (cancelled?: () => boolean) =>
      bridge
        .listChats()
        .then((loaded) => {
          if (!cancelled?.()) setChats(loaded);
        })
        .catch((cause: unknown) => {
          if (!cancelled?.()) setError(errorText(cause));
        }),
    [bridge],
  );

  useEffect(() => {
    let isCancelled = false;
    void load(() => isCancelled);
    return () => {
      isCancelled = true;
    };
  }, [load]);

  const projects = useMemo(
    () => Array.from(new Set(chats.map((chat) => projectName(chat.cwd)))).sort((a, b) => a.localeCompare(b)),
    [chats],
  );

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return chats.filter((chat) => {
      const projectMatches = project === "all" || projectName(chat.cwd) === project;
      const textMatches =
        needle.length === 0 ||
        chat.title.toLowerCase().includes(needle) ||
        projectName(chat.cwd).toLowerCase().includes(needle);
      return projectMatches && textMatches;
    });
  }, [chats, project, query]);

  const handleRename = (chat: ChatSummary, name: string): void => {
    setError(null);
    void bridge
      .renameChat(chat.id, name)
      .then(() => load())
      .catch((cause: unknown) => setError(errorText(cause)));
  };

  const handleDelete = (chat: ChatSummary): void => {
    if (!window.confirm(`Delete "${chat.title}"? This cannot be undone.`)) return;
    setError(null);
    void bridge
      .deleteChat(chat.id)
      .then(() => {
        onChatDeleted?.(chat.id);
        return load();
      })
      .catch((cause: unknown) => setError(errorText(cause)));
  };

  return (
    <aside className="gc-chats">
      <div className="gc-chats__header">
        <h2 className="gc-chats__heading">Chats</h2>
        <Button variant="ghost" type="button" onClick={onNewChat}>
          New chat
        </Button>
      </div>

      <div className="gc-chats__filters">
        <input
          type="search"
          className="gc-text-field"
          aria-label="Search chats"
          placeholder="Search chats"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select
          className="gc-text-field"
          aria-label="Filter by project"
          value={project}
          onChange={(event) => setProject(event.target.value)}
        >
          <option value="all">All projects</option>
          {projects.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="gc-chats__error">Chats are not available: {error}</p>}
      <ChatList chats={visible} selectedId={selectedChatId} onSelect={onSelectChat} onRename={handleRename} onDelete={handleDelete} />
      {visible.length === 0 && chats.length > 0 && <p className="gc-chats__empty">No chats match.</p>}
    </aside>
  );
}
