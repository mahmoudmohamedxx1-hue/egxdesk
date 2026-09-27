#!/bin/bash
# Task 16 — production E2E in one session (standalone server + API suites + browser checks)
cd /home/z/my-project
PORT=3102 bun .next/standalone/server.js > prod.log 2>&1 &
SVPID=$!
sleep 6

echo "═══ API SUITES (production :3102) ═══"
BASE_URL=http://localhost:3102 node scripts/e2e/api-test.js 2>&1 | tail -2
BASE_URL=http://localhost:3102 node scripts/e2e/new-endpoints-test.js 2>&1 | tail -2
BASE_URL=http://localhost:3102 node scripts/e2e/t16-endpoints-test.js 2>&1 | tail -2
BASE_URL=http://localhost:3102 python3 scripts/e2e/push-eval-test.py 2>&1 | tail -2

echo "═══ BROWSER (production) ═══"
agent-browser close 2>/dev/null
agent-browser open "http://localhost:3102/" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
agent-browser wait 2500

NAVJS='(() => { const nav = document.querySelector("header nav"); return [...nav.querySelectorAll("button")].length + " tabs | navs: " + document.querySelectorAll("nav").length; })()'
VERJS='(() => document.body.textContent.includes("v2.7") ? "v2.7 visible" : "VERSION MISSING")()'
echo "NAV: $(agent-browser eval "$NAVJS" 2>/dev/null)"
echo "VERSION: $(agent-browser eval "$VERJS" 2>/dev/null)"
echo "SW: $(curl -s http://localhost:3102/sw.js | grep -o 'egx-desk-v3' | head -1)"

agent-browser open "http://localhost:3102/?view=signals" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
agent-browser wait 4000
SIGJS='(() => ({ rows: document.querySelectorAll("table tbody tr").length, bias: document.body.textContent.includes("ميل السوق الفني"), chips: document.body.textContent.includes("شراء قوي") }) => JSON.stringify({rows, bias, chips}))()'
echo "SIGNALS: $(agent-browser eval "$SIGJS" 2>/dev/null)"
agent-browser screenshot /home/z/my-project/scripts/data-test/t16-prod-signals.png >/dev/null 2>&1

agent-browser open "http://localhost:3102/?view=agent" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
agent-browser wait 2500
AGJS='(() => ({ title: document.body.textContent.includes("مساعد EGX ديسك الذكي"), input: !!document.querySelector("form input"), suggest: document.body.textContent.includes("ما حالة السوق الآن؟") }) => JSON.stringify({title, input, suggest}))()'
echo "AGENT VIEW: $(agent-browser eval "$AGJS" 2>/dev/null)"

# real agent chat on production
agent-browser find role textbox fill --name "اسأل عن أي شيء في البورصة المصرية…" "ما سعر COMI؟" >/dev/null 2>&1
agent-browser find role button click --name "إرسال" >/dev/null 2>&1
sleep 30
ANSJS='(() => { const b = document.querySelectorAll(".agent-md"); return b.length + " answer(s), last len=" + (b.length ? b[b.length-1].textContent.length : 0); })()'
echo "AGENT CHAT: $(agent-browser eval "$ANSJS" 2>/dev/null)"
agent-browser screenshot /home/z/my-project/scripts/data-test/t16-prod-agent.png >/dev/null 2>&1

# bell popover + phone section
agent-browser open "http://localhost:3102/" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
agent-browser wait 2000
agent-browser find role button click --name "التنبيهات والتذكيرات" >/dev/null 2>&1
agent-browser wait 1200
POPJS='(() => { const p = document.querySelector("[data-radix-popper-content-wrapper]"); return p ? (p.textContent.includes("إشعارات الهاتف") ? "phone section present" : "phone section MISSING") : "POPOVER MISSING"; })()'
echo "BELL: $(agent-browser eval "$POPJS" 2>/dev/null)"

ERRN=$(agent-browser errors 2>/dev/null | grep -c 'Error')
echo "PAGE ERRORS: ${ERRN:-0}"
kill $SVPID 2>/dev/null
echo "── server stopped ──"
