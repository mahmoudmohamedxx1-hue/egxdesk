/** One-time VAPID keypair generator for EGX Desk web push (G1 mobile).
 *  Writes server-secrets/vapid.json — loaded only by the server (lib/push.ts);
 *  the PUBLIC half is served to clients via GET /api/push/key. */
/* eslint-disable @typescript-eslint/no-require-imports */
const webpush = require("web-push");
const fs = require("node:fs");
const path = require("node:path");

const keys = webpush.generateVAPIDKeys();
const dir = path.join(__dirname, "..", "server-secrets");
fs.mkdirSync(dir, { recursive: true });
const out = path.join(dir, "vapid.json");
fs.writeFileSync(out, JSON.stringify({ publicKey: keys.publicKey, privateKey: keys.privateKey }, null, 2));
console.log("VAPID keys written to", out);
console.log("publicKey:", keys.publicKey);
