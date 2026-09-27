"use client";

/** The agent's model switcher (T30 → T71) — every option is served
 *  SERVER-side through /api/agent; no client-side loops, no sign-in walls:
 *
 *  - MAIN (no sign-in, no keys): llm7's GLM-5.3-Flash — it answers keyless
 *    on EVERY host and streams its live chain-of-thought. First row of the
 *    menu, the default pick.
 *  - BACKUP keyless pool: the three Kilo Gateway routes + Pollinations
 *    GPT-OSS-20B (auto-failover hops when the shared GLM pool is busy).
 *
 *  T71: the GLM-4-Plus strong tier (sandbox SDK gateway / ZAI_API_KEY
 *  direct cloud) was REMOVED ENTIRELY at the user's request — its live
 *  thinking never streamed and answers took a while to end. T67: the
 *  Puter family was REMOVED from the agent view; T68 the Puter ladder was
 *  ALSO removed from the Ctrl+K assistant popup — the app no longer loads
 *  any third-party model script anywhere. */

import { useEffect, useState } from "react";
import { AI_MODELS, DEFAULT_AI_MODEL_ID, aiModelLabel, loadAiModelId, saveAiModelId } from "@/lib/ai-models";
import { T, tt } from "@/lib/i18n";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Check, ChevronsUpDown, Info, Sparkles, Zap } from "lucide-react";

type HostBackbone = { backbone: "sdk" | "direct" | "keyless"; engine: string; needsKey: boolean };

export function ModelSwitcher({
  lang,
  modelId,
  onModelChange,
}: {
  lang: "ar" | "en";
  modelId: string;
  onModelChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [backbone, setBackbone] = useState<HostBackbone | null>(null);

  // T67 — the host backbone report, fetched when the menu opens (cheap GET)
  useEffect(() => {
    if (!open || backbone) return;
    let alive = true;
    void fetch("/api/agent")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (
          alive &&
          j &&
          (j.backbone === "sdk" || j.backbone === "direct" || j.backbone === "keyless")
        ) {
          setBackbone({ backbone: j.backbone, engine: String(j.engine ?? ""), needsKey: j.needsKey === true });
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [open, backbone]);

  const chipLabel = aiModelLabel(modelId);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-full border bg-secondary/60 px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-secondary"
          aria-label={tt(T.aiModelSwitch, lang)}
          title={tt(T.aiModelSwitch, lang)}
        >
          <Sparkles className="h-3 w-3 text-primary" aria-hidden />
          <span className="num max-w-[130px] truncate">{chipLabel}</span>
          <ChevronsUpDown className="h-3 w-3 text-muted-foreground" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80 p-0">
        <div className="max-h-[420px] overflow-y-auto thin-scroll p-1">
          {/* ── T67/T71 — HOST ENGINE banner: which engine serves answers on
              THIS host. After the GLM-4-Plus removal there is exactly one
              engine everywhere — the keyless GLM-5.3-Flash main. ── */}
          {backbone && (
            <div
              className="mx-1.5 mb-2 rounded-md border px-2.5 py-2"
              style={{ borderColor: "var(--chat-border)", backgroundColor: "var(--chat-accent-soft)" }}
              dir="auto"
            >
              <div className="flex items-center gap-1.5 text-[11px] font-semibold">
                <Info className="h-3 w-3 shrink-0" style={{ color: "var(--chat-accent)" }} aria-hidden />
                {tt(T.agentHostEngine, lang)}: <span className="num">{backbone.engine}</span>
              </div>
            </div>
          )}

          {/* ── T68 — THE MAIN MODEL first: the keyless GLM-5.3-Flash — the
              default pick on every host, streams its live thinking. ── */}
          {AI_MODELS.filter((m) => m.id === "llm7:GLM-5.3-Flash").map((m) => (
            <ModelRow
              key={m.id}
              active={modelId === m.id}
              onClick={() => onModelChange(m.id)}
              icon={<Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden />}
              title={m.label}
              sub={`${tt({ ar: m.noteAr, en: m.note }, lang)}${m.ctx ? ` · ${Math.round(m.ctx / 1000)}k` : ""}`}
              badge={tt(T.aiModelMainBadge, lang)}
            />
          ))}

          {/* ── T36/T66/T67 backup keyless pool — the auto-failover hops when
              the shared GLM pool is busy: the freellmpool-vetted Kilo
              Gateway routes + Pollinations, all served server-side ── */}
          {AI_MODELS.filter((m) => (m.provider === "kilo" || m.provider === "pollinations") && m.id !== "llm7:GLM-5.3-Flash").length > 0 && (
            <>
              <div className="px-2.5 pb-1 pt-3 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                {tt(T.aiModelKeylessCat, lang)}
              </div>
              {AI_MODELS.filter((m) => m.provider === "kilo" || m.provider === "pollinations").map((m) => (
                <ModelRow
                  key={m.id}
                  active={modelId === m.id}
                  onClick={() => onModelChange(m.id)}
                  icon={<Zap className="h-3.5 w-3.5 text-up" aria-hidden />}
                  title={m.label}
                  sub={`${tt({ ar: m.noteAr, en: m.note }, lang)}${m.ctx ? ` · ${Math.round(m.ctx / 1000)}k` : ""}`}
                  badge={null}
                />
              ))}
            </>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ModelRow({
  active,
  onClick,
  icon,
  title,
  sub,
  badge,
  small,
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
      <button type="button" onClick={onClick} className="flex w-full items-start gap-2 px-2 py-1.5 text-start">
        <span className={`mt-0.5 shrink-0 ${active ? "text-primary" : "text-muted-foreground"}`}>{icon}</span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate ${small ? "text-[11.5px]" : "text-[12.5px]"} font-medium leading-tight`} dir="auto">
            {title}
          </span>
          <span className="num block truncate text-[10.5px] text-muted-foreground" dir="auto">
            {sub}
          </span>
        </span>
        {active && <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />}
        {badge && !active && (
          <span className="num mt-0.5 shrink-0 rounded-full bg-up-soft px-1.5 py-0.5 text-[9px] font-semibold text-up">{badge}</span>
        )}
      </button>
    </div>
  );
}

/** Shared state hook: loads the persisted model id on mount, saves on change. */
export function useAiModel(): [string, (id: string) => void] {
  const [modelId, setModelId] = useState(DEFAULT_AI_MODEL_ID);
  useEffect(() => {
    // SSR-safe localStorage restore (mount effect is the honest pattern here)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setModelId(loadAiModelId());
  }, []);
  const choose = (id: string) => {
    setModelId(id);
    saveAiModelId(id);
  };
  return [modelId, choose];
}
