#!/usr/bin/env python3
"""Daemonize the refresh daemon with a double-fork so the final process is
re-parented to PID 1 — the only launch pattern that survives the bash tool's
post-call process cleanup in this sandbox (same pattern as
start-dev-daemon.py)."""

import os
import sys

PROJECT = "/home/z/my-project"
LOG = os.path.join(PROJECT, "scripts", "refresh-daemon.log")

if os.fork() > 0:
    sys.exit(0)
os.setsid()
if os.fork() > 0:
    sys.exit(0)

os.chdir(PROJECT)
os.environ["REFRESH_DAEMON_REDIRECTED"] = "1"  # log() must not double-append
f = open(LOG, "a", buffering=1)
os.dup2(f.fileno(), 1)
os.dup2(f.fileno(), 2)
os.execvp(
    "node",
    ["node", "scripts/refresh-daemon.mjs"],
)
