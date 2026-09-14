"use client";

/** Free-cloud model switcher (T30 → T33 rewrite) — the agent composer's
 *  model dropdown. Two provider families, honestly labeled:
 *
 *  - SERVER (no sign-in): GLM-4-Plus — the app's own server model, streamed
 *    through /api/agent SSE.
 *  - PUTER CLOUD (free sign-in): the featured free ladder (GPT-OSS 20B,
 *    GLM-5.3, GPT-5.6, Claude, Gemini, Grok, DeepSeek…) plus the FULL
 *    searchable 1,000+ model catalog — these run the agent loop client-side
 *    with tools executed by /api/agent/tools.
 *
 *  Featured ids are resolved against the LIVE catalog when it loads, so a
 *  provider rename (e.g. the gpt-oss entry point) self-heals into whatever
 *  real id Puter currently serves. The chosen id persists in localStorage
 *  and rides every /api/agent POST as `body.model` (or drives the client
 *  loop when it is a puter: id). */

import { useEffect, useMemo, useState } from "react";
import { AI_MODELS, DEFAULT_AI_MODEL_ID, aiModelLabel, loadAiModelId, saveAiModelId } from "@/lib/ai-models";
import { puterCatalog, puterSignIn, puterSignOut, puterSignedIn, puterUsername, type CatalogModel } from "@/lib/assistant-models";
import { T, tt } from "@/lib/i18n";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Check, ChevronsUpDown, Cloud, LogIn, LogOut, Search, Server, Sparkles, Zap } from "lucide-react";

/** Featured puter ids resolved against the live catalog: if the hardcoded
 *  id is absent, fall back to the best name match (e.g. "gpt-oss-20b") so
 *  provider-side renames never break the featured ladder. */
function resolveFeatured(catalog: CatalogModel[] | null): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of AI_MODELS) {
    if (m.provider !== "puter") continue;
    out.set(m.id, m.providerModel);
  }
  if (!catalog || catalog.length === 0) return out;
  const have = new Set(catalog.map((c) => c.puterId));
  for (const m of AI_MODELS) {
    if (m.provider !== "puter") continue;
    if (have.has(m.providerModel)) continue; // exact id live — keep it
    // fuzzy fallback: the model family token, e.g. "gpt-oss-20b" from the label
    const needle = m.label.toLowerCase().replace(/[^a-z0-9]/g, "");
    const hit =
      catalog.find((c) => c.puterId.toLowerCase().replace(/[^a-z0-9:/-]/g, "").includes(needle)) ??
      catalog.find((c) => c.name.toLowerCase().replace(/[^a-z0-9]/g, "").includes(needle));
    if (hit) out.set(m.id, hit.puterId);
  }
  return out;
}

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
  const [catalog, setCatalog] = useState<CatalogModel[] | null>(null);
  const [puterUser, setPuterUser] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [query, setQuery] = useState("");

  // lazily pull the 1,000+ model catalog + sign-in state when the menu opens
  useEffect(() => {
    if (!open) return;
    if (catalog === null) void puterCatalog().then(setCatalog);
    void puterSignedIn()
      .then(async (ok) => (ok ? await puterUsername() : null))
      .then(setPuterUser)
      .catch(() => setPuterUser(null));
     
  }, [open]);

  const resolved = useMemo(() => resolveFeatured(catalog), [catalog]);

  const catalogFiltered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return (catalog ?? []).slice(0, 80);
    return (catalog ?? [])
      .filter((m) => m.puterId.toLowerCase().includes(q) || m.name.toLowerCase().includes(q))
      .slice(0, 80);
  }, [catalog, query]);

  const chipLabel = aiModelLabel(modelId);

  const signIn = async () => {
    const ok = await puterSignIn().catch(() => false);
    if (ok) {
      setPuterUser(await puterUsername().catch(() => null));
    }
  };

  const signOut = async () => {
    await puterSignOut().catch(() => {});
    setPuterUser(null);
  };

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
          {/* ── server family — no sign-in, always on ── */}
          {AI_MODELS.filter((m) => m.provider === "zai").map((m) => (
            <ModelRow
              key={m.id}
              active={modelId === m.id}
              onClick={() => onModelChange(m.id)}
              icon={<Server className="h-3.5 w-3.5" aria-hidden />}
              title={m.label}
              sub={tt({ ar: m.noteAr, en: m.note }, lang)}
              badge={null}
            />
          ))}

          {/* ── T36 keyless cloud family — no sign-in, no keys, nothing to
              configure: LLM7.io's anonymous tier, served server-side ── */}
          {AI_MODELS.filter((m) => m.provider === "llm7").length > 0 && (
            <>
              <div className="px-2.5 pb-1 pt-3 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                {tt(T.aiModelKeylessCat, lang)}
              </div>
              {AI_MODELS.filter((m) => m.provider === "llm7").map((m) => (
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
                <button
                  type="button"
                  onClick={() => void signOut()}
                  className="inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  <LogOut className="h-2.5 w-2.5" aria-hidden />
                  {tt(T.aiPuterSignOut, lang)}
                </button>
              </div>
            ) : (
              <div className="space-y-1.5">
                <div className="text-[11px] leading-relaxed text-muted-foreground">{tt(T.aiPuterNote, lang)}</div>
                <button
                  type="button"
                  onClick={() => void signIn()}
                  className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors hover:bg-secondary"
                  style={{ color: "var(--chat-accent)" }}
                >
                  <LogIn className="h-3 w-3" aria-hidden />
                  {tt(T.aiPuterSignIn, lang)}
                </button>
              </div>
            )}
          </div>

          {/* featured cloud ladder — GPT-OSS first, then the flagships */}
          {AI_MODELS.filter((m) => m.provider === "puter").map((m) => {
            const realId = resolved.get(m.id) ?? m.providerModel;
            const active = modelId === m.id || modelId === `puter:${realId}`;
            return (
              <ModelRow
                key={m.id}
                active={active}
                onClick={() => {
                  // store the RESOLVED id so the runtime uses the real one
                  onModelChange(realId === m.providerModel ? m.id : `puter:${realId}`);
                }}
                icon={<Cloud className="h-3.5 w-3.5" aria-hidden />}
                title={m.label}
                sub={`${tt({ ar: m.noteAr, en: m.note }, lang)}${m.ctx ? ` · ${Math.round(m.ctx / 1000)}k` : ""}`}
                badge={m.newest ? tt(T.aiNewestBadge, lang) : null}
              />
            );
          })}

          {/* the full searchable catalog */}
          <div className="px-1.5 pt-2 pb-1">
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="flex w-full items-center justify-center gap-1.5 rounded-md border bg-secondary/40 py-1.5 text-[11.5px] font-medium transition-colors hover:bg-secondary"
            >
              <Search className="h-3 w-3" aria-hidden />
              {tt(T.aiModelAll, lang)}
              {catalog !== null && <span className="num text-muted-foreground">({catalog.length})</span>}
            </button>
          </div>

          {showAll && (
            <div className="space-y-1 pt-1">
              <div className="px-1.5">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={tt(T.aiModelSearchPh, lang)}
                  aria-label={tt(T.aiModelSearchPh, lang)}
                  className="w-full rounded-md border bg-background px-2.5 py-1.5 text-[12px] outline-none focus:ring-1 focus:ring-primary/40"
                />
              </div>
              {catalog === null && (
                <div className="px-2.5 py-2 text-[11px] text-muted-foreground">{tt(T.aiThinking, lang)}…</div>
              )}
              {catalogFiltered.map((m) => (
                <ModelRow
                  key={m.puterId}
                  active={modelId === `puter:${m.puterId}`}
                  onClick={() => onModelChange(`puter:${m.puterId}`)}
                  icon={<Cloud className="h-3.5 w-3.5" aria-hidden />}
                  title={m.name}
                  sub={`${m.provider}${m.ctx ? ` · ${Math.round(m.ctx / 1000)}k` : ""}`}
                  badge={null}
                  small
                />
              ))}
              {catalog !== null && catalogFiltered.length === 0 && (
                <div className="px-2.5 py-2 text-[11px] text-muted-foreground">—</div>
              )}
            </div>
          )}

          <div className="px-2.5 py-2 text-center">
            <a
              href="https://developer.puter.com"
              target="_blank"
              rel="noopener noreferrer"
              className="num text-[10px] text-muted-foreground underline-offset-2 hover:underline"
            >
              Powered by Puter
            </a>
          </div>
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
