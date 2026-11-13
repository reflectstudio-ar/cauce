/**
 * Short, human relative time for the chat list: "just now", "5m ago",
 * "3h ago", "2d ago", and the calendar date once it is a week old. `now` is
 * injectable so tests stay deterministic.
 */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return iso;

  const minutes = Math.floor((now.getTime() - time) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  return iso.slice(0, 10);
}

/** The last segment of a working directory — how the sidebar names a project. */
export function projectName(cwd: string): string {
  const parts = cwd.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? cwd;
}
