import { useCallback, useEffect, useState } from "react";
import type { ChatSummary } from "@shared/bridge-types";
import { useBridge } from "@renderer/shared/bridge/useBridge";
import { ChatsContainer } from "@renderer/features/chats/ChatsContainer";
import { ConversationContainer, type ActiveChat } from "@renderer/features/conversation/ConversationContainer";
import { FirstRunContainer } from "@renderer/features/first-run/FirstRunContainer";
import "./App.css";

const NEW_CHAT: ActiveChat = { kind: "new" };

const SCREEN = {
  LOADING: "loading",
  FIRST_RUN: "first-run",
  CHAT: "chat",
} as const;

type Screen = (typeof SCREEN)[keyof typeof SCREEN];

// App shell: composes feature-level containers only (Scope Rule — layout
// wiring lives here, feature internals stay inside their own folder).
// Holds the small `activeChat` selection as local state (no global store
// for M1, see odd/tasks/desktop-m1-chat-core.md's "Selected chat" note) —
// both ChatsContainer (highlighting) and ConversationContainer (which chat
// to open) need it.
//
// Decides between the first-run screen and the normal chat layout from
// bridge.setupStatus() on mount (T5): a brief `loading` screen while that
// resolves, then `first-run` when needsChoice is true, else the chat
// shell directly. FirstRunContainer's onDone flips straight to `chat`
// locally instead of re-querying setupStatus() — it already knows the
// choice it just persisted.
export function App() {
  const bridge = useBridge();
  const [screen, setScreen] = useState<Screen>(SCREEN.LOADING);
  const [activeChat, setActiveChat] = useState<ActiveChat>(NEW_CHAT);

  useEffect(() => {
    let cancelled = false;
    bridge
      .setupStatus()
      .then((status) => {
        if (!cancelled) setScreen(status.needsChoice ? SCREEN.FIRST_RUN : SCREEN.CHAT);
      })
      .catch(() => {
        // Fail open: a broken setup-status check should never block the
        // whole app from starting.
        if (!cancelled) setScreen(SCREEN.CHAT);
      });
    return () => {
      cancelled = true;
    };
  }, [bridge]);

  const handleSelectChat = (chat: ChatSummary): void => {
    setActiveChat({ kind: "existing", chat });
  };

  const handleNewChat = useCallback((): void => {
    // A FRESH object on every click, never the shared NEW_CHAT constant:
    // React bails out of a setState whose value is reference-equal to the
    // current one, so clicking "New chat" while the default new chat was
    // open never re-rendered, and ConversationContainer's effect (the only
    // caller of bridge.newChat()) never ran. Upstream issue #31.
    setActiveChat({ kind: "new" });
  }, []);

  // Cmd/Ctrl+N from the native menu lands here instead of adding another
  // click path: it reuses the exact same handler the sidebar button uses.
  useEffect(() => bridge.onMenuNewChat(handleNewChat), [bridge, handleNewChat]);

  if (screen === SCREEN.LOADING) return <div className="gc-app-loading" />;
  if (screen === SCREEN.FIRST_RUN) return <FirstRunContainer onDone={() => setScreen(SCREEN.CHAT)} />;

  return (
    <div className="gc-app">
      <ChatsContainer
        onSelectChat={handleSelectChat}
        onNewChat={handleNewChat}
        onChatDeleted={(id) => {
          if (activeChat.kind === "existing" && activeChat.chat.id === id) setActiveChat({ kind: "new" });
        }}
        selectedChatId={activeChat.kind === "existing" ? activeChat.chat.id : undefined}
      />
      <ConversationContainer activeChat={activeChat} />
    </div>
  );
}
