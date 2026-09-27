#!/usr/bin/env python3
"""Daemonize the Next.js dev server (port 3000) with a double-fork so the
final process is re-parented to PID 1 — the only launch pattern that
survives the bash tool's post-call process cleanup in this sandbox."""

import os
import sys

PROJECT = "/home/z/my-project"
LOG = os.path.join(PROJECT, "dev.log")

if os.fork() > 0:
    sys.exit(0)
os.setsid()
if os.fork() > 0:
    sys.exit(0)

os.chdir(PROJECT)
f = open(LOG, "a", buffering=1)
os.dup2(f.fileno(), 1)
os.dup2(f.fileno(), 2)
os.execvp(
    "bash",
    ["bash", "-c", "exec ./node_modules/.bin/next dev -p 3000"],
)
