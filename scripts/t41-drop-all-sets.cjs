/* eslint-disable @typescript-eslint/no-require-imports */
const { PrismaClient } = require('/home/z/my-project/node_modules/.prisma/client');
const db = new PrismaClient();
(async () => {
  const r = await db.aiSignalSet.deleteMany({});
  console.log('dropped', r.count, 'sets');
  await db.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
