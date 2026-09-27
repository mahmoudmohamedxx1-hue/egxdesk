#!/bin/bash
# T66 probe: vet freellmpool's keyless providers for the agent's failover pool.
# Each candidate gets a tiny bilingual completion; success = non-empty content.
BODY_TMPL='{"model":"%s","messages":[{"role":"user","content":"Reply with exactly: OK"}],"max_tokens":10,"temperature":0}'

probe () {
  local name="$1" url="$2" model="$3"; shift 3
  local t0=$(date +%s)
  local out
  out=$(curl -s --max-time 30 -X POST "$url" -H "Content-Type: application/json" "$@" \
        -d "$(printf "$BODY_TMPL" "$model")" 2>&1)
  local t1=$(date +%s)
  local content
  content=$(echo "$out" | python3 -c "
import json,sys
try:
    d=json.load(sys.stdin)
    c=d.get('choices',[{}])[0].get('message',{}).get('content','')
    print(('OK: '+repr(c[:60])) if c else 'EMPTY content')
except Exception as e:
    txt=sys.stdin.read() if False else ''
    print('NOT-JSON: '+str(sys.stdin)[:0])
" 2>/dev/null)
  if [ -z "$content" ] || [[ "$content" == NOT-JSON* ]]; then
    content=$(echo "$out" | head -c 120 | tr -d '\n')
  fi
  printf "%-42s %2ds  %s\n" "$name" "$((t1-t0))" "$content"
}

echo "=== KILO GATEWAY (keyless, 200 req/hr/IP) ==="
probe "kilo openrouter/free"            "https://api.kilo.ai/api/gateway/v1/chat/completions" "openrouter/free"
probe "kilo stepfun/step-3.7-flash:free" "https://api.kilo.ai/api/gateway/v1/chat/completions" "stepfun/step-3.7-flash:free"
probe "kilo nvidia/nemotron-3-super"    "https://api.kilo.ai/api/gateway/v1/chat/completions" "nvidia/nemotron-3-super-120b-a12b:free"
probe "kilo tencent/hy3:free"           "https://api.kilo.ai/api/gateway/v1/chat/completions" "tencent/hy3:free"
probe "kilo liquid/lfm-2.5-2.6b:free"   "https://api.kilo.ai/api/gateway/v1/chat/completions" "liquid/lfm-2.5-2.6b:free"

echo "=== OPENCODE ZEN (keyless) ==="
probe "opencode ling-3.0-flash-fin-free" "https://opencode.ai/zen/v1/chat/completions" "ling-3.0-flash-fin-free"
probe "opencode deepseek-v4-flash-free"  "https://opencode.ai/zen/v1/chat/completions" "deepseek-v4-flash-free"

echo "=== OVH (keyless) ==="
probe "ovh mistral-small" "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions" "Mistral-Small-3.2-24B-Instruct"

echo "=== POLLINATIONS (keyless) ==="
probe "pollinations gpt-oss-20b" "https://text.pollinations.ai/openai" "gpt-oss-20b"

echo "=== LLM7 sanity ==="
probe "llm7 GLM-5.3-Flash" "https://api.llm7.io/v1/chat/completions" "GLM-5.3-Flash"
