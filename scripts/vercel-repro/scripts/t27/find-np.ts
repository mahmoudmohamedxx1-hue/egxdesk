import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
async function main() {
  const cols = await p.$queryRawUnsafe("PRAGMA table_info(Company)") as { name: string }[];
  console.log("Company columns:", cols.map((c) => c.name).join(", "));
  const cos = await p.$queryRawUnsafe("SELECT ticker, nameEn, nameAr FROM Company WHERE nameEn LIKE '%rint%' OR nameAr LIKE '%طباع%'") as any[];
  console.log("DB matches:", JSON.stringify(cos, null, 1));
}
main().catch(e => console.error(e.message)).finally(() => p.$disconnect());
