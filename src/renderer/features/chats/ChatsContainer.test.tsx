// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CHAT_STATE, type ChatSummary, type GentleBridge } from "@shared/bridge-types";
import { ChatsContainer } from "./ChatsContainer";

function makeBridge(overrides: Partial<GentleBridge> = {}): GentleBridge {
  return {
    listChats: vi.fn().mockResolvedValue([]),
    openChat: vi.fn(),
    newChat: vi.fn(),
    renameChat: vi.fn(),
    deleteChat: vi.fn(),
    listModels: vi.fn().mockResolvedValue([]),
    setModel: vi.fn(),
    listThinkingLevels: vi.fn().mockResolvedValue([]),
    setThinkingLevel: vi.fn(),
    refreshStats: vi.fn().mockResolvedValue(undefined),
    refreshSessionInfo: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn(),
    followUp: vi.fn(),
    clearQueue: vi.fn(),
    abort: vi.fn(),
    answerDialog: vi.fn(),
    onState: vi.fn(),
    onError: vi.fn(),
    onMenuNewChat: vi.fn(),
    setupStatus: vi.fn().mockResolvedValue({ needsChoice: false, detection: { found: false, dir: "", hasAuth: false, hasModels: false } }),
    chooseHome: vi.fn(),
    ...overrides,
  };
}

it("shows a message when listChats rejects", async () => {
  window.gentle = makeBridge({ listChats: vi.fn().mockRejectedValue(new Error("bridge not ready")) });
  render(<ChatsContainer onSelectChat={vi.fn()} onNewChat={vi.fn()} />);
  expect(await screen.findByText("Chats are not available: bridge not ready")).toBeInTheDocument();
});

it("calls onNewChat when the New chat button is clicked", async () => {
  window.gentle = makeBridge();
  const onNewChat = vi.fn();

  render(<ChatsContainer onSelectChat={vi.fn()} onNewChat={onNewChat} />);
  screen.getByRole("button", { name: "New chat" }).click();

  expect(onNewChat).toHaveBeenCalled();
});

it("calls onSelectChat with the chat when a list item is clicked", async () => {
  const chat: ChatSummary = {
    id: "chat-1",
    title: "Refactor the store",
    cwd: "/tmp/project",
    updatedAt: "2026-09-21T09:00:00.000Z",
    messageCount: 3,
    state: CHAT_STATE.IDLE,
  };
  window.gentle = makeBridge({ listChats: vi.fn().mockResolvedValue([chat]) });
  const onSelectChat = vi.fn();

  render(<ChatsContainer onSelectChat={onSelectChat} onNewChat={vi.fn()} />);
  (await screen.findByRole("button", { name: /^Refactor the store/ })).click();

  expect(onSelectChat).toHaveBeenCalledWith(chat);
});

const CHAT_ALPHA: ChatSummary = {
  id: "chat-alpha",
  title: "Fix login",
  cwd: "/Users/dev/alpha",
  updatedAt: "2026-11-13T10:00:00.000Z",
  messageCount: 3,
  state: CHAT_STATE.IDLE,
};

const CHAT_BETA: ChatSummary = {
  id: "chat-beta",
  title: "Write docs",
  cwd: "/Users/dev/beta",
  updatedAt: "2026-11-13T11:00:00.000Z",
  messageCount: 1,
  state: CHAT_STATE.IDLE,
};

it("filters the list by search text and by project", async () => {
  window.gentle = makeBridge({ listChats: vi.fn().mockResolvedValue([CHAT_ALPHA, CHAT_BETA]) });
  render(<ChatsContainer onSelectChat={vi.fn()} onNewChat={vi.fn()} />);

  expect(await screen.findByText("Fix login")).toBeInTheDocument();
  expect(screen.getByText("Write docs")).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText("Search chats"), { target: { value: "docs" } });
  expect(screen.queryByText("Fix login")).toBeNull();
  expect(screen.getByText("Write docs")).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText("Search chats"), { target: { value: "" } });
  fireEvent.change(screen.getByLabelText("Filter by project"), { target: { value: "alpha" } });
  expect(screen.getByText("Fix login")).toBeInTheDocument();
  expect(screen.queryByText("Write docs")).toBeNull();
});

it("renames a chat inline through the bridge", async () => {
  const bridge = makeBridge({
    listChats: vi.fn().mockResolvedValue([CHAT_ALPHA]),
    renameChat: vi.fn().mockResolvedValue(undefined),
  });
  window.gentle = bridge;
  render(<ChatsContainer onSelectChat={vi.fn()} onNewChat={vi.fn()} />);

  await screen.findByText("Fix login");
  fireEvent.click(screen.getByRole("button", { name: "Rename Fix login" }));
  fireEvent.change(screen.getByLabelText("Chat name"), { target: { value: "  Login fix  " } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  await vi.waitFor(() => expect(bridge.renameChat).toHaveBeenCalledWith("chat-alpha", "Login fix"));
});

it("deletes a chat after confirmation and reports the id up", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  const onChatDeleted = vi.fn();
  const bridge = makeBridge({
    listChats: vi.fn().mockResolvedValue([CHAT_ALPHA]),
    deleteChat: vi.fn().mockResolvedValue(undefined),
  });
  window.gentle = bridge;
  render(<ChatsContainer onSelectChat={vi.fn()} onNewChat={vi.fn()} onChatDeleted={onChatDeleted} />);

  await screen.findByText("Fix login");
  fireEvent.click(screen.getByRole("button", { name: "Delete Fix login" }));

  await vi.waitFor(() => expect(bridge.deleteChat).toHaveBeenCalledWith("chat-alpha"));
  await vi.waitFor(() => expect(onChatDeleted).toHaveBeenCalledWith("chat-alpha"));
  confirm.mockRestore();
});

it("does not delete a chat when the confirmation is declined", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  const bridge = makeBridge({ listChats: vi.fn().mockResolvedValue([CHAT_ALPHA]) });
  window.gentle = bridge;
  render(<ChatsContainer onSelectChat={vi.fn()} onNewChat={vi.fn()} />);

  await screen.findByText("Fix login");
  fireEvent.click(screen.getByRole("button", { name: "Delete Fix login" }));

  expect(bridge.deleteChat).not.toHaveBeenCalled();
  confirm.mockRestore();
});
