"use client";

/** Rich markdown renderer for the AI agent's answers (Task 21-a).
 *
 *  The agent is instructed (see its system prompt) to write Claude-style
 *  structured answers — a bold bottom line first, ### section headers,
 *  markdown TABLES for comparisons and level lists, bullets for parallel
 *  facts. This renderer gives that markdown a real analyst-report look:
 *  bordered zebra tables with tabular numerals, header accent bars, quoted
 *  call-outs and code chips — rendered LIVE while the answer streams. */

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

function fixUrl(u: string): string {
  return /^https?:\/\//i.test(u) ? u : `https://${u}`;
}

export const AgentMarkdown = memo(function AgentMarkdown({
  text,
  streaming = false,
}: {
  text: string;
  streaming?: boolean;
}) {
  return (
    <div className={`agent-md leading-relaxed ${streaming ? "claude-caret" : ""}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // ── tables: the comparison workhorse ──
          table: ({ children }) => (
            <div className="my-3 max-w-full overflow-x-auto thin-scroll rounded-lg border" dir="auto">
              <table className="w-full border-collapse text-[13px]">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-secondary/80">{children}</thead>,
          tr: ({ children }) => (
            <tr className="border-b border-border/50 last:border-0 even:bg-secondary/25">{children}</tr>
          ),
          th: ({ children }) => (
            <th className="num whitespace-nowrap px-2.5 py-1.5 text-start font-semibold">{children}</th>
          ),
          td: ({ children }) => <td className="num px-2.5 py-1.5">{children}</td>,
          // ── headings: accent bar hierarchy ──
          h1: ({ children }) => (
            <h3 className="mt-4 mb-1.5 flex items-center gap-2 text-base font-bold">
              <span className="h-4 w-1 rounded-full bg-primary" aria-hidden />
              {children}
            </h3>
          ),
          h2: ({ children }) => (
            <h3 className="mt-4 mb-1.5 flex items-center gap-2 text-base font-bold">
              <span className="h-4 w-1 rounded-full bg-primary" aria-hidden />
              {children}
            </h3>
          ),
          h3: ({ children }) => <h4 className="mt-3 mb-1 text-sm font-bold">{children}</h4>,
          h4: ({ children }) => <h4 className="mt-3 mb-1 text-sm font-bold">{children}</h4>,
          // ── text blocks ──
          p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="my-2 list-disc space-y-1 ps-5">{children}</ul>,
          ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 ps-5">{children}</ol>,
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
          blockquote: ({ children }) => (
            <blockquote className="my-2.5 border-s-2 border-primary/60 bg-secondary/30 px-3 py-1.5 text-muted-foreground rounded-e-md">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-4 border-border" />,
          a: ({ href, children }) => (
            <a
              href={href ? fixUrl(href) : undefined}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-2 break-words"
            >
              {children}
            </a>
          ),
          code: ({ className, children }) =>
            className?.includes("language-") ? (
              <code className="block overflow-x-auto thin-scroll rounded-lg bg-secondary px-3 py-2.5 font-mono text-xs leading-relaxed">
                {children}
              </code>
            ) : (
              <code className="num rounded bg-secondary px-1 py-0.5 font-mono text-[12px]">{children}</code>
            ),
          pre: ({ children }) => <pre className="my-2.5">{children}</pre>,
          // GFM task list checkboxes stay honest (agent rarely emits them)
          input: ({ checked }) => (
            <input type="checkbox" checked={checked ?? false} readOnly className="me-1 align-middle" />
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
