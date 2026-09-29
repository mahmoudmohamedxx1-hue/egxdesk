#!/bin/bash
# T75 browser audit — sweep every view, capture console/page errors + screenshots
cd /home/z/my-project
VIEWS="home market screener signals today disclosures crossings heat sectors investors activity calendar funds compare gcc lab reports valuation pairs world exchange scenarios fragility research tools watchlist paper"
mkdir -p scripts/qa/t75
for v in $VIEWS; do
  agent-browser console --clear >/dev/null 2>&1
  agent-browser open "http://localhost:3000/?view=$v&lang=en" >/dev/null 2>&1
  agent-browser wait --load networkidle >/dev/null 2>&1
  sleep 3
  agent-browser screenshot "scripts/qa/t75/$v.png" >/dev/null 2>&1
  ERRS=$(agent-browser errors 2>/dev/null | grep -cE "^\[error\]" || true)
  CERRS=$(agent-browser console 2>/dev/null | grep -cE "^\[error\]" || true)
  CLONE=$(agent-browser eval "document.body.innerText.length" 2>/dev/null | tail -1)
  echo "$v: pageErrors=$ERRS consoleErrors=$CERRS textLen=$CLONE"
done
