/** T69 probe — POST /api/agent with a market question, capture the SSE
 *  event TYPES + think char counts live, to verify: (a) all_signals fan-out
 *  runs, (b) reasoning streams (think events), (c) final answer length. */
const body = JSON.stringify({
  messages: [{ role: "user", content: "ما حالة السوق الآن؟" }],
  lang: "ar",
});

const res = await fetch("http://localhost:3000/api/agent", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body,
});

const counts = { step: 0, think: 0, thinkChars: 0, delta: 0, deltaChars: 0, status: 0 };
const tools = [];
let done = null;
const statuses = [];

const reader = res.body.getReader();
const dec = new TextDecoder();
let buf = "";
for (;;) {
  const { done: rd, value } = await reader.read();
  if (rd) break;
  buf += dec.decode(value, { stream: true });
  let nl;
  while ((nl = buf.indexOf("\n\n")) !== -1) {
    const frame = buf.slice(0, nl);
    buf = buf.slice(nl + 2);
    const line = frame.split("\n").find((l) => l.startsWith("data:"));
    if (!line) continue;
    try {
      const j = JSON.parse(line.slice(5).trim());
      if (j.type === "step") { counts.step++; tools.push(j.tool); }
      else if (j.type === "think") { counts.think++; counts.thinkChars += (j.text ?? "").length; }
      else if (j.type === "delta") { counts.delta++; counts.deltaChars += (j.text ?? "").length; }
      else if (j.type === "status") { counts.status++; statuses.push(j.note?.slice(0, 60)); }
      else if (j.type === "done") { done = j; }
      else if (j.type === "error") { console.log("ERROR EVENT:", j); }
    } catch {}
  }
}
console.log(JSON.stringify({
  counts,
  tools,
  statuses,
  answerChars: done?.answer?.length ?? 0,
  thinkingCharsOnDone: done?.thinking?.length ?? 0,
  model: done?.model,
  answerHead: done?.answer?.slice(0, 200),
}, null, 2));
