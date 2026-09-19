"use client";

/** T47 — the Supabase ACCOUNT: a header button + sign-in dialog for the
 *  website's first real server-side auth. Email → Supabase emails a 6-digit
 *  code → verify → an HttpOnly session cookie. The browser NEVER sees a
 *  key, a JWT, or a refresh token — only {id, email} of its own user.
 *
 *  Honest by construction: every failure state (rate limit, wrong code,
 *  network) renders its real message; the free tier's ~2 emails/hour budget
 *  is stated where it can be hit; a 60s resend cooldown mirrors it. If the
 *  email template carries a magic link instead of a code, the link can be
 *  pasted into the fallback field and verifies the same way. */

import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "./app-context";
import { T, tt } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CircleUserRound, Loader2, LogIn, LogOut, Mail, ShieldCheck } from "lucide-react";

type Me = { signedIn: boolean; user: { id: string; email: string | null } | null };

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

  const sendCode = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/auth/supabase/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const d = (await res.json()) as { ok: boolean; error?: string; rateLimited?: boolean };
      if (d.ok) {
        setStep("code");
        startCooldown();
      } else {
        setError(d.rateLimited ? tt(T.accountRateLimited, lang) : (d.error ?? tt(T.accountLoadErr, lang)));
      }
    } catch {
      setError(tt(T.accountLoadErr, lang));
    } finally {
      setBusy(false);
    }
  }, [email, lang]);

  const verify = useCallback(async () => {
    setError(null);
    setBusy(true);
    const what = code.trim();
    try {
      const res = await fetch("/api/auth/supabase/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code: what }),
      });
      const d = (await res.json()) as { ok: boolean; user?: { id?: string; email: string | null }; error?: string };
      if (d.ok && d.user) {
        setMe({ signedIn: true, user: { id: d.user.id ?? "", email: d.user.email ?? email } });
        setOpen(false);
        setStep("email");
        setCode("");
        toast(`${tt(T.accountSignedInAs, lang)} ${d.user.email ?? email}`);
      } else {
        setError(res.status === 400 ? tt(T.accountInvalidCode, lang) : (d.error ?? tt(T.accountLoadErr, lang)));
      }
    } catch {
      setError(tt(T.accountLoadErr, lang));
    } finally {
      setBusy(false);
    }
  }, [email, code, lang, toast]);

  const signOut = useCallback(async () => {
    setBusy(true);
    try {
      await fetch("/api/auth/supabase/logout", { method: "POST" }).catch(() => {});
      setMe({ signedIn: false, user: null });
      setStep("email");
      setCode("");
      toast(tt(T.accountSignedOut, lang));
    } finally {
      setBusy(false);
    }
  }, [lang, toast]);

  const signedIn = me?.signedIn === true && me.user !== null;

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
        <CircleUserRound className={`h-4 w-4 ${signedIn ? "text-up" : ""}`} aria-hidden />
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
                  <Button
                    className="w-full gap-2"
                    onClick={() => void sendCode()}
                    disabled={busy || !/.+@.+\..+/.test(email.trim())}
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
                        code, link and bare token_hash shapes alike). */}
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
