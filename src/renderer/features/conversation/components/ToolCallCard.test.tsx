// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TOOL_STATUS, type MessageToolBlock } from "@shared/bridge-types";
import { ToolCallCard } from "./ToolCallCard";

function block(overrides: Partial<MessageToolBlock> = {}): MessageToolBlock {
  return {
    kind: "tool",
    callId: "call_1",
    name: "bash",
    args: { command: "git status --short" },
    status: TOOL_STATUS.DONE,
    output: " M src/App.tsx",
    ...overrides,
  };
}

describe("ToolCallCard", () => {
  it("shows the tool name, its target and the outcome in one collapsed row", () => {
    const { container } = render(<ToolCallCard block={block()} />);

    expect(screen.getByText("bash")).toBeInTheDocument();
    expect(screen.getByText("git status --short")).toBeInTheDocument();
    expect(screen.getByText(/Done/)).toBeInTheDocument();
    // Collapsed: the output is not rendered yet.
    expect(container.querySelector(".gc-tool__pre")).toBeNull();
  });

  it("expands to show the tool output", () => {
    const { container } = render(<ToolCallCard block={block()} />);

    fireEvent.click(screen.getByRole("button"));

    expect(container.querySelector(".gc-tool__pre--output")?.textContent).toContain(" M src/App.tsx");
  });

  it("renders an edit as a compact diff instead of raw arguments", () => {
    const edit = block({
      name: "edit",
      args: { path: "a.ts", oldText: "const a = 1;", newText: "const a = 2;" },
      output: "Updated a.ts",
    });
    const { container } = render(<ToolCallCard block={edit} />);

    fireEvent.click(screen.getByRole("button"));

    const added = container.querySelector(".gc-tool__diff-line--add");
    const removed = container.querySelector(".gc-tool__diff-line--del");
    expect(removed?.textContent).toContain("const a = 1;");
    expect(added?.textContent).toContain("const a = 2;");
  });

  it("marks a failed call and shows the error output", () => {
    const failed = block({ status: TOOL_STATUS.ERROR, isError: true, output: "command not found" });
    const { container } = render(<ToolCallCard block={failed} />);

    expect(container.querySelector(".gc-tool--error")).not.toBeNull();
    fireEvent.click(screen.getByRole("button"));
    expect(container.querySelector(".gc-tool__pre--output")?.textContent).toContain("command not found");
  });

  it("opens automatically while the call is still running", () => {
    const { container } = render(<ToolCallCard block={block({ status: TOOL_STATUS.RUNNING, output: undefined })} />);

    expect(container.querySelector(".gc-tool__running")).not.toBeNull();
  });
});
