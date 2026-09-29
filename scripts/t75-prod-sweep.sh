#!/bin/bash
# T75 production audit sweep — every view, EN + AR, errors + text length
cd /home/z/my-project
BASE="http://localhost:3100"
VIEWS="home market screener signals agent today disclosures crossings heat lens sectors investors activity calendar funds compare gcc lab reports valuation pairs world exchange scenarios fragility research tools watchlist paper"
for lang in en ar; do
  echo "── lang=$lang ──"
  for v in $VIEWS; do
    agent-browser console --clear >/dev/null 2>&1
    agent-browser open "$BASE/?view=$v&lang=$lang&s=$RANDOM" >/dev/null 2>&1
    agent-browser wait --load networkidle >/dev/null 2>&1
    sleep 2
    CERRS=$(agent-browser console 2>/dev/null | grep -cE "^\[error\]" || true)
    CLONE=$(agent-browser eval "document.body.innerText.length" 2>/dev/null | tail -1)
    # flag thin views (< 300 chars likely error/empty)
    FLAG=""
    if [ "${CLONE:-0}" -lt 300 ] 2>/dev/null; then FLAG=" ⚠️THIN"; fi
    if [ "${CERRS:-0}" -gt 0 ] 2>/dev/null; then FLAG="$FLAG ⚠️ERR"; fi
    echo "$v: errs=$CERRS len=$CLONE$FLAG"
  done
done
