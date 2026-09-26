/** T67 — validation of the extended ownership merge:
 *  (1) the three reported duplicate pairs merge to ONE holder/position;
 *  (2) the T66 safety cases still hold (pension accounts, FERC family,
 *      CEFM/SCFM unions, زالدي);
 *  (3) zero duplicate (holder, company) positions; move ids in range. */
import rawNetwork from "../src/data/ownership-network.json";
import { mergeOwnershipNetwork } from "../src/lib/ownership-merge";

const net = rawNetwork as unknown as Parameters<typeof mergeOwnershipNetwork>[0];
const merged = mergeOwnershipNetwork(net);

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} — ${name}${detail ? ` (${detail})` : ""}`);
  if (!cond) failures++;
};

const findPerson = (needle: string) =>
  merged.people.findIndex((p) => p.n.includes(needle));

// ── 1) the three reported pairs ──
{
  // TWSA: all three spellings ("شركه ام جي سي…", "ام جيه سي…", "ام جيه سي… MJC")
  // → one holder, ONE position (latest filing 4.83% on 2026-08-31)
  const holders = merged.people.filter((p) => p.n.includes("ام جيه سي") || p.n.includes("ام جي سي"));
  check("TWSA MJC spellings merged to one holder", holders.length === 1, `holders=${holders.length}`);
  if (holders.length === 1) {
    const positions = merged.positions.filter((p) => p.h === (merged.people.indexOf(holders[0])) && p.t === "TWSA");
    check(
      "TWSA one position, latest filing kept (4.83%)",
      positions.length === 1 && Math.abs(positions[0].p - 4.83) < 0.001,
      positions.map((p) => `${p.p}% ${p.a}`).join(", ")
    );
    check("TWSA alts recorded", (holders[0].alts ?? []).length >= 1, JSON.stringify(holders[0].alts));
  }

  // NIPH: اورينت تورز word-order pair → one holder, latest 1.64%
  const ot = merged.people.filter((p) => p.n.includes("اورينت تورز"));
  check("NIPH orient-tours pair merged to one holder", ot.length === 1, `holders=${ot.length} → ${ot.map((p) => p.n).join(" | ")}`);
  if (ot.length === 1) {
    const idx = merged.people.indexOf(ot[0]);
    const positions = merged.positions.filter((p) => p.h === idx && p.t === "NIPH");
    check(
      "NIPH one position, latest kept (1.64%)",
      positions.length === 1 && Math.abs(positions[0].p - 1.64) < 0.001,
      positions.map((p) => `${p.p}% ${p.a}`).join(", ")
    );
  }

  // EGAL: the trailing-stray-digit variants (۳/٣/٤/٥) absorbed into the clean
  // fund; what remains beside it are the GENUINE حساب ٦ / حساب ٧ accounts
  const eg = merged.people.filter((p) => p.n.includes("للعاملين بالقطاع الحكومي"));
  check(
    "EGAL government-sector fund: stray-digit variants absorbed (clean + حساب٦ + حساب٧ only)",
    eg.length === 3,
    `holders=${eg.length} → ${eg.map((p) => p.n).join(" | ")}`
  );
  check("EGAL no stray trailing digits remain", eg.every((p) => !/(?:^|\s)[0-9]{1,2}$/.test(p.n) || /حساب/.test(p.n)));
  // the OTHER fund (بقطاع الأعمال العام والخاص) must stay separate
  const biz = merged.people.filter((p) => p.n.includes("بقطاع الأعمال العام والخاص"));
  check("EGAL business-sector fund stays separate", biz.length >= 1 && !biz.some((p) => p.n.includes("الحكومي")));
}

// ── 2) T66 safety cases ──
{
  // pension accounts (حساب + digit) stay separate — Arabic-Indic digits too
  const pension = merged.people.filter((p) => /حساب|رقم/.test(p.n) && /[0-9\u0660-\u0669\u06F0-\u06F9]/.test(p.n));
  console.log(`  pension/account-number people: ${pension.length} → ${pension.slice(0, 8).map((p) => p.n).join(" | ")}`);
  check("pension account rows exist and stayed separate (≥2)", pension.length >= 2);

  // FERC الجبلي family stays separate (different first names)
  const family = merged.people.filter((p) => p.n.includes("الجبلي") || p.n.includes("الجبلى"));
  check("FERC الجبلي family members stayed separate (≥4)", family.length >= 4, `count=${family.length}`);

  // CEFM vs SCFM unions separate
  const cefm = merged.people.filter((p) => /CEFM/i.test(p.n));
  const scfm = merged.people.filter((p) => /SCFM/i.test(p.n));
  check("CEFM and SCFM unions separate", cefm.length >= 1 && scfm.length >= 1 && cefm.every((c) => !scfm.includes(c)));

  // زالدي still merged (the exact spelling family, not the عزالدين person)
  const zaldi = merged.people.filter((p) => /^زالدي(\s|$)/.test(p.n) || /^زالدي للاستثمار/.test(p.n));
  check("زالدي variants still merged to one", zaldi.length === 1, zaldi.map((p) => `${p.n}${p.alts ? ` [alts: ${p.alts.join(" / ")}]` : ""}`).join(" | "));
}

// ── 3) global invariants ──
{
  const keys = new Set<string>();
  let dups = 0;
  for (const p of merged.positions) {
    const k = `${p.h}|${p.t}`;
    if (keys.has(k)) dups++;
    keys.add(k);
  }
  check("zero duplicate (holder, company) positions", dups === 0, `dups=${dups}`);

  const nPeople = merged.people.length;
  let outOfRange = 0;
  for (const per of merged.periods) {
    for (const m of per.m) {
      if (m.h < 0 || m.h >= nPeople) outOfRange++;
    }
  }
  check("all move holder ids in range", outOfRange === 0, `bad=${outOfRange}`);

  console.log(
    `\npeople: ${net.people.length} → ${merged.people.length} (merged variants: ${merged.mergedVariants}, groups: ${merged.mergedGroups}); positions: ${net.positions.length} → ${merged.positions.length}`
  );
}

process.exit(failures > 0 ? 1 : 0);
