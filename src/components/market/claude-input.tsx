"use client";

/** The Claude-style chat composer (Task 21-a, redesigned in 22-b to match
 *  the reference look much more closely).
 *
 *  An original implementation of the Claude / 21st.dev chat-input pattern:
 *  ONE big softly-rounded canvas (28px radius) that carries the focus state
 *  itself (terracotta ring), an auto-growing textarea on top, and a bottom
 *  toolbar with a round "+" context button (popover supplied by the caller),
 *  the context chips (tools / thinking toggle / model), a keyboard hint —
 *  and the signature element: a filled circular send button that morphs
 *  into a stop button while the agent streams.
 *
 *  Keyboard: Enter sends, Shift+Enter breaks the line; the textarea
 *  auto-grows up to `maxRows` lines then scrolls inside. */

import { useEffect, useImperativeHandle, useRef, type ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ArrowUp, Plus, Square } from "lucide-react";

export type ClaudeInputHandle = {
  focus: () => void;
};

export function ClaudeInput({
  value,
  onChange,
  onSubmit,
  onStop,
  busy,
  disabled = false,
  placeholder,
  ariaLabel,
  hint,
  maxLength = 4000,
  maxRows = 7,
  toolbar,
  plusMenu,
  plusLabel,
  handleRef,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onStop?: () => void;
  busy: boolean;
  disabled?: boolean;
  placeholder: string;
  ariaLabel: string;
  hint?: string;
  maxLength?: number;
  maxRows?: number;
  /** chips rendered inside the composer's bottom bar (tools, thinking, model…) */
  toolbar?: ReactNode;
  /** popover content for the round "+" context button (omit to hide it) */
  plusMenu?: ReactNode;
  plusLabel?: string;
  handleRef?: { current: ClaudeInputHandle | null };
}) {
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  // auto-grow: reset then clamp to content, capped at maxRows lines
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const lineHeight = 24; // text-[15px] leading-relaxed ≈ 1.625rem/24px
    const max = lineHeight * maxRows;
    ta.style.height = `${Math.min(ta.scrollHeight, max)}px`;
    ta.style.overflowY = ta.scrollHeight > max ? "auto" : "hidden";
  }, [value, maxRows]);

  useImperativeHandle(handleRef, () => ({ focus: () => taRef.current?.focus() }), []);

  const canSend = !busy && !disabled && value.trim().length > 0;
  const nearLimit = value.length > maxLength * 0.85;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canSend) onSubmit();
      }}
    >
      <div
        className={`claude-canvas rounded-[28px] border shadow-sm transition-all duration-200 ${
          busy || disabled ? "opacity-95" : "focus-within:shadow-md"
        }`}
        style={{
          backgroundColor: "var(--chat-bg)",
          borderColor: "var(--chat-border)",
        }}
      >
        {/* the writing area */}
        <textarea
          ref={taRef}
          value={value}
          onChange={(e) => onChange(e.target.value.slice(0, maxLength))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (canSend) onSubmit();
            }
          }}
          placeholder={placeholder}
          aria-label={ariaLabel}
          disabled={disabled}
          maxLength={maxLength}
          rows={1}
          dir="auto"
          className="thin-scroll w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
          style={{ color: "var(--chat-ink)" }}
        />

        {/* composer bottom bar: + context button · chips · hint · send/stop */}
        <div className="flex items-center gap-1.5 px-3 pb-3 pt-1.5 flex-wrap">
          {plusMenu && (
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label={plusLabel ?? "context"}
                  title={plusLabel ?? ""}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors hover:opacity-80"
                  style={{ backgroundColor: "var(--chat-accent-soft)", color: "var(--chat-accent)" }}
                >
                  <Plus className="h-4 w-4" aria-hidden />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-64 p-3 space-y-1.5">
                {plusMenu}
              </PopoverContent>
            </Popover>
          )}

          {toolbar}

          {hint && (
            <span className="num ms-auto hidden select-none text-[10px] sm:inline" style={{ color: "var(--chat-muted)" }}>
              {hint}
            </span>
          )}
          {nearLimit && (
            <span className="num select-none text-[10px]" style={{ color: "var(--chat-muted)" }}>
              {value.length}/{maxLength}
            </span>
          )}

          {/* the signature element: filled circular send → stop while streaming */}
          {busy ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="stop"
              title="stop"
              className="ms-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-transform active:scale-95"
              style={{ backgroundColor: "var(--chat-accent)", color: "var(--chat-send-fg)" }}
            >
              <Square className="h-3 w-3 fill-current" aria-hidden />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!canSend}
              aria-label="send"
              title="send"
              className={`ms-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-all ${
                canSend ? "hover:opacity-90 active:scale-95" : "cursor-not-allowed opacity-40"
              }`}
              style={{
                backgroundColor: "var(--chat-send)",
                color: "var(--chat-send-fg)",
              }}
            >
              <ArrowUp className="h-4.5 w-4.5" aria-hidden />
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
