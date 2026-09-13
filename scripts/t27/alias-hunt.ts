const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const BROKEN = [
["QNBE","Qatar National Bank"],["EGS385S1C012","Ferchem Misr Co. for Fertilizers & Chemicals"],["VLMRA","Valmore Holding"],["VLMR","Valmore Holding"],
["IRAX","El Ezz Aldekhela Steel-Alexandria"],["VALU","U Consumer Finance S.A.E"],["TAQA","TAQA Arabia"],["UBEE","United Bank SAE"],
["CPME","Catalyst Partners Middle East"],["GTHE","Global Telecom Holding S.A.E."],["BONY","Bonyan for Development and Trade"],["GOUR","Gourmet Egypt.Com Foods"],
["ACAP","A Capital Holding"],["SUCE","Suez Cement Co."],["NBKE","National Bank of Kuwait - Egypt"],["EGS3E071C013-EGP","Acrow Misr"],
["ALEX","Alexandria Cement Co."],["CRST","Creast Mark For Contracting And Real Estate Development"],["ACTF","Act Financial"],["GPIM","GPI For Urban Growth"],
["NCGC","Nile Cotton Ginning"],["NARE","Naeem Real Estate Holding Group"],["KRDI","Al Khair River for Development Agriculture Investment and Environmental Services"],
["AIH","Arabia Investments Holding SAE"],["SMPP","Modern Shorouk Printing & Packaging"],["AMII","Arabian Metal Industries and Industrial Investments"],
["PACH","Paints & Chemical Industries Co."],["TANM","Tanmiya for Real Estate Investment"],["FCMD","Future Care For Medical Industries"],
["TYCN","Tycoon Holding Company For Financial Investments"],["DCRC","Delta Construction & Rebuilding Co."],["LKGP","The Holding Company for Financial Investment - The Lakah Group"],
["UTOP","Utopia Real Estate Investment & Tourism SAE"],["EGS30AJ1C016-EGP","International Dry Ice Co."],["VERT","Vertika for Industry & Trade"],
["EGS65621C012","El Nasr Housing & Egp5"],["ANCC","ALNAHDA Industrial Co."],["APPC","Advanced Pharmaceutical Packaging Co."],["EFAC","Egyptian Ferro All Egp10"],
["EGS72L31C011","SOLARSOL For Energy"],["ACFR","Alexandria Company For Refractories"],["EGS659O1C015","Misr Kuwait Investment & Trading Co."],
["EGWA","General Warehouses of Egypt"],["HBCO","Heibco Npv"],["EEP","Egypt Education Platform - EEP"],["GEOS","Geos for trading and contracting"],
["ALXD","Alexandria For Investment and Urban Development"],["MLIC","Misr Life Insurance"],["EITP","Egyptian International Tourism Projects"],
["ADRI","Arab Development & Real Estate Investment"],["PHGC","Premium Healthcare Group"],["CID","Chemical Development Industries (CID)"],
["EGS65101C015","National Investment & Reconstruction"],["KORA","KORRA"],["UPMS","Union Pharmacist Company For Medical Services And Investment"],
["SINA","Sinai Manganese Company"],["WATP","Modern Co. for Water Proofing"],["TOUR","Tourism Urbanization"],["POCO","Port Said Container And Cargo Handling"],
["NMIN","El Nasr Mining Co Egp10"],["PMSC","Petroleum Marine Services Company"],["EGS220N1C016","ALNASR For Building And Construction Company"],
["EGOTH","El Masreyah Touris Egp100"],["MITR","Misr Travel&Touris Egp6"],["GROV","Grova Special Purpose Acquisition Company"],
["GTEX","G-TEX for Commercial and Industrial Investments S.A.E"],["DGTZ","Digitize for Investment And Technology"],
["MMHC","El Mamoura Company For Construction & Tourism Development"],["SIEG","Egyptian Company for Pipes and Cement Products -Siegwart"],
["GGRN","Gogreen for Agricultural Investment and Development Company"],["OCAP","OG Capital For Investments SPAC"],["TWSA","Tawasoa Factoring"],
["NFCI","ELNASR Co For Fertilizers And Chemical Industries"],["TORA","Tourah Cement Co"],["HDST","HEDGESTONE INVESTMENT"],
["ENPI","Engineering for the Petroleum and Process Industries"],["RMTV","Rowad Misr Tourism Investment"],["EGS370O1C013","National Printing"],
["EGS73M81C012","National Asset Management And Investment"],["SNFI","Souhag National Food Industries"],["YAYT","Spring & Transportation Needs Manufacturing Co."],
["ELAB","Egyptian Linear Alkyl Benzene Company"],["EGS65861C014","Egyptian Contracting Co.-AL- ABD"],["AIDC","Arabia for Investment and Development"],
["EGS48271C018-EGP","Egypt - South Africa for Communication"],["KNGC","EL- Nasr Glass And Crystal"]
];
async function bars(sym: string) {
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=2y&interval=1d`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return 0;
    const j = await r.json() as any;
    return j?.chart?.result?.[0]?.timestamp?.length ?? 0;
  } catch { return 0; }
}
async function search(name: string): Promise<{ symbol?: string; shortname?: string; exchange?: string }[]> {
  try {
    // strip ticker-ish noise from names for better match
    const q = name.replace(/\s*-\s*Egp\d+\s*$/i, "").replace(/ S\.?A\.?E\.?$/i, "").replace(/ Co\.?$/i, " Company").replace(/&/g, "and").trim();
    const r = await fetch(`https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0&enableFuzzyQuery=false`, {
      headers: { "User-Agent": UA, Accept: "application/json,text/plain,*/*", "Accept-Language": "en-US,en;q=0.9", Referer: "https://finance.yahoo.com/" },
      signal: AbortSignal.timeout(8000),
    });
    const j = await r.json() as any;
    return (j?.quotes ?? []).filter((x: any) => String(x.symbol || "").endsWith(".CA") || x.exchange === "CAI");
  } catch { return []; }
}
async function main() {
  const resolved: Record<string, string> = {};
  const failed: string[] = [];
  for (const [t, name] of BROKEN) {
    const hits = await search(name);
    let best: string | null = null;
    let bestBars = 0;
    for (const h of hits) {
      const n = await bars(h.symbol);
      if (n > bestBars) { bestBars = n; best = h.symbol; }
    }
    if (best && bestBars >= 2) { resolved[t] = best; console.log(`OK  ${t} → ${best} (${bestBars} bars)`); }
    else { failed.push(t); console.log(`NO  ${t} "${name}" (${hits.length} hits, bestBars=${bestBars})`); }
    await new Promise(r => setTimeout(r, 250));
  }
  console.log(`\nResolved: ${Object.keys(resolved).length}/${BROKEN.length}`);
  console.log("Failed:", failed.join(", "));
  require("fs").writeFileSync("scripts/t27/yahoo-aliases.json", JSON.stringify(resolved, null, 2));
  console.log("Saved → scripts/t27/yahoo-aliases.json");
}
main().catch(e => console.error(e.message));
