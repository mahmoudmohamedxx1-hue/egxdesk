import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
const since = new Date(Date.now() - 14 * 86400000);
const rows = await db.newsPost.findMany({
  where: { publishedAt: { gte: since } },
  orderBy: { publishedAt: 'desc' },
  take: 5,
  select: { title: true, snippet: true, publishedAt: true },
});
console.log('rows in 14d window:', rows.length);
for (const r of rows) {
  console.log(' -', r.publishedAt.toISOString(), '|', r.title.slice(0, 70));
}
const total = await db.newsPost.count();
console.log('total NewsPost:', total);
await db.$disconnect();
