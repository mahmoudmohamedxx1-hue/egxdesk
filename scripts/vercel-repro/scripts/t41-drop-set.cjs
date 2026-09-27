/* eslint-disable @typescript-eslint/no-require-imports */
const { PrismaClient } = require('/home/z/my-project/node_modules/.prisma/client');
const db = new PrismaClient();
(async () => {
  const rows = await db.aiSignalSet.findMany({ orderBy: { createdAt: 'desc' }, take: 1 });
  if (rows.length) {
    await db.aiSignalSet.deleteMany({ where: { id: rows[0].id } });
    console.log('dropped set', rows[0].id, 'created', rows[0].createdAt.toISOString());
  } else console.log('no sets to drop');
  await db.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
