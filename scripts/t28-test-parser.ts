/** T28 — lock in the tool-JSON parser against every observed output shape. */
import { parseToolJson } from "../src/lib/assistant-tools";

const cases: { name: string; input: string; want: unknown }[] = [
  { name: "classic envelope", input: '{"tool":"search","args":{"q":"Eastern Tobacco"}}', want: { tool: "search", args: { q: "Eastern Tobacco" } } },
  { name: "tool-as-key object (GLM)", input: '{"search":{"q":"Eastern Tobacco"}}', want: { tool: "search", args: { q: "Eastern Tobacco" } } },
  { name: "tool-as-key string", input: '{"open_view":"screener"}', want: { tool: "open_view", args: { view: "screener", q: "screener", ticker: "screener", name: "screener" } } },
  { name: "quote bare ticker", input: '{"quote":"COMI"}', want: { tool: "quote", args: { ticker: "COMI", q: "COMI", name: "COMI" } } },
  { name: "inline args next to tool", input: '{"tool":"open_view","view":"calendar"}', want: { tool: "open_view", args: { view: "calendar" } } },
  { name: "action key variant", input: '{"action":"watch_add","ticker":"COMI"}', want: { tool: "watch_add", args: { ticker: "COMI" } } },
  { name: "reply only", input: '{"reply":"Sure, which stock?"}', want: { reply: "Sure, which stock?" } },
  { name: "fenced json", input: "```json\n{\"tool\":\"movers\",\"args\":{}}\n```", want: { tool: "movers", args: {} } },
  { name: "think-block stripped", input: "<think>hmm</think>{\"tool\":\"movers\"}", want: { tool: "movers", args: {} } },
  { name: "prose around json", input: 'Here you go: {"tool":"quote","args":{"ticker":"HRHO"}} hope that helps', want: { tool: "quote", args: { ticker: "HRHO" } } },
  { name: "no json → null", input: "I cannot do that.", want: null },
  { name: "unknown tool-as-key → null", input: '{"dance":{"q":"x"}}', want: null },
];

let fail = 0;
const eqUnordered = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;
  const ka = Object.keys(a as object).sort();
  const kb = Object.keys(b as object).sort();
  if (JSON.stringify(ka) !== JSON.stringify(kb)) return false;
  return ka.every((k) => {
    const va = (a as Record<string, unknown>)[k];
    const vb = (b as Record<string, unknown>)[k];
    return typeof va === "object" && typeof vb === "object" ? eqUnordered(va, vb) : JSON.stringify(va) === JSON.stringify(vb);
  });
};
for (const c of cases) {
  const got = parseToolJson(c.input);
  const ok = eqUnordered(got, c.want);
  if (!ok) {
    fail++;
    console.log(`FAIL ${c.name}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(c.want)}`);
  } else {
    console.log(`ok   ${c.name}`);
  }
}
console.log(fail === 0 ? "ALL PARSER TESTS PASS" : `${fail} FAILURES`);
process.exit(fail === 0 ? 0 : 1);
