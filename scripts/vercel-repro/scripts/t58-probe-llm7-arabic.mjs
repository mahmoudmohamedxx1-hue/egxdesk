#!/usr/bin/env node
/** T58 — probe LLM7.io keyless models for ARABIC quality.
 *  Same anonymous call shape as llm7Round() in the agent route (no auth header,
 *  stream:true). Asks a market question in Arabic; scores the reply on:
 *   - arabicRatio: Arabic letters / (Arabic + Latin letters)
 *   - exotic: any Telugu/Thai/Devanagari/Hangul/CJK/Cyrillic/Greek chars
 *   - length, latency
 */
const MODELS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["GLM-5.3-Flash", "gpt-5.5", "gemini-3.7-flash", "minimax-m2.7", "mistral-Small-24B-Instruct-2501", "mistral-Nemo-Instruct-2407"];

const AR = /[\u0600-\u06FF]/g;
const LAT = /[A-Za-z]/g;
const EXOTIC = /[\u0900-\u097F\u0E00-\u0E7F\uAC00-\uD7AF\u3040-\u30FF\u4E00-\u9FFF\u0400-\u04FF\u0370-\u03FF]/;

const sys = `أنت وكيل ذكاء اصطناعي مالي للبورصة المصرية. أجب دائمًا بالعربية الفصحى فقط.
مهم جدًا: كل الجواب يجب أن يكون بالعربية. لا تكتب بالبرتغالية أو الإسبانية أو الفرنسية أو أي لغة أخرى أبدًا.
اكتب أسماء الأسهم بالرموز اللاتينية (مثل COMI وEGX30) كما هي فقط.`;

const user = `ما حالة سوق الأوراق المالية المصرية الآن؟ أعطِ خلاصة قصيرة (3 جمل) تتضمن مستوى EGX30 ومستوى التداول وقوة الجنيه.`;

function consume(res) {
  return new Promise((resolve, reject) => {
    const dec = new TextDecoder();
    let buf = "";
    let text = "";
    let served = "";
    res.body.on("data", (c) => {
      buf += dec.decode(c, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const j = JSON.parse(payload);
          if (j.model) served = j.model;
          const d = j.choices?.[0]?.delta?.content ?? j.choices?.[0]?.message?.content ?? "";
          if (d) text += d;
        } catch {}
      }
    });
    res.body.on("end", () => resolve({ text, served }));
    res.body.on("error", reject);
  });
}

(async () => {
  for (const m of MODELS) {
    const t0 = Date.now();
    try {
      const res = await fetch("https://api.llm7.io/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: m,
          stream: true,
          messages: [
            { role: "system", content: sys },
            { role: "user", content: user },
          ],
        }),
      });
      if (!res.ok) {
        const b = await res.text().catch(() => "");
        console.log(`✗ ${m}: HTTP ${res.status} ${b.slice(0, 90)}`);
        continue;
      }
      const { text, served } = await consume(res);
      const ar = (text.match(AR) || []).length;
      const lat = (text.match(LAT) || []).length;
      const ratio = ar + lat > 0 ? ar / (ar + lat) : 0;
      const exotic = EXOTIC.test(text);
      console.log(`\n=== ${m} (served: ${served || "?"}) ===`);
      console.log(
        `  len=${text.length} arabicRatio=${ratio.toFixed(2)} exotic=${exotic} ${((Date.now() - t0) / 1000).toFixed(1)}s`
      );
      console.log("  " + text.slice(0, 260).replace(/\n/g, " ⏎ "));
    } catch (e) {
      console.log(`✗ ${m}: ${e.message}`);
    }
  }
})();
