// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Composer, type ComposerProps } from "./Composer";

const ATTACHMENT = {
  id: "a1",
  name: "screenshot.png",
  image: { type: "image" as const, data: "aGVsbG8=", mimeType: "image/png" },
};

function renderComposer(overrides: Partial<ComposerProps> = {}) {
  const props: ComposerProps = {
    value: "",
    working: false,
    attachments: [],
    queued: [],
    onChange: vi.fn(),
    onAttach: vi.fn(),
    onRemoveAttachment: vi.fn(),
    onSend: vi.fn(),
    onFollowUp: vi.fn(),
    onAbort: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<Composer {...props} />) };
}

describe("Composer", () => {
  it("shows the idle placeholder and the key hints", () => {
    renderComposer();

    expect(screen.getByPlaceholderText("Tell Gentle what you need…")).toBeInTheDocument();
    expect(screen.getByText("Enter to send · Shift+Enter for a new line · Esc to stop")).toBeInTheDocument();
  });

  it("calls onSend and does not insert a newline when Enter is pressed without Shift", () => {
    const { props } = renderComposer({ value: "hello" });

    fireEvent.keyDown(screen.getByPlaceholderText("Tell Gentle what you need…"), { key: "Enter" });

    expect(props.onSend).toHaveBeenCalled();
  });

  it("does not call onSend when Shift+Enter is pressed (newline instead)", () => {
    const { props } = renderComposer({ value: "hello" });

    fireEvent.keyDown(screen.getByPlaceholderText("Tell Gentle what you need…"), { key: "Enter", shiftKey: true });

    expect(props.onSend).not.toHaveBeenCalled();
  });

  it("does not call onSend on Enter when the draft is empty and nothing is attached", () => {
    const { props } = renderComposer({ value: "   " });

    fireEvent.keyDown(screen.getByPlaceholderText("Tell Gentle what you need…"), { key: "Enter" });

    expect(props.onSend).not.toHaveBeenCalled();
  });

  it("calls onAbort on Escape only while working", () => {
    const { props, rerender } = renderComposer();

    fireEvent.keyDown(screen.getByPlaceholderText("Tell Gentle what you need…"), { key: "Escape" });
    expect(props.onAbort).not.toHaveBeenCalled();

    rerender(<Composer {...props} working />);
    fireEvent.keyDown(screen.getByPlaceholderText("Steer the agent while it works…"), { key: "Escape" });
    expect(props.onAbort).toHaveBeenCalled();
  });

  it("stays editable while working and turns the primary button into Steer", () => {
    renderComposer({ value: "hi", working: true });

    const textarea = screen.getByPlaceholderText("Steer the agent while it works…");
    expect(textarea).not.toHaveAttribute("readonly");
    expect(screen.getByRole("button", { name: "Steer" })).toBeEnabled();
    expect(screen.getByText("Enter to steer · Follow-up queues after it finishes · Esc to stop")).toBeInTheDocument();
  });

  it("queues a follow-up from the secondary button", () => {
    const { props } = renderComposer({ value: "then summarize", working: true });

    fireEvent.click(screen.getByRole("button", { name: "Follow-up" }));

    expect(props.onFollowUp).toHaveBeenCalled();
  });

  it("disables Send when the draft is empty", () => {
    renderComposer();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("enables Send when only an image is attached", () => {
    renderComposer({ attachments: [ATTACHMENT] });
    expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();
  });

  it("clicking Send calls onSend", () => {
    const { props } = renderComposer({ value: "hi" });

    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(props.onSend).toHaveBeenCalled();
  });

  it("shows attached images with a remove button", () => {
    const { props } = renderComposer({ attachments: [ATTACHMENT] });

    expect(screen.getByAltText("screenshot.png")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove screenshot.png" }));

    expect(props.onRemoveAttachment).toHaveBeenCalledWith("a1");
  });

  it("hands picked files to onAttach and clears the input", () => {
    const { props, container } = renderComposer();
    const input = screen.getByLabelText("Attach images") as HTMLInputElement;
    const file = new File(["x"], "photo.png", { type: "image/png" });

    fireEvent.change(input, { target: { files: [file] } });

    expect(props.onAttach).toHaveBeenCalled();
    expect(input.value).toBe("");
    expect(container.querySelector(".gc-composer__file-input")).not.toBeNull();
  });

  it("lists queued messages while the agent works", () => {
    renderComposer({ working: true, queued: ["also check the tests"] });

    expect(screen.getByLabelText("Queued messages")).toHaveTextContent("also check the tests");
  });
});
