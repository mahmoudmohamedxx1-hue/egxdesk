#!/usr/bin/env bash
# T39 — browser sweep: every view, capture text + errors + screenshot
cd /home/z/my-project
mkdir -p scripts/data-test/t39
VIEWS="home market screener signals today company agent watchlist heat sectors calendar tools compare exchange activity investors funds gcc lab reports paper api"
for v in $VIEWS; do
  agent-browser open "http://localhost:3000/?view=$v&lang=ar" >/dev/null 2>&1
  sleep 4
  agent-browser wait --load networkidle >/dev/null 2>&1
  agent-browser errors > scripts/data-test/t39/err-$v.txt 2>&1
  agent-browser eval "document.body.innerText.length" > scripts/data-test/t39/len-$v.txt 2>&1
  agent-browser screenshot scripts/data-test/t39/ar-$v.png >/dev/null 2>&1
  echo "[$v] len=$(cat scripts/data-test/t39/len-$v.txt) err=$(wc -c < scripts/data-test/t39/err-$v.txt)"
done
echo "DONE"