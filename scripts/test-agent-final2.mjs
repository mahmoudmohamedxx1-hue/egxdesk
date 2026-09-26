const body = JSON.stringify({ messages: [{ role: "user", content: "أعلى ٣ أسهم توزيعات؟" }], lang: "ar", model: "llm7:GLM-5.3-Flash" });
const res = await fetch("http://localhost:3000/api/agent", { method: "POST", headers: { "content-type": "application/json" }, body });
const reader = res.body.getReader();
const dec = new TextDecoder();
let buf = "", events = [];
outer: for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  buf += dec.decode(value, { stream: true });
  let nl;
  while ((nl = buf.indexOf("\n\n")) !== -1) {
    const frame = buf.slice(0, nl); buf = buf.slice(nl + 2);
    for (const line of frame.split("\n")) {
      if (!line.startsWith("data:")) continue;
      try { const e = JSON.parse(line.slice(5).trim()); events.push(e); if (e.type === "done" || e.type === "error") break outer; } catch {}
    }
  }
}
const done = events.find((e) => e.type === "done");
const statuses = events.filter((e) => e.type === "status").map((e) => e.note);
const thinks = events.filter((e) => e.type === "think");
const meta = events.find((e) => e.type === "meta");
console.log("meta engine:", meta?.engine, "| statuses:", JSON.stringify(statuses));
console.log("served model:", done?.model, "| thinkChars:", thinks.reduce((a,e)=>a+(e.text?.length||0),0), "| answerLen:", done?.answer?.length || 0);
