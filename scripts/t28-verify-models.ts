import { FEATURED_MODELS } from "../src/lib/assistant-models";
/** Verify FEATURED_MODELS ids exist in @mlc-ai/web-llm@0.2.85 prebuiltAppConfig. */
import * as webllmNS from "@mlc-ai/web-llm";
const webllm: typeof webllmNS = (webllmNS as { default?: typeof webllmNS }).default ?? webllmNS;

const ids = new Set(webllm.prebuiltAppConfig.model_list.map((m) => m.model_id));
const chat = webllm.prebuiltAppConfig.model_list.filter((m) => !/embed/i.test(m.model_id));
console.log("registry total:", webllm.prebuiltAppConfig.model_list.length, "chat:", chat.length);
let bad = 0;
for (const f of FEATURED_MODELS) {
  const ok = ids.has(f.id);
  if (!ok) bad++;
  console.log(`${ok ? "OK " : "BAD"} ${f.id}`);
}
console.log(bad === 0 ? "ALL FEATURED VALID" : `${bad} INVALID IDS`);
process.exit(bad === 0 ? 0 : 1);
