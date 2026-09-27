/** T69 probe — parallel tool batch: ask a question that needs several
 *  tools at once and verify the model emits {"tools":[...]} (or that the
 *  loop executes multiple tools in one round). */
const body = JSON.stringify({
  messages: [{ role: "user", content: "أعطني كل إشارات سهم COMI من كل الأدوات في وقت واحد" }],
  lang: "ar",
});
const res = await fetch("http://localhost:3000/api/agent", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body,
});
const tools = [];
let done = null;
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
      if (j.type === "step") tools.push(j.tool);
      if (j.type === "done") done = j;
    } catch {}
  }
}
console.log(JSON.stringify({
  toolSequence: tools,
  answerChars: done?.answer?.length ?? 0,
  model: done?.model,
  head: done?.answer?.slice(0, 160),
}, null, 2));
