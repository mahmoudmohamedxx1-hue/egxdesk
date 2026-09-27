#!/usr/bin/env python3
"""Replace the screener's presets+filter-panel+chips JSX (lines 570..798) with
the Investing.com Pro-style filter bar (search row + add-filter dropdown +
editable filter pills). The results table below stays untouched."""

path = "/home/z/my-project/src/components/views/screener-view.tsx"
with open(path, encoding="utf-8") as f:
    lines = f.readlines()

# lines list is 0-based; JSX markers are at 1-based lines 570 (presets) and 799 (results)
start = 570 - 1      # {/* presets */}
end = 799 - 1        # {/* results */} — exclusive slice end

NEW = '''      {/* pro search row: text search + sector + presets + clear all */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[13rem]">
          <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={f.q}
            onChange={(e) => applyPatch({ q: e.target.value })}
            placeholder={lang === "ar" ? "ابحث بالرمز أو الاسم — بالعربية أو الإنجليزية…" : "Search by ticker or name — Arabic or English…"}
            className="ps-9 h-9 text-sm"
            aria-label={tt(T.searchCompany, lang)}
          />
        </div>
        <select
          value={f.sector}
          onChange={(e) => applyPatch({ sector: e.target.value })}
          className="h-9 rounded-md border bg-card px-2 text-xs text-foreground max-w-[13rem]"
          aria-label={tt(T.allSectors, lang)}
        >
          <option value="">{tt(T.allSectors, lang)}</option>
          {sectors.map((s) => (
            <option key={s.code} value={s.code}>
              {s.name}
            </option>
          ))}
        </select>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-9 gap-1.5 text-xs whitespace-nowrap">
              <Zap className="h-3.5 w-3.5 text-primary" />
              {tt(T.presetLabel, lang)}
              <ChevronDown className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            {PRESETS.map((p) => {
              const isActive =
                ("change" in p.patch &&
                  p.patch.change?.min === f.change.min &&
                  p.patch.change?.max === f.change.max) ||
                ("yield" in p.patch && p.patch.yield?.min === f.yield.min) ||
                ("pe" in p.patch && p.patch.pe?.max === f.pe.max) ||
                ("volRatioMin" in p.patch && p.patch.volRatioMin === f.volRatioMin) ||
                ("cap" in p.patch && p.patch.cap?.min === f.cap.min);
              return (
                <DropdownMenuItem
                  key={p.key}
                  className="text-xs"
                  onClick={() => {
                    if (isActive) {
                      setF(DEFAULT_FILTERS);
                      setActive(DEFAULT_ACTIVE);
                    } else {
                      applyPatch(p.patch);
                      setActive((a) => [...new Set([...a, ...(PRESET_PILLS[p.key] ?? [])])]);
                      setOpenPill(null);
                    }
                  }}
                >
                  <span className="flex-1">{tt(p.t, lang)}</span>
                  {isActive && <span className="num text-[10px] text-muted-foreground">✓</span>}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
        {(valueCount > 0 || active.length !== DEFAULT_ACTIVE.length) && (
          <Button
            variant="ghost"
            size="sm"
            className="h-9 gap-1 text-xs text-muted-foreground whitespace-nowrap"
            onClick={() => {
              setF(DEFAULT_FILTERS);
              setActive(DEFAULT_ACTIVE);
              setOpenPill(null);
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {tt(T.screenerClearAll, lang)}
          </Button>
        )}
      </div>

      {/* pro filter bar: add-filter dropdown + editable filter pills */}
      <div className="rounded-lg border bg-card p-2.5 flex items-center gap-1.5 flex-wrap">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" className="h-7 gap-1 rounded-full px-2.5 text-[11px]">
              <Plus className="h-3 w-3" />
              {tt(T.addFilter, lang)}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56 max-h-80 overflow-y-auto thin-scroll">
            {(["price", "valuation", "activity", "range"] as const).map((group) => (
              <DropdownMenuGroup key={group}>
                <DropdownMenuLabel className="text-[10px] text-muted-foreground">
                  {tt(GROUP_LABELS[group], lang)}
                </DropdownMenuLabel>
                {FILTER_DEFS.filter((d) => d.group === group).map((d) => (
                  <DropdownMenuCheckboxItem
                    key={d.key}
                    checked={active.includes(d.key)}
                    onCheckedChange={(v) => (v ? addFilter(d.key) : removeFilter(d.key))}
                    className="text-xs"
                    onSelect={(e) => e.preventDefault()}
                  >
                    {tt(d.t, lang)}
                  </DropdownMenuCheckboxItem>
                ))}
                <DropdownMenuSeparator />
              </DropdownMenuGroup>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {active.length === 0 && valueCount === 0 && (
          <span className="text-[11px] text-muted-foreground">{tt(T.noActiveFilters, lang)}</span>
        )}

        {active.map((key) => {
          const def = FILTER_DEFS.find((d) => d.key === key)!;
          const { label, hasValue } = pillLabel(key);
          return (
            <FilterPill
              key={key}
              label={label}
              hasValue={hasValue}
              open={openPill === key}
              onOpenChange={(v) => setOpenPill(v ? key : null)}
              onRemove={() => removeFilter(key)}
              removeLabel={tt(T.removeFilter, lang)}
              editLabel={tt(T.editFilterHint, lang)}
            >
              <p className="text-[11px] font-semibold text-foreground/80">{tt(def.t, lang)}</p>
              {def.kind === "perf" && (
                <>
                  <select
                    value={f.perfPeriod}
                    onChange={(e) => applyPatch({ perfPeriod: e.target.value as PerfPeriod })}
                    className="h-8 w-full rounded-md border bg-card px-2 text-xs"
                    aria-label={tt(T.filterPerf, lang)}
                  >
                    {PERF_OPTIONS.map(([p, l]) => (
                      <option key={p} value={p}>
                        {tt(l, lang)}
                      </option>
                    ))}
                  </select>
                  <BoundInput value={f.perf} onChange={(b) => applyPatch({ perf: b })} lang={lang} />
                </>
              )}
              {def.kind === "min" && (
                <MinInput
                  value={f[key as MinKey]}
                  onChange={(v) => applyPatch({ [key]: v } as Partial<Filters>)}
                  lang={lang}
                />
              )}
              {def.kind === "range52" && (
                <div className="flex items-center gap-1">
                  {(
                    [
                      ["", T.any52],
                      ["high", T.nearHigh],
                      ["low", T.nearLow],
                    ] as const
                  ).map(([v, t]) => (
                    <button
                      key={v}
                      onClick={() => applyPatch({ range52: v })}
                      className={`h-8 flex-1 rounded-md border px-1.5 text-[11px] leading-tight transition-colors ${
                        f.range52 === v
                          ? "bg-secondary font-semibold border-ring"
                          : "text-muted-foreground hover:bg-accent/50"
                      }`}
                    >
                      {tt(t, lang)}
                    </button>
                  ))}
                </div>
              )}
              {def.kind === "bound" && (
                <BoundInput
                  value={f[key as BoundKey]}
                  onChange={(b) => applyPatch({ [key]: b } as Partial<Filters>)}
                  lang={lang}
                />
              )}
            </FilterPill>
          );
        })}
      </div>

      <p className="text-[10px] text-muted-foreground leading-relaxed">
        {tt(T.screenerExcludeNote, lang)} · {tt(T.screenerSortHint, lang)}
      </p>

'''

lines[start:end] = [NEW]
with open(path, "w", encoding="utf-8") as f:
    f.writelines(lines)
print("replaced OK — new total lines:", len(lines))
