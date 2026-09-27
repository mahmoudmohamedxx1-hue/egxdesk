#!/bin/bash
# Task 15 — production E2E in one session (server + agent-browser checks)
cd /home/z/my-project
PORT=3102 bun .next/standalone/server.js > prod.log 2>&1 &
SVPID=$!
sleep 5
agent-browser close 2>/dev/null
agent-browser open "http://localhost:3102/" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
agent-browser wait 1500
NAVJS='(() => { const nav = document.querySelector("header nav"); return [...nav.querySelectorAll("button")].length + " tabs, navs on page: " + document.querySelectorAll("nav").length; })()'
INSJS='(() => { const b = [...document.querySelectorAll("footer button")].find(x => x.textContent.includes("ثبّت")); return b ? "present" : "MISSING"; })()'
TABJS='(() => [...document.querySelectorAll("[role=tablist] [role=tab]")].slice(0,3).map(t => t.textContent.trim()).join(",") )()'
TEASJS='(() => { const t = document.querySelector("[aria-label=valuation summary]"); return t ? t.innerText.slice(0, 80) : "MISSING"; })()'
BELLJS='(() => { const b = document.querySelector("header button[aria-label=التنبيهات والتذكيرات]"); if (!b) return "MISSING"; b.click(); return "clickable"; })()'
POPJS='(() => { const p = document.querySelector("[data-radix-popper-content-wrapper]"); return p ? p.innerText.slice(0, 120) : "MISSING"; })()'
echo "NAV: $(agent-browser eval "$NAVJS" 2>/dev/null)"
echo "INSTALL: $(agent-browser eval "$INSJS" 2>/dev/null)"
agent-browser open "http://localhost:3102/?view=company&ticker=COMI" >/dev/null 2>&1
agent-browser wait 2500
echo "TABS: $(agent-browser eval "$TABJS" 2>/dev/null)"
echo "TEASER: $(agent-browser eval "$TEASJS" 2>/dev/null)"
echo "BELL: $(agent-browser eval "$BELLJS" 2>/dev/null)"
agent-browser wait 700
echo "POPOVER: $(agent-browser eval "$POPJS" 2>/dev/null)"
ERRN=$(agent-browser errors 2>/dev/null | grep -c 'Error')
echo "ERRCOUNT: ${ERRN:-0}"
agent-browser screenshot /home/z/my-project/scripts/data-test/t15-prod-company.png >/dev/null 2>&1
kill $SVPID 2>/dev/null
echo "server stopped"
