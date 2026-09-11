"use client";

/** Claude-style chat composer for the AI agent (Task 21-a).
 *
 *  An original implementation inspired by the Claude / 21st.dev chat-input
 *  pattern: ONE soft rounded card that contains the auto-growing textarea
 *  and a bottom toolbar (context chips + keyboard hint + a circular send
 *  button that becomes a stop button while the agent is streaming). The
 *  card itself carries the focus state — a calm ring + border shift — so
 *  typing feels like writing into the page, not into a form field.
 *
 *  Keyboard: Enter sends, Shift+Enter breaks the line (desktop feel); the
 *  textarea auto-grows to at most `maxRows` lines then scrolls inside. */

import { useEffect, useImperativeHandle, useRef, type ReactNode } from "react";
import { ArrowUp, Square } from "lucide-react";

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
  /** chips rendered inside the composer's bottom bar (tools, model…) */
  toolbar?: ReactNode;
  handleRef?: { current: ClaudeInputHandle | null };
}) {
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  // auto-grow: reset then clamp to content, capped at maxRows lines
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const lineHeight = 22; // text-sm leading-relaxed ≈ 1.625rem/22px
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
        className={`rounded-2xl border bg-card shadow-sm transition-all duration-200 ${
          busy || disabled ? "opacity-95" : "focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20 focus-within:shadow-md"
        }`}
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
          className="thin-scroll w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-sm leading-relaxed outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
        />

        {/* composer bottom bar: context chips + hint + send/stop */}
        <div className="flex items-center gap-1.5 px-2.5 pb-2.5 pt-1.5 flex-wrap">
          {toolbar}

          {hint && (
            <span className="num ms-auto hidden select-none text-[10px] text-muted-foreground sm:inline">
              {hint}
            </span>
          )}
          {nearLimit && (
            <span className="num select-none text-[10px] text-muted-foreground">
              {value.length}/{maxLength}
            </span>
          )}

          {/* circular send → square stop while streaming */}
          {busy ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="stop"
              title="stop"
              className="ms-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-foreground transition-colors hover:bg-secondary/70"
            >
              <Square className="h-3 w-3 fill-current" aria-hidden />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!canSend}
              aria-label="send"
              title="send"
              className={`ms-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all ${
                canSend
                  ? "bg-primary text-primary-foreground shadow-sm hover:opacity-90 active:scale-95"
                  : "bg-secondary text-muted-foreground cursor-not-allowed"
              }`}
            >
              <ArrowUp className="h-4 w-4" aria-hidden />
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
