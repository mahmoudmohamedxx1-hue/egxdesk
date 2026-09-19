"use client";

/** T47/T48 — the Supabase ACCOUNT: a header button + sign-in dialog for the
 *  website's real server-side auth. Email → Supabase emails a 6-digit code →
 *  verify → an HttpOnly session cookie. The browser NEVER sees a key, a JWT,
 *  or a refresh token — only {id, email} of its own user.
 *
 *  T48 security wiring (the anti-bot / anti-temp-mail layer lives on the
 *  server; this component carries its client half):
 *    • a challenge token is fetched when the dialog OPENS and echoed with
 *      every POST (single-use, server-bound — a raw scripted POST fails);
 *    • an invisible honeypot field rides along (bots autofill it → refused);
 *    • the dialog's open timestamp rides along (sub-1.5s submits → refused);
 *    • a trusted browser shows the OWNER QUICK SIGN-IN button (one click,
 *      no code, no email) — and the owner's own email skips the email send
 *      entirely (server answers adminFast and we finish via admin-signin);
 *    • the signed-in owner wears an "Owner" badge.
 *
 *  Honest by construction: every failure state (rate limit, wrong code,
 *  challenge expiry, network) renders its real message. */

import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "./app-context";
import { T, tt } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CircleUserRound, Crown, Loader2, LogIn, LogOut, Mail, ShieldCheck, Zap } from "lucide-react";

type Me = {
  signedIn: boolean;
  user: { id: string; email: string | null } | null;
  isAdmin?: boolean;
  trustedAdmin?: boolean;
};

export function SupabaseAccount() {
  const { lang, toast } = useApp();
  const [me, setMe] = useState<Me | null>(null);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const cooldownTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // T48: the anti-bot handshake state
  const challengeRef = useRef<string>("");
  const [challengeReady, setChallengeReady] = useState(false);
  const openedAtRef = useRef<number>(0);
  const honeypotRef = useRef<HTMLInputElement | null>(null);
  const [hp, setHp] = useState("");

  useEffect(() => {
    let alive = true;
    fetch("/api/auth/supabase/me", { cache: "no-store" })
      .then((r) => r.json() as Promise<Me>)
      .then((d) => {
        if (alive) setMe(d);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // fetch a fresh challenge whenever the dialog opens (and re-arm on expiry)
  const fetchChallenge = useCallback(async () => {
    setChallengeReady(false);
    try {
      const res = await fetch("/api/auth/supabase/challenge", { cache: "no-store" });
      const d = (await res.json()) as { ok: boolean; token?: string };
      if (d.ok && d.token) {
        challengeRef.current = d.token;
        setChallengeReady(true);
      }
    } catch {
      /* offline — the POST will fail honestly with its own message */
    }
  }, []);

  useEffect(() => {
    if (open) {
      openedAtRef.current = Date.now();
      setHp("");
      void fetchChallenge();
    }
  }, [open, fetchChallenge]);

  // the 60s resend cooldown (mirrors Supabase's own send cadence)
  useEffect(() => {
    if (cooldown <= 0 && cooldownTimer.current) {
      clearInterval(cooldownTimer.current);
      cooldownTimer.current = null;
    }
  }, [cooldown]);
  const startCooldown = () => {
    setCooldown(60);
    if (cooldownTimer.current) clearInterval(cooldownTimer.current);
    cooldownTimer.current = setInterval(() => setCooldown((c) => (c <= 1 ? 0 : c - 1)), 1000);
  };
  useEffect(() => () => (cooldownTimer.current ? clearInterval(cooldownTimer.current) : undefined), []);

  const applyAuthError = useCallback(
    (d: { error?: string; challengeFailed?: boolean }, res: Response) => {
      if (d.challengeFailed) {
        void fetchChallenge(); // re-arm immediately
        setError(tt(T.accountChallengeExpired, lang));
        return;
      }
      if (res.status === 403 && d.error?.includes("automated clients")) {
        setError(tt(T.accountBotBlocked, lang));
        return;
      }
      if (res.status === 403 && d.error?.includes("disposable")) {
        setError(tt(T.accountTempMailBlocked, lang));
        return;
      }
      if (res.status === 403 && d.error?.includes("too fast")) {
        setError(tt(T.accountTooFast, lang));
        return;
      }
      setError(d.error ?? tt(T.accountLoadErr, lang));
    },
    [fetchChallenge, lang],
  );

  // the owner's passwordless finish: mint the session via the admin door
  const adminSignIn = useCallback(
    async (setupCode?: string) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/auth/supabase/admin-signin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email.trim() || undefined, setupCode, challenge: challengeRef.current }),
        });
        const d = (await res.json()) as { ok: boolean; user?: { id?: string; email: string | null }; error?: string; challengeFailed?: boolean; needsBootstrap?: boolean };
        if (d.ok && d.user) {
          setMe({ signedIn: true, user: { id: d.user.id ?? "", email: d.user.email ?? email }, isAdmin: true, trustedAdmin: true });
          setOpen(false);
          setStep("email");
          setCode("");
          toast(`${tt(T.accountAdminSignedIn, lang)} — ${d.user.email ?? email}`);
        } else {
          applyAuthError(d, res);
        }
      } catch {
        setError(tt(T.accountLoadErr, lang));
      } finally {
        setBusy(false);
      }
    },
    [applyAuthError, email, lang, toast],
  );

  const sendCode = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/auth/supabase/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          challenge: challengeRef.current,
          openedAt: openedAtRef.current,
          hp,
        }),
      });
      const d = (await res.json()) as { ok: boolean; adminFast?: boolean; error?: string; rateLimited?: boolean; challengeFailed?: boolean };
      if (d.ok && d.adminFast) {
        // trusted owner browser — no email spent, finish via the admin door
        await adminSignIn();
        return;
      }
      if (d.ok) {
        setStep("code");
        startCooldown();
      } else {
        applyAuthError(d, res);
      }
    } catch {
      setError(tt(T.accountLoadErr, lang));
    } finally {
      setBusy(false);
    }
  }, [adminSignIn, applyAuthError, email, hp, lang]);

  const verify = useCallback(async () => {
    setError(null);
    setBusy(true);
    const what = code.trim();
    try {
      const res = await fetch("/api/auth/supabase/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          code: what,
          challenge: challengeRef.current,
          hp,
        }),
      });
      const d = (await res.json()) as { ok: boolean; user?: { id?: string; email: string | null }; isAdmin?: boolean; error?: string; challengeFailed?: boolean };
      if (d.ok && d.user) {
        setMe({
          signedIn: true,
          user: { id: d.user.id ?? "", email: d.user.email ?? email },
          isAdmin: d.isAdmin === true,
          trustedAdmin: d.isAdmin === true || (me?.trustedAdmin ?? false),
        });
        setOpen(false);
        setStep("email");
        setCode("");
        toast(`${tt(T.accountSignedInAs, lang)} ${d.user.email ?? email}`);
      } else {
        if (res.status === 400) {
          setError(tt(T.accountInvalidCode, lang));
        } else {
          applyAuthError(d, res);
        }
      }
    } catch {
      setError(tt(T.accountLoadErr, lang));
    } finally {
      setBusy(false);
    }
  }, [applyAuthError, email, code, lang, me, toast]);

  const signOut = useCallback(async () => {
    setBusy(true);
    try {
      await fetch("/api/auth/supabase/logout", { method: "POST" }).catch(() => {});
      setMe((m) => ({ signedIn: false, user: null, trustedAdmin: m?.trustedAdmin }));
      setStep("email");
      setCode("");
      toast(tt(T.accountSignedOut, lang));
    } finally {
      setBusy(false);
    }
  }, [lang, toast]);

  const signedIn = me?.signedIn === true && me.user !== null;
  const isAdmin = me?.isAdmin === true;
  const trustedAdmin = me?.trustedAdmin === true;

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        aria-label={tt(T.account, lang)}
        title={signedIn ? `${tt(T.accountSignedInAs, lang)} ${me.user?.email ?? ""}` : tt(T.accountSignIn, lang)}
        className="relative gap-1.5"
      >
        {isAdmin ? <Crown className="h-4 w-4 text-amber-500" aria-hidden /> : <CircleUserRound className={`h-4 w-4 ${signedIn ? "text-up" : ""}`} aria-hidden />}
        {signedIn && (
          <span className="absolute top-1 end-1 h-1.5 w-1.5 rounded-full bg-up ring-2 ring-card" aria-hidden />
        )}
      </Button>

      <Dialog open={open} onOpenChange={(o) => setOpen(o)}>
        <DialogContent className="max-w-[380px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4 text-primary" aria-hidden />
              {tt(T.account, lang)} — Supabase
              {isAdmin && (
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                  <Crown className="h-3 w-3" aria-hidden />
                  {tt(T.accountAdminBadge, lang)}
                </span>
              )}
            </DialogTitle>
            <DialogDescription className="text-xs leading-relaxed text-muted-foreground">
              {tt(T.accountNote, lang)}
            </DialogDescription>
          </DialogHeader>

          {signedIn ? (
            <div className="space-y-3">
              <div className="rounded-md border bg-secondary/40 px-3 py-2.5 space-y-1">
                <p className="text-[11px] text-muted-foreground">{tt(T.accountSignedInAs, lang)}</p>
                <p className="text-sm font-medium truncate" dir="ltr">
                  {me.user?.email}
                </p>
                <p className="text-[10px] text-muted-foreground/80 num" dir="ltr">
                  id: {me.user?.id.slice(0, 8)}…
                </p>
              </div>
              <Button variant="outline" className="w-full gap-2" onClick={() => void signOut()} disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
                {tt(T.accountSignOut, lang)}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {/* the trusted-device door: one click, no code, no email */}
              {trustedAdmin && (
                <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
                  <div className="flex items-center gap-2 text-xs font-medium text-amber-700 dark:text-amber-400">
                    <Crown className="h-3.5 w-3.5" aria-hidden />
                    {tt(T.accountAdminQuick, lang)}
                  </div>
                  <p className="text-[10px] leading-relaxed text-muted-foreground">{tt(T.accountAdminQuickHint, lang)}</p>
                  <Button
                    className="w-full gap-2"
                    onClick={() => void adminSignIn()}
                    disabled={busy || !challengeReady}
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                    {tt(T.accountAdminQuick, lang)}
                  </Button>
                </div>
              )}

              {step === "email" ? (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="sb-email" className="text-xs">
                      {tt(T.accountEmailLabel, lang)}
                    </Label>
                    <Input
                      id="sb-email"
                      type="email"
                      inputMode="email"
                      dir="ltr"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && /.+@.+\..+/.test(email.trim())) void sendCode();
                      }}
                      className="h-9"
                    />
                  </div>
                  {/* T48 honeypot: invisible to humans, irresistible to bots */}
                  <input
                    ref={honeypotRef}
                    type="text"
                    name="company_website"
                    autoComplete="off"
                    tabIndex={-1}
                    aria-hidden="true"
                    value={hp}
                    onChange={(e) => setHp(e.target.value)}
                    style={{ position: "absolute", left: "-9999px", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
                  />
                  <Button
                    className="w-full gap-2"
                    onClick={() => void sendCode()}
                    disabled={busy || !challengeReady || !/.+@.+\..+/.test(email.trim())}
                    title={!challengeReady ? tt(T.accountChallengeExpired, lang) : undefined}
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                    {tt(T.accountSendCode, lang)}
                  </Button>
                </>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">{tt(T.accountCodeSent, lang)}</p>
                  <div className="space-y-1.5">
                    <Label htmlFor="sb-code" className="text-xs">
                      {tt(T.accountCodeLabel, lang)}
                    </Label>
                    {/* ONE combined field: a 6-digit code (if the project's email
                        template carries one) OR the whole pasted link (the default
                        Supabase template is link-only — the server route accepts
                        code, link and bare token_hash shapes alike). The owner
                        may instead paste the one-time setup code from .env. */}
                    <Input
                      id="sb-code"
                      dir="ltr"
                      inputMode="text"
                      placeholder="123456 — or https://…"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && code.trim().length >= 6) void verify();
                      }}
                      className="h-9 font-mono text-sm"
                      autoFocus
                    />
                  </div>
                  <Button className="w-full gap-2" onClick={() => void verify()} disabled={busy || code.trim().length < 6}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
                    {tt(T.accountVerify, lang)}
                  </Button>
                  <div className="flex items-center justify-between text-[11px]">
                    <button
                      className="text-muted-foreground hover:text-foreground underline underline-offset-2"
                      onClick={() => {
                        setStep("email");
                        setError(null);
                      }}
                    >
                      ← {tt(T.accountEmailLabel, lang)}
                    </button>
                    {cooldown > 0 && (
                      <span className="text-muted-foreground/70 num">
                        {tt(T.accountResendIn, lang)} {cooldown}s
                      </span>
                    )}
                    {cooldown === 0 && (
                      <button
                        className="text-primary hover:underline underline-offset-2"
                        onClick={() => void sendCode()}
                        disabled={busy}
                      >
                        {tt(T.accountSendCode, lang)}
                      </button>
                    )}
                  </div>
                </>
              )}
              {error && <p className="text-[11px] leading-relaxed text-down">{error}</p>}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
