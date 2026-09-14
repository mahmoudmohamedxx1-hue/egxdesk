"use client";

/** Free-cloud model switcher (Task 22-b) — a dropdown listing every model in
 *  the registry (all online, all free, no keys). The chosen id persists in
 *  localStorage and rides every /api/agent POST as `body.model`. Rendered
 *  inside the composer bottom bar of both the agent view and the assistant
 *  popup, so model switching is one tap away wherever the user talks to AI. */

import { useEffect, useState } from "react";
import { AI_MODELS, loadAiModelId, saveAiModelId } from "@/lib/ai-models";
import { T, tt } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Check, ChevronsUpDown, Sparkles } from "lucide-react";

export function ModelSwitcher({
  lang,
  modelId,
  onModelChange,
}: {
  lang: "ar" | "en";
  modelId: string;
  onModelChange: (id: string) => void;
}) {
  const current = AI_MODELS.find((m) => m.id === modelId) ?? AI_MODELS[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-full border bg-secondary/60 px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-secondary"
          aria-label={tt(T.aiModelSwitch, lang)}
          title={tt(T.aiModelSwitch, lang)}
        >
          <Sparkles className="h-3 w-3 text-primary" aria-hidden />
          <span className="num max-w-[110px] truncate">{current.label}</span>
          <ChevronsUpDown className="h-3 w-3 text-muted-foreground" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel className="text-xs">{tt(T.aiModelSwitch, lang)}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {AI_MODELS.map((m) => (
          <DropdownMenuItem key={m.id} onClick={() => onModelChange(m.id)} className="gap-2 py-2">
            <Check
              className={`h-3.5 w-3.5 shrink-0 ${m.id === modelId ? "opacity-100" : "opacity-0"}`}
              aria-hidden
            />
            <span className="flex min-w-0 flex-col">
              <span className="num text-xs font-semibold">{m.label}</span>
              <span className="text-[10px] leading-snug text-muted-foreground">
                {tt({ ar: m.noteAr, en: m.note }, lang)}
              </span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Shared state hook: loads the persisted model id on mount, saves on change. */
export function useAiModel(): [string, (id: string) => void] {
  const [modelId, setModelId] = useState(AI_MODELS[0].id);
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
