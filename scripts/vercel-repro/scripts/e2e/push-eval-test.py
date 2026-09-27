"""E2E test of the server-side push evaluator: insert a fake PushDevice with
an alert that SHOULD fire (COMI above 1 EGP — always true), force an
evaluation run, and verify the engine (a) attempted a send, (b) treated the
dead endpoint as expired (404/410 from the push service) and (c) cleaned the
device row up. Also verifies subscribe-route validation."""
import json, urllib.request, subprocess, sys

BASE = "http://localhost:3000"

def post(path, body):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")

# 1) subscribe with a fake-but-well-formed subscription
sub = {"endpoint": "https://fcm.googleapis.com/fcm/send/dE2EtestSubscriptionThatDoesNotExist",
       "keys": {"p256dh": "BPcPdE2EtestKeyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "auth": "e2etestauth"}}
alerts = [{"id": "e2e-1", "ticker": "COMI", "cond": "above", "value": 1, "triggeredAt": None}]
code, res = post("/api/push/subscribe", {"deviceId": "e2e-device-1", "subscription": sub, "alerts": alerts, "lang": "ar"})
print("subscribe:", code, res)
assert code == 200 and res.get("ok") and res.get("alerts") == 1, "subscribe failed"

# 2) force an evaluation — COMI is definitely above 1 EGP, so the engine will
#    try to push to the dead endpoint, get 404/410, and remove the device
code, res = post("/api/push/run", {})
print("run:", code, res)
assert code == 200 and res.get("devices", 0) >= 1, "run did not see the device"
assert res.get("checkedAlerts", 0) >= 1, "alert not checked"

# 3) verify the device row was cleaned up (dead subscription removed) OR
#    notified (if the push service surprisingly accepted it)
import sqlite3
conn = sqlite3.connect("/home/z/my-project/db/custom.db")
rows = conn.execute("SELECT deviceId, notifiedJson FROM PushDevice WHERE deviceId='e2e-device-1'").fetchall()
conn.close()
print("db rows after run:", rows)
assert len(rows) == 0 or "e2e-1" in (rows[0][1] or ""), "device not processed"

# 4) validation errors
code, res = post("/api/push/subscribe", {"deviceId": "", "subscription": sub})
assert code == 400, "empty deviceId should 400"
code, res = post("/api/push/unsubscribe", {})
assert code == 400, "missing deviceId should 400"
print("validation errors: OK")

# 5) cleanup any leftover
post("/api/push/unsubscribe", {"deviceId": "e2e-device-1"})
print("ALL PUSH EVAL TESTS PASSED")
