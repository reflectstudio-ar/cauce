/**
 * IPC channel names shared between src/main/ipc/registerHandlers.ts and
 * src/preload/bridge.ts. Lives under src/shared/, not src/main/ipc/,
 * because both processes need it — the same Scope Rule that put
 * bridge-types.ts here instead of duplicating it locally (see
 * src/README.md).
 */
export const IPC_CHANNELS = {
  LIST_CHATS: "sessions.list",
  OPEN_CHAT: "chat.open",
  NEW_CHAT: "chat.new",
  RENAME_CHAT: "chat.rename",
  DELETE_CHAT: "chat.delete",
  SEND_MESSAGE: "chat.send",
  FOLLOW_UP: "chat.followUp",
  CLEAR_QUEUE: "chat.clearQueue",
  MODELS_LIST: "models.list",
  MODEL_SET: "models.set",
  THINKING_LEVELS: "thinking.levels",
  THINKING_SET: "thinking.set",
  STATS_REFRESH: "stats.refresh",
  SESSION_INFO_REFRESH: "session.info",
  ABORT: "chat.abort",
  ANSWER_DIALOG: "dialog.answer",
  /** webContents.send push: the current chat's ChatState changed. */
  STATE_PUSH: "chat.state",
  /** webContents.send push: an error was surfaced for the current chat. */
  ERROR_PUSH: "chat.error",
  /** First-run status (T5): whether to show the home-choice screen. */
  SETUP_STATUS: "setup.status",
  /** Persists the chosen home mode (T5). */
  CHOOSE_HOME: "setup.chooseHome",
  /** webContents.send push: the native menu's "New Chat" was chosen. */
  MENU_NEW_CHAT: "menu.newChat",
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];
