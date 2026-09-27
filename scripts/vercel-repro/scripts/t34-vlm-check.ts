/** T34 VLM QA — visual verification of the fast-load refactor: shrunk logo
 *  crispness, lazy assistant popup, model menu, mobile shell. */
import ZAI from "z-ai-web-dev-sdk";
import { readFileSync } from "node:fs";

type Shot = { file: string; ask: string };
const SHOTS: Shot[] = [
  {
    file: "scripts/data-test/t34-home-fastload.png",
    ask: "This is an Arabic stock-market dashboard homepage (dark theme). Answer JSON {\"LOGO\":bool,\"LOGO_CRISP\":\"crisp\"|\"blurry\"|\"broken\",\"HEADER\":bool,\"INDICES\":bool,\"FOOTER\":bool,\"ISSUES\":\"none\" or a short note}. LOGO=EGX Desk logo with readable text at top-left rendered correctly; LOGO_CRISP=is the logo text sharp (not pixelated/stretched/broken image icon)? HEADER=header nav row with pills; INDICES=index stat cards with numbers; FOOTER=footer present.",
  },
  {
    file: "scripts/data-test/t34-assistant-lazy.png",
    ask: "This is an AI assistant popup on an Arabic market website. Answer JSON {\"PANEL\":bool,\"WELCOME\":bool,\"MODEL_CHIP\":bool,\"COMPOSER\":bool,\"CLIPPED\":bool,\"ISSUES\":\"none\" or short note}. PANEL=floating rounded dialog panel; WELCOME=welcome/title card visible; MODEL_CHIP=model selector chip (e.g. GLM-5.3) visible; COMPOSER=rounded input box at bottom; CLIPPED=any content cut off?",
  },
  {
    file: "scripts/data-test/t34-model-menu.png",
    ask: "This is a model-selector dropdown for an AI assistant. Answer JSON {\"MENU\":bool,\"GLM\":bool,\"MORE_MODELS\":bool,\"SIGNIN\":bool,\"ISSUES\":\"none\" or short note}. MENU=dropdown menu open; GLM=GLM model entries visible; MORE_MODELS=at least 3 distinct model names listed; SIGNIN=free account sign-in row visible.",
  },
  {
    file: "scripts/data-test/t34-mobile-home.png",
    ask: "This is the same Arabic stock-market dashboard at mobile width 390px. Answer JSON {\"HEADER_FITS\":bool,\"HORIZONTAL_OVERFLOW\":bool,\"LOGO\":bool,\"CONTENT\":bool,\"ISSUES\":\"none\" or short note}. HEADER_FITS=header icons fit in one row without overlap; HORIZONTAL_OVERFLOW=does any element overflow the viewport horizontally? LOGO=logo readable; CONTENT=content cards visible.",
  },
];

async function main() {
  const client = await ZAI.create();
  let pass = 0;
  let fail = 0;
  for (const s of SHOTS) {
    const b64 = readFileSync(s.file).toString("base64");
    try {
      const res = await client.chat.completions.createVision({
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: s.ask },
              { type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } },
            ],
          },
        ],
        thinking: { type: "disabled" },
      });
      const out = (res as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content ?? "";
      let ok = true;
      try {
        const j = JSON.parse(out.replace(/```json|```/g, "").trim());
        for (const [k, v] of Object.entries(j)) {
          const bad = v === false || v === "broken" || v === "blurry" || (k === "ISSUES" && v && v !== "none");
          if (bad) ok = false;
        }
        console.log(`${ok ? "PASS" : "FAIL"} ${s.file}\n  ${JSON.stringify(j)}`);
      } catch {
        ok = false;
        console.log(`FAIL ${s.file} — unparseable: ${out.slice(0, 200)}`);
      }
      ok ? pass++ : fail++;
    } catch (e) {
      console.log(`FAIL ${s.file} — ${String(e).slice(0, 120)}`);
      fail++;
    }
  }
  console.log(`\nT34 VLM: ${pass}/${pass + fail} pass`);
}

void main();
