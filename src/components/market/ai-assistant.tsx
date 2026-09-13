"use client";

/** T28/T29 — the AI ASSISTANT POPUP: a floating command center that can
 *  EXECUTE anything on the website. Design inspired by the 21st.dev
 *  "ai-input" component family (animated gradient composer ring, round
 *  accessory buttons, model selector chip, circular gradient send orb,
 *  keyboard hint) — re-implemented original code in the app's warm
 *  terracotta palette.
 *
 *  Three brains, all free (T29: cloud models replace the local ones):
 *  - Instant  — the built-in bilingual regex router, zero network
 *  - Cloud    — /api/assistant (GLM-4-Plus) — works in any browser
 *  - Puter    — 1,000+ FREE ONLINE CLOUD models via Puter.js (no API
 *    keys, no cards): GLM-5.3 — the NEWEST GLM — is the default, plus
 *    GPT-5.6, Claude Sonnet 5, Gemini 3.1, Grok 4.6, DeepSeek V4, Kimi
 *    K3… behind ONE free Puter sign-in that uses the visitor's own free
 *    monthly allowance.
 *
 *  The agent loop: plan (strict JSON {tool,args}|{reply}) → execute the
 *  tool against the live app (navigate / watchlist / alerts / paper
 *  trades / language / theme / data) → compose the final bilingual
 *  answer from the real result. Instant mode formats the tool result
 *  locally instead.
 *
 *  Global: Ctrl/Cmd+K toggles, Escape closes, FAB launcher bottom-end,
 *  mobile = near-fullscreen sheet, safe-area aware (P1-5 app shell). */

import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "./app-context";
import { T, tt, type Lang } from "@/lib/i18n";
import { AgentMarkdown } from "./agent-markdown";
import {
  TOOL_DEFS, instantRoute, runTool, parseToolJson, toolsPromptSpec,
} from "@/lib/assistant-tools";
import {
  MODEL_CLOUD, MODEL_INSTANT, FEATURED_CLOUD, modelChipLabel, isPuterModel,
  puterModelId, puterChat, puterSignedIn, puterSignIn, puterSignOut,
  puterUsername, puterCatalog, PuterAuthRequiredError,
  type CatalogModel,
} from "@/lib/assistant-models";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useTheme } from "next-themes";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowUp, Bot, Check, ChevronDown, Cloud, Eraser, Languages, LogIn, LogOut,
  Plus, Search, Sparkles, Square, Wrench, X, Zap,
} from "lucide-react";

type Msg = {
  role: "user" | "assistant";
  text: string;
  steps?: { tool: string; ok: boolean }[];
  error?: boolean;
  /** the Puter sign-in prompt card */
  signin?: boolean;
  ts: number;
};

const CHAT_KEY = "egx-assistant-chat";
const MODEL_KEY = "egx-assistant-model";
const MAX_STORED = 30;
/** the default brain: the NEWEST GLM, free on the Puter cloud */
const DEFAULT_MODEL = puterModelId("z-ai:z-ai/glm-5.3");
const SUGGESTIONS = [T.aiSuggest1, T.aiSuggest2, T.aiSuggest3, T.aiSuggest4, T.aiSuggest5, T.aiSuggest6];

/** The terracotta 12-ray sunburst — the assistant's avatar mark. */
function SunburstMark({ className, style }: { className?: string; style?: React.CSSProperties }) {
  const rays = Array.from({ length: 12 }, (_, i) => i * 30);
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} style={style} aria-hidden>
      {rays.map((a) => {
        const rad = (a * Math.PI) / 180;
        return (
          <line key={a} x1={12 + Math.sin(rad) * 3.4} y1={12 - Math.cos(rad) * 3.4}
            x2={12 + Math.sin(rad) * 10.2} y2={12 - Math.cos(rad) * 10.2}
            stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        );
      })}
    </svg>
  );
}

function planSystemPrompt(lang: Lang, view: string, ticker?: string): string {
  return [
    "You are the EGX Desk web assistant (Egyptian Exchange market app). You control the website: the user asks, you pick ONE next action.",
    `App state: view=${view}${ticker ? `, ticker=${ticker}` : ""}, language=${lang}.`,
    "",
    "Respond ONLY with compact JSON on a single line - NO markdown, NO code fences, NO explanation:",
    '{"tool":"<name>","args":{...}}  -> to run a tool (args may be {})',
    '{"reply":"<text>"}             -> only for general questions no tool can answer',
    "",
    "TOOLS:",
    toolsPromptSpec(),
    "",
    "Rules: navigation/control requests (open, show, buy, alert, watch, theme, language) -> the matching tool, assume imperative intent; ticker/name fields accept full company names (e.g. {\"ticker\":\"Eastern Tobacco\"}) so never search first for an imperative action; market data questions -> the data tool (the final answer is composed after execution); output MUST be valid JSON only.",
  ].join("\n");
}

function answerSystemPrompt(lang: Lang, tool: string, args: Record<string, unknown>, result: unknown, question: string): string {
  return [
    "You are the EGX Desk assistant (Egyptian Exchange market app). A tool just executed in the user's browser.",
    `Tool: ${tool}`,
    `Args: ${JSON.stringify(args).slice(0, 600)}`,
    `Result (real delayed market data - the ONLY numbers you may use): ${JSON.stringify(result).slice(0, 3000)}`,
    `User question: ${question}`,
    `Write the final answer in ${lang === "ar" ? "Arabic" : "English"}: concise plain markdown (2-6 lines), only real numbers from the result, never invented data. For navigation actions confirm briefly what you did. No JSON.`,
  ].join("\n");
}

export function AiAssistant() {
  const { lang, setLang, view, navigate, toggleWatch, watch, alerts, addAlert, removeAlert, toast } = useApp();
  const { setTheme } = useTheme();

  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState<null | "think" | "run" | "answer">(null);
  const [focused, setFocused] = useState(false);

  // model layer state
  const [modelId, setModelId] = useState<string>(DEFAULT_MODEL);
  const [puterUser, setPuterUser] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<CatalogModel[] | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [modelQuery, setModelQuery] = useState("");

  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const stopFlagRef = useRef(false);

  // ── boot: mounted, chat restore, model restore (legacy ids reset) ──
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CHAT_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) setMsgs(arr.filter((m) => m && typeof m.text === "string").slice(0, MAX_STORED));
      }
      const m = localStorage.getItem(MODEL_KEY);
      // T29 migration: old WebLLM ids are no longer valid brains
      if (m === MODEL_INSTANT || m === MODEL_CLOUD || (m != null && isPuterModel(m))) setModelId(m);
    } catch {}
  }, []);

  // ── keyboard: Ctrl/Cmd+K toggles, Escape closes ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // focus the composer when the panel opens
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => taRef.current?.focus(), 180);
      return () => clearTimeout(t);
    }
  }, [open]);

  // keep the transcript pinned to the newest content
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, busy]);

  // textarea auto-grow (max 6 rows)
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const max = 24 * 6;
    ta.style.height = `${Math.min(ta.scrollHeight, max)}px`;
    ta.style.overflowY = ta.scrollHeight > max ? "auto" : "hidden";
  }, [input]);

  const persist = useCallback((next: Msg[]) => {
    try {
      localStorage.setItem(CHAT_KEY, JSON.stringify(next.slice(-MAX_STORED)));
    } catch {}
  }, []);

  const pushMsg = useCallback((m: Msg) => {
    setMsgs((prev) => {
      const next = [...prev, m];
      persist(next);
      return next;
    });
  }, [persist]);

  const patchLast = useCallback((patch: Partial<Msg>) => {
    setMsgs((prev) => {
      if (!prev.length) return prev;
      const next = [...prev];
      next[next.length - 1] = { ...next[next.length - 1], ...patch };
      persist(next);
      return next;
    });
  }, [persist]);

  // ── the tool executor bound to the live app ──
  const toolCtx = useCallback(() => ({
    lang,
    view,
    navigate,
    toggleWatch,
    watchTickers: watch.tickers,
    alerts: alerts.list,
    addAlert,
    removeAlert,
    setLang,
    setTheme: (t: "dark" | "light") => setTheme(t),
  }), [lang, view, navigate, toggleWatch, watch.tickers, alerts.list, addAlert, removeAlert, setLang, setTheme]);

  const executeTool = useCallback(async (tool: string, args: Record<string, unknown>) => {
    setBusy("run");
    const res = await runTool(tool, args, toolCtx());
    setBusy(null);
    return res;
  }, [toolCtx]);

  // ── Puter sign-in flow (free account, Puter's own first-party popup) ──
  const doPuterSignIn = useCallback(async () => {
    try {
      const ok = await puterSignIn();
      if (ok) {
        const u = await puterUsername();
        setPuterUser(u);
        pushMsg({ role: "assistant", text: `**${tt(T.aiPuterSigninOk, lang)}**`, ts: Date.now() });
        toast(tt(T.aiPuterSignedIn, lang));
      } else {
        pushMsg({ role: "assistant", text: tt(T.aiPuterSigninCancelled, lang), ts: Date.now(), error: true });
      }
    } catch {
      pushMsg({ role: "assistant", text: tt(T.aiErrorGeneric, lang), ts: Date.now(), error: true });
    }
  }, [lang, pushMsg, toast]);

  const doPuterSignOut = useCallback(async () => {
    await puterSignOut();
    setPuterUser(null);
    toast(tt(T.aiPuterSignedOut, lang));
  }, [toast, lang]);

  const signinCard = useCallback(() => {
    pushMsg({
      role: "assistant",
      text: `**${tt(T.aiPuterSigninCardTitle, lang)}**\n\n${tt(T.aiPuterSigninCardBody, lang)}`,
      signin: true,
      ts: Date.now(),
    });
  }, [lang, pushMsg]);

  // ── the full agent loop ──
  const ask = useCallback(async (rawText: string) => {
    const text = rawText.trim();
    if (!text || busy) return;
    setInput("");
    const userMsg: Msg = { role: "user", text, ts: Date.now() };
    const history = [...msgs, userMsg];
    setMsgs(history);
    persist(history);
    stopFlagRef.current = false;

    // ── INSTANT mode: zero-model fast path ──
    if (modelId === MODEL_INSTANT) {
      const hit = instantRoute(text);
      if (hit) {
        const res = await executeTool(hit.tool, hit.args);
        pushMsg({
          role: "assistant",
          text: res.text,
          steps: [{ tool: hit.tool, ok: res.ok }],
          ts: Date.now(),
          ...(res.ok ? {} : { error: true }),
        });
      } else {
        pushMsg({
          role: "assistant",
          text: `**${tt(T.aiInstantFallbackTitle, lang)}**\n\n${tt(T.aiInstantFallbackBody, lang)}`,
          ts: Date.now(),
        });
      }
      return;
    }

    // ── CLOUD mode (GLM-4-Plus via /api/assistant) ──
    if (modelId === MODEL_CLOUD) {
      const ac = new AbortController();
      abortRef.current = ac;
      setBusy("think");
      try {
        const res = await fetch("/api/assistant", {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: ac.signal,
          body: JSON.stringify({
            stage: "plan",
            lang,
            context: { view: view.name, ticker: view.ticker },
            messages: history.slice(-8).map((m) => ({ role: m.role, content: m.text })),
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = (await res.json()) as { tool?: string; args?: Record<string, unknown>; reply?: string; error?: string };
        if (j.tool && j.args != null) {
          const toolRes = await executeTool(j.tool, j.args);
          setBusy("answer");
          let answered = false;
          try {
            const ac2 = new AbortController();
            abortRef.current = ac2;
            const res2 = await fetch("/api/assistant", {
              method: "POST",
              headers: { "content-type": "application/json" },
              signal: ac2.signal,
              body: JSON.stringify({
                stage: "answer",
                lang,
                question: text,
                tool: j.tool,
                args: j.args,
                result: toolRes.data ?? { ok: toolRes.ok, text: toolRes.text },
              }),
            });
            if (res2.ok) {
              const j2 = (await res2.json()) as { reply?: string; error?: string };
              if (j2.reply && j2.reply.trim()) {
                pushMsg({ role: "assistant", text: j2.reply.trim(), steps: [{ tool: j.tool, ok: toolRes.ok }], ts: Date.now() });
                answered = true;
              }
            }
          } catch {}
          if (!answered) {
            pushMsg({ role: "assistant", text: toolRes.text, steps: [{ tool: j.tool, ok: toolRes.ok }], ts: Date.now() });
          }
        } else if (j.reply && j.reply.trim()) {
          pushMsg({ role: "assistant", text: j.reply.trim(), ts: Date.now() });
        } else {
          throw new Error(j.error ?? "no action");
        }
      } catch (err) {
        const aborted = err instanceof DOMException && err.name === "AbortError";
        pushMsg({
          role: "assistant",
          text: aborted ? `⏹ ${tt(T.aiInputStop, lang)}` : tt(T.aiErrorGeneric, lang),
          ts: Date.now(),
          ...(aborted ? {} : { error: true }),
        });
      } finally {
        abortRef.current = null;
        setBusy(null);
      }
      return;
    }

    // ── PUTER CLOUD mode (GLM-5.3 / 1,000+ free online models) ──
    setBusy("think");
    try {
      if (!(await puterSignedIn())) {
        signinCard();
        return;
      }
      const planMsgs = [
        { role: "system" as const, content: planSystemPrompt(lang, view.name, view.ticker) },
        ...history.slice(-4).map((m) => ({ role: m.role as "user" | "assistant", content: m.text.slice(0, 1200) })),
      ];
      const out = await puterChat(modelId, planMsgs, { stopped: () => stopFlagRef.current });
      const parsed = parseToolJson(out);
      if (parsed?.tool) {
        const toolRes = await executeTool(parsed.tool, parsed.args ?? {});
        setBusy("answer");
        pushMsg({ role: "assistant", text: "", steps: [{ tool: parsed.tool, ok: toolRes.ok }], ts: Date.now() });
        const ansMsgs = [
          { role: "system" as const, content: answerSystemPrompt(lang, parsed.tool, parsed.args ?? {}, toolRes.data ?? { ok: toolRes.ok, text: toolRes.text }, text) },
          { role: "user" as const, content: text || "Compose the final answer." },
        ];
        const final = await puterChat(modelId, ansMsgs, {
          onDelta: (full) => patchLast({ text: full }),
          stopped: () => stopFlagRef.current,
        });
        patchLast({ text: final.trim() || toolRes.text });
      } else if (parsed?.reply) {
        pushMsg({ role: "assistant", text: parsed.reply.trim(), ts: Date.now() });
      } else {
        // the model failed JSON — fall back to the instant router
        const hit = instantRoute(text);
        if (hit) {
          const res = await executeTool(hit.tool, hit.args);
          pushMsg({ role: "assistant", text: res.text, steps: [{ tool: hit.tool, ok: res.ok }], ts: Date.now() });
        } else {
          pushMsg({ role: "assistant", text: out.trim() || tt(T.aiErrorGeneric, lang), ts: Date.now() });
        }
      }
    } catch (err) {
      if (err instanceof PuterAuthRequiredError) {
        signinCard();
      } else {
        const msg = err instanceof Error ? err.message : "error";
        const stopped = stopFlagRef.current;
        pushMsg({
          role: "assistant",
          text: stopped
            ? `⏹ ${tt(T.aiInputStop, lang)}`
            : `${tt(T.aiErrorGeneric, lang)}${msg ? ` — ${msg.slice(0, 90)}` : ""}`,
          ts: Date.now(),
          ...(stopped ? {} : { error: true }),
        });
      }
    } finally {
      setBusy(null);
    }
  }, [busy, modelId, lang, view, msgs, executeTool, pushMsg, patchLast, signinCard]);

  const stop = useCallback(() => {
    stopFlagRef.current = true;
    abortRef.current?.abort();
  }, []);

  // ── model selection ──
  const selectModel = useCallback((id: string) => {
    setModelId(id);
    try {
      localStorage.setItem(MODEL_KEY, id);
    } catch {}
  }, []);

  // lazily pull the 1,000+ model catalog + sign-in state when the menu opens
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    if (menuOpen) {
      if (catalog === null) void puterCatalog().then(setCatalog);
      void puterSignedIn().then(async (ok) => {
        setPuterUser(ok ? await puterUsername() : null);
      });
    }
  }, [menuOpen, catalog]);

  const canSend = !busy && input.trim().length > 0;
  const ringOn = focused || busy != null;
  const chipLabel = modelChipLabel(modelId);
  const catalogFiltered = (catalog ?? []).filter((m) => {
    if (!modelQuery) return true;
    const q = modelQuery.toLowerCase();
    return m.name.toLowerCase().includes(q) || m.puterId.toLowerCase().includes(q) || m.provider.toLowerCase().includes(q);
  });

  return (
    <>
      {/* the floating launcher orb (hidden while the panel is open) */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label={tt(T.aiAssistOpen, lang)}
          title={tt(T.aiAssistOpen, lang)}
          className="ai-orb fixed z-40 bottom-[calc(env(safe-area-inset-bottom)+1.25rem)] end-5 flex h-12 w-12 items-center justify-center rounded-full transition-transform hover:scale-105 active:scale-95"
        >
          <Sparkles className="h-5 w-5" aria-hidden />
        </button>
      )}

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            role="dialog"
            aria-label={tt(T.aiAssistTitle, lang)}
            className="fixed z-50 flex flex-col overflow-hidden rounded-2xl border bg-card shadow-2xl
              inset-x-3 top-14 bottom-3
              sm:inset-auto sm:bottom-[calc(env(safe-area-inset-bottom)+1.5rem)] sm:end-6 sm:top-auto
              sm:h-[min(620px,calc(100dvh-5rem))] sm:w-[430px]"
          >
            {/* ── header ── */}
            <div className="flex items-center gap-2.5 border-b px-4 py-3 shrink-0">
              <span className="flex h-8 w-8 items-center justify-center rounded-full" style={{ backgroundColor: "var(--chat-accent-soft)", color: "var(--chat-accent)" }}>
                <Bot className="h-4.5 w-4.5" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold leading-tight">{tt(T.aiAssistTitle, lang)}</div>
                <div className="num truncate text-[11px] text-muted-foreground">
                  {busy === "think" && tt(T.aiThinking, lang)}
                  {busy === "run" && tt(T.aiRunning, lang)}
                  {busy === "answer" && tt(T.aiThinking, lang)}
                  {!busy && chipLabel}
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label={tt(T.aiAssistClose, lang)}
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>

            {/* ── transcript ── */}
            <div ref={scrollRef} className="thin-scroll flex-1 overflow-y-auto px-4 py-4 space-y-4">
              {msgs.length === 0 && !busy && (
                <div className="space-y-3">
                  <div className="flex gap-2.5">
                    <SunburstMark className="mt-0.5 h-5 w-5 shrink-0" />
                    <div>
                      <div className="text-sm font-semibold">{tt(T.aiWelcomeTitle, lang)}</div>
                      <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{tt(T.aiWelcomeBody, lang)}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {SUGGESTIONS.map((s, i) => (
                      <button
                        key={i}
                        onClick={() => void ask(tt(s, lang))}
                        className="ai-chip rounded-full border bg-secondary/60 px-3 py-1.5 text-[12px] hover:bg-secondary"
                      >
                        {tt(s, lang)}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {msgs.map((m, i) =>
                m.role === "user" ? (
                  <div key={i} className="flex justify-end">
                    <div dir="auto" className="max-w-[85%] rounded-2xl rounded-ee-md bg-primary/10 px-3.5 py-2 text-[13.5px] leading-relaxed">
                      {m.text}
                    </div>
                  </div>
                ) : (
                  <div key={i} className="flex gap-2.5">
                    <SunburstMark className="mt-1 h-4 w-4 shrink-0" style={{ color: "var(--chat-accent)" }} />
                    <div className="min-w-0 flex-1">
                      {m.steps && m.steps.length > 0 && (
                        <div className="mb-1.5 flex items-center gap-1.5 flex-wrap">
                          {m.steps.map((s, k) => (
                            <span key={k} className="ai-tool-chip inline-flex items-center gap-1 rounded-full border bg-secondary/60 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                              <Wrench className="h-2.5 w-2.5" aria-hidden />
                              {s.tool}
                              {s.ok ? " ✓" : " ✕"}
                            </span>
                          ))}
                        </div>
                      )}
                      {m.text ? (
                        <div className={m.error ? "text-down text-[13.5px]" : "text-[13.5px]"}>
                          <AgentMarkdown text={m.text} />
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[13px] text-muted-foreground">
                          {tt(T.aiThinking, lang)}
                          <motion.span animate={{ opacity: [0.25, 1, 0.25] }} transition={{ duration: 1.2, repeat: Infinity }}>·</motion.span>
                          <motion.span animate={{ opacity: [0.25, 1, 0.25] }} transition={{ duration: 1.2, repeat: Infinity, delay: 0.2 }}>·</motion.span>
                          <motion.span animate={{ opacity: [0.25, 1, 0.25] }} transition={{ duration: 1.2, repeat: Infinity, delay: 0.4 }}>·</motion.span>
                        </span>
                      )}
                      {m.signin && (
                        <button
                          type="button"
                          onClick={() => void doPuterSignIn()}
                          className="mt-2 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors hover:bg-secondary"
                          style={{ color: "var(--chat-accent)" }}
                        >
                          <LogIn className="h-3.5 w-3.5" aria-hidden />
                          {tt(T.aiPuterSignIn, lang)}
                        </button>
                      )}
                    </div>
                  </div>
                ),
              )}

              {busy && busy !== "think" && (
                <div className="flex gap-2.5">
                  <SunburstMark className="mt-1 h-4 w-4 shrink-0" />
                  <span className="text-[13px] text-muted-foreground">{busy === "run" ? tt(T.aiRunning, lang) : tt(T.aiThinking, lang)}…</span>
                </div>
              )}
            </div>

            {/* ── the 21st.dev-style composer ── */}
            <div className="shrink-0 border-t px-3 pt-3 pb-2.5">
              <div className={`ai-input-ring rounded-[22px] p-[1.5px] ${ringOn ? "is-on" : ""}`}>
                <div className="rounded-[20.5px] border bg-background">
                  <textarea
                    ref={taRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value.slice(0, 2000))}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        if (canSend) void ask(input);
                      }
                    }}
                    placeholder={tt(T.aiInputPlaceholder, lang)}
                    aria-label={tt(T.aiInputPlaceholder, lang)}
                    rows={1}
                    dir="auto"
                    className="thin-scroll w-full resize-none bg-transparent px-4 pt-3 pb-1 text-[14px] leading-6 outline-none placeholder:text-muted-foreground"
                  />
                  <div className="flex items-center gap-1 px-2 pb-2.5 pt-1">
                    {/* + context menu */}
                    <Popover>
                      <PopoverTrigger asChild>
                        <button type="button" aria-label={tt(T.aiExamples, lang)} title={tt(T.aiExamples, lang)}
                          className="flex h-7.5 w-7.5 items-center justify-center rounded-full transition-colors hover:opacity-80"
                          style={{ backgroundColor: "var(--chat-accent-soft)", color: "var(--chat-accent)" }}>
                          <Plus className="h-4 w-4" aria-hidden />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent align="start" className="w-72 p-0" sideOffset={8}>
                        <div className="px-3 pt-2.5 pb-1 text-[11px] font-semibold text-muted-foreground">
                          {tt(T.aiContextNow, lang)}: <span className="num">{view.name}{view.ticker ? ` · ${view.ticker}` : ""}</span>
                        </div>
                        <div className="max-h-72 overflow-y-auto thin-scroll px-1.5 pb-1.5">
                          {TOOL_DEFS.map((d) => (
                            <button key={d.name} type="button"
                              onClick={() => setInput(d.example)}
                              className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-start transition-colors hover:bg-secondary">
                              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground">
                                <Wrench className="h-2.5 w-2.5" aria-hidden />
                              </span>
                              <span className="min-w-0">
                                <span className="block text-[12px] font-medium leading-tight">{tt(d.desc, lang)}</span>
                                <span className="block truncate text-[11px] text-muted-foreground" dir="auto">{d.example}</span>
                              </span>
                            </button>
                          ))}
                        </div>
                        <div className="border-t p-1.5">
                          <button type="button"
                            onClick={() => {
                              setMsgs([]);
                              try {
                                localStorage.removeItem(CHAT_KEY);
                              } catch {}
                            }}
                            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[12px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
                            <Eraser className="h-3.5 w-3.5" aria-hidden />
                            {tt(T.aiClearChat, lang)}
                          </button>
                        </div>
                      </PopoverContent>
                    </Popover>

                    {/* the model selector chip */}
                    <Popover onOpenChange={setMenuOpen}>
                      <PopoverTrigger asChild>
                        <button type="button" aria-label={tt(T.aiModelLabel, lang)} title={tt(T.aiModelLabel, lang)}
                          className="inline-flex h-7.5 items-center gap-1.5 rounded-full border bg-secondary/50 px-2.5 text-[11.5px] font-medium transition-colors hover:bg-secondary">
                          {modelId === MODEL_INSTANT ? <Zap className="h-3 w-3" aria-hidden /> : modelId === MODEL_CLOUD ? <Languages className="h-3 w-3" aria-hidden /> : <Cloud className="h-3 w-3" aria-hidden />}
                          <span className="num max-w-32 truncate">{chipLabel}</span>
                          <ChevronDown className="h-3 w-3 opacity-60" aria-hidden />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent align="start" className="w-[318px] p-0" sideOffset={8}>
                        <ModelMenu
                          lang={lang}
                          modelId={modelId}
                          puterUser={puterUser}
                          catalog={catalogFiltered}
                          catalogTotal={catalog?.length ?? null}
                          showAll={showAll}
                          onToggleAll={() => setShowAll((s) => !s)}
                          modelQuery={modelQuery}
                          onQuery={setModelQuery}
                          onSelect={selectModel}
                          onSignIn={() => void doPuterSignIn()}
                          onSignOut={() => void doPuterSignOut()}
                        />
                      </PopoverContent>
                    </Popover>

                    <span className="num ms-auto hidden select-none text-[10px] text-muted-foreground sm:inline">⏎</span>

                    {busy ? (
                      <button type="button" onClick={stop} aria-label={tt(T.aiInputStop, lang)} title={tt(T.aiInputStop, lang)}
                        className="ai-send ms-1 flex h-8.5 w-8.5 shrink-0 items-center justify-center rounded-full">
                        <Square className="h-3 w-3 fill-current" aria-hidden />
                      </button>
                    ) : (
                      <button type="button" onClick={() => canSend && void ask(input)} disabled={!canSend}
                        aria-label={tt(T.aiInputSend, lang)} title={tt(T.aiInputSend, lang)}
                        className="ai-send ms-1 flex h-8.5 w-8.5 shrink-0 items-center justify-center rounded-full">
                        <ArrowUp className="h-4.5 w-4.5" aria-hidden />
                      </button>
                    )}
                  </div>
                </div>
              </div>
              <div className="num mt-1.5 px-1 text-[10px] leading-tight text-muted-foreground">{tt(T.aiDisclaimer, lang)}</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

// ── the model selector menu (Instant / Cloud GLM-4-Plus / featured cloud
//    catalog + searchable all-models list + Puter sign-in state) ──

function ModelMenu({
  lang, modelId, puterUser, catalog, catalogTotal, showAll,
  onToggleAll, modelQuery, onQuery, onSelect, onSignIn, onSignOut,
}: {
  lang: Lang;
  modelId: string;
  puterUser: string | null;
  catalog: CatalogModel[];
  catalogTotal: number | null;
  showAll: boolean;
  onToggleAll: () => void;
  modelQuery: string;
  onQuery: (q: string) => void;
  onSelect: (id: string) => void;
  onSignIn: () => void;
  onSignOut: () => void;
}) {
  return (
    <div className="max-h-[420px] overflow-y-auto thin-scroll p-1">
      {/* instant */}
      <ModelRow
        active={modelId === MODEL_INSTANT}
        onClick={() => onSelect(MODEL_INSTANT)}
        icon={<Zap className="h-3.5 w-3.5" aria-hidden />}
        title={tt(T.aiModelInstant, lang)}
        sub={tt(T.aiModelInstantDesc, lang)}
        badge={null}
      />
      {/* cloud GLM-4-Plus (app's own server — no sign-in) */}
      <ModelRow
        active={modelId === MODEL_CLOUD}
        onClick={() => onSelect(MODEL_CLOUD)}
        icon={<Languages className="h-3.5 w-3.5" aria-hidden />}
        title={tt(T.aiModelCloud, lang)}
        sub={tt(T.aiModelCloudDesc, lang)}
        badge={null}
      />

      <div className="px-2.5 pb-1 pt-3 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
        {tt(T.aiModelCloudCat, lang)}
      </div>

      {/* Puter account row */}
      <div className="mx-1.5 mb-2 rounded-md border bg-secondary/30 px-2.5 py-2">
        {puterUser ? (
          <div className="flex items-center justify-between gap-2">
            <span className="num min-w-0 truncate text-[11.5px]">
              <Check className="me-1 inline h-3 w-3 text-up" aria-hidden />
              {tt(T.aiPuterSignedIn, lang)} · {puterUser}
            </span>
            <button type="button" onClick={onSignOut}
              className="inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
              <LogOut className="h-2.5 w-2.5" aria-hidden />
              {tt(T.aiPuterSignOut, lang)}
            </button>
          </div>
        ) : (
          <div className="space-y-1.5">
            <div className="text-[11px] leading-relaxed text-muted-foreground">{tt(T.aiPuterNote, lang)}</div>
            <button type="button" onClick={onSignIn}
              className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors hover:bg-secondary"
              style={{ color: "var(--chat-accent)" }}>
              <LogIn className="h-3 w-3" aria-hidden />
              {tt(T.aiPuterSignIn, lang)}
            </button>
          </div>
        )}
      </div>

      {/* featured cloud flagships — GLM first */}
      {FEATURED_CLOUD.map((m) => (
        <ModelRow
          key={m.puterId}
          active={modelId === puterModelId(m.puterId)}
          onClick={() => onSelect(puterModelId(m.puterId))}
          icon={<Cloud className="h-3.5 w-3.5" aria-hidden />}
          title={m.name}
          sub={`${tt(m.desc, lang)} · ${Math.round(m.ctx / 1000)}k`}
          badge={m.newest ? tt(T.aiNewestBadge, lang) : null}
        />
      ))}

      {/* the full searchable catalog */}
      <div className="px-1.5 pt-2 pb-1">
        <button type="button" onClick={onToggleAll}
          className="flex w-full items-center justify-center gap-1.5 rounded-md border bg-secondary/40 py-1.5 text-[11.5px] font-medium transition-colors hover:bg-secondary">
          <Search className="h-3 w-3" aria-hidden />
          {tt(T.aiModelAll, lang)}
          {catalogTotal != null && <span className="num text-muted-foreground">({catalogTotal})</span>}
        </button>
      </div>

      {showAll && (
        <div className="space-y-1 pt-1">
          <div className="px-1.5">
            <input
              value={modelQuery}
              onChange={(e) => onQuery(e.target.value)}
              placeholder={tt(T.aiModelSearchPh, lang)}
              aria-label={tt(T.aiModelSearchPh, lang)}
              className="w-full rounded-md border bg-background px-2.5 py-1.5 text-[12px] outline-none focus:ring-1 focus:ring-primary/40"
            />
          </div>
          {catalogTotal === null && (
            <div className="px-2.5 py-2 text-[11px] text-muted-foreground">{tt(T.aiThinking, lang)}…</div>
          )}
          {catalog.map((m) => (
            <ModelRow
              key={m.puterId}
              active={modelId === puterModelId(m.puterId)}
              onClick={() => onSelect(puterModelId(m.puterId))}
              icon={<Cloud className="h-3.5 w-3.5" aria-hidden />}
              title={m.name}
              sub={`${m.provider}${m.ctx ? ` · ${Math.round(m.ctx / 1000)}k` : ""}`}
              badge={null}
              small
            />
          ))}
          {catalog.length === 0 && catalogTotal != null && (
            <div className="px-2.5 py-2 text-[11px] text-muted-foreground">—</div>
          )}
        </div>
      )}

      <div className="px-2.5 py-2 text-center">
        <a href="https://developer.puter.com" target="_blank" rel="noopener noreferrer"
          className="num text-[10px] text-muted-foreground underline-offset-2 hover:underline">
          Powered by Puter
        </a>
      </div>
    </div>
  );
}

function ModelRow({
  active, onClick, icon, title, sub, badge, small,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  sub: string;
  badge: string | null;
  small?: boolean;
}) {
  return (
    <div className={`relative rounded-md transition-colors ${active ? "bg-primary/10" : "hover:bg-secondary/70"}`}>
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-start gap-2 px-2 py-1.5 text-start"
      >
        <span className={`mt-0.5 shrink-0 ${active ? "text-primary" : "text-muted-foreground"}`}>{icon}</span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate ${small ? "text-[11.5px]" : "text-[12.5px]"} font-medium leading-tight`} dir="auto">{title}</span>
          <span className="num block truncate text-[10.5px] text-muted-foreground" dir="auto">{sub}</span>
        </span>
        {active && <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />}
        {badge && !active && <span className="num mt-0.5 shrink-0 rounded-full bg-up-soft px-1.5 py-0.5 text-[9px] font-semibold text-up">{badge}</span>}
      </button>
    </div>
  );
}
