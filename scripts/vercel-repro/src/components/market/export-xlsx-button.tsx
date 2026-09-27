"use client";

/** Export UI (Task 21-b): a pro Excel (.xlsx) report button, or a combined
 *  Export dropdown (Excel | CSV) for views that already had CSV. The Excel
 *  report is built server-side by /api/export with the full branded
 *  treatment — frozen styled headers, zebra rows, number formats, RTL
 *  sheets — from the SAME live data layer the page shows. */

import { useState, type ReactNode } from "react";
import { useApp } from "./app-context";
import { T, tt } from "@/lib/i18n";
import { downloadXlsx } from "@/lib/export-xlsx-client";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Download, FileSpreadsheet, Loader2 } from "lucide-react";

export type XlsxPayload = unknown;

/** Standalone Excel report button (views without an existing CSV path). */
export function ExportXlsxButton({
  report,
  payload,
  title,
  compact = true,
}: {
  report: string;
  payload?: XlsxPayload | (() => XlsxPayload);
  title?: string;
  compact?: boolean;
}) {
  const { lang, toast } = useApp();
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (busy) return;
    setBusy(true);
    toast(tt(T.exportWorking, lang));
    const p = typeof payload === "function" ? (payload as () => unknown)() : payload;
    const ok = await downloadXlsx(report, lang, p);
    setBusy(false);
    toast(ok ? tt(T.exportDone, lang) : tt(T.exportFailed, lang));
  };

  return (
    <Button
      size="sm"
      variant="outline"
      className={compact ? "h-7 px-2 text-[11px] gap-1" : "h-9 px-3 text-xs gap-1.5"}
      onClick={() => void run()}
      disabled={busy}
      title={title ?? tt(T.exportXlsx, lang)}
    >
      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileSpreadsheet className="h-3 w-3" />}
      {tt(T.exportXlsxShort, lang)}
    </Button>
  );
}

/** Combined export menu: the pro Excel report first, CSV as the plain-data
 *  alternative (the pre-existing client-side path). */
export function ExportMenu({
  report,
  payload,
  onCsv,
  title,
}: {
  report: string;
  payload?: XlsxPayload | (() => XlsxPayload);
  onCsv: () => void;
  title?: string;
}) {
  const { lang, toast } = useApp();
  const [busy, setBusy] = useState(false);

  const xlsx = async () => {
    if (busy) return;
    setBusy(true);
    toast(tt(T.exportWorking, lang));
    const p = typeof payload === "function" ? (payload as () => unknown)() : payload;
    const ok = await downloadXlsx(report, lang, p);
    setBusy(false);
    toast(ok ? tt(T.exportDone, lang) : tt(T.exportFailed, lang));
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2 text-[11px] gap-1"
          disabled={busy}
          title={title ?? tt(T.exportMenu, lang)}
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
          {tt(T.exportMenu, lang)}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem className="gap-2 text-xs" onClick={() => void xlsx()}>
          <FileSpreadsheet className="h-3.5 w-3.5 text-up" />
          <span className="flex-1">{tt(T.exportXlsx, lang)}</span>
        </DropdownMenuItem>
        <DropdownMenuItem className="gap-2 text-xs" onClick={onCsv}>
          <Download className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="flex-1">{tt(T.exportCsv, lang)}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
