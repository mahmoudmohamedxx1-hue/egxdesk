"use client";

import { useState } from "react";
import { useApp } from "./app-context";
import { T, tt } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

export function SignInSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { lang, refreshAuth, toast } = useApp();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function requestCode() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? tt({ ar: "تعذر إرسال الرمز", en: "Could not send the code" }, lang));
      } else {
        setStep("code");
        setDevCode(data.devCode ?? null);
        if (data.devCode) setCode(data.devCode);
      }
    } catch {
      setError(tt({ ar: "تعذر الاتصال", en: "Connection failed" }, lang));
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? tt({ ar: "الرمز غير صحيح", en: "Wrong code" }, lang));
      } else {
        await refreshAuth();
        onOpenChange(false);
        setStep("email");
        setCode("");
        setDevCode(null);
        toast(tt({ ar: `أهلاً ${data.email}`, en: `Welcome, ${data.email}` }, lang));
      }
    } catch {
      setError(tt({ ar: "تعذر الاتصال", en: "Connection failed" }, lang));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" dir={lang === "ar" ? "rtl" : "ltr"}>
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">{tt(T.signInTitle, lang)}</DialogTitle>
          <DialogDescription>{tt(T.signInBody, lang)}</DialogDescription>
        </DialogHeader>

        {step === "email" ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="si-email">{tt(T.emailLabel, lang)}</label>
              <Input
                id="si-email"
                type="email"
                inputMode="email"
                dir="ltr"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && email.includes("@") && !busy && requestCode()}
              />
            </div>
            {error && <p className="text-sm text-down">{error}</p>}
            <Button className="w-full" disabled={busy || !email.includes("@")} onClick={requestCode}>
              {busy ? "…" : tt(T.sendCode, lang)}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {devCode && (
              <p className="rounded-md bg-accent/60 border px-3 py-2 text-xs leading-relaxed">
                {tt(T.devCodeNote, lang)}{" "}
                <span className="num font-semibold text-base" dir="ltr">{devCode}</span>
              </p>
            )}
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="si-code">{tt(T.codeLabel, lang)}</label>
              <Input
                id="si-code"
                inputMode="numeric"
                dir="ltr"
                className="num text-center text-lg tracking-[0.4em]"
                maxLength={6}
                placeholder="000000"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                onKeyDown={(e) => e.key === "Enter" && code.length === 6 && !busy && verify()}
              />
            </div>
            {error && <p className="text-sm text-down">{error}</p>}
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setStep("email")} disabled={busy}>
                {tt(T.backToEmail, lang)}
              </Button>
              <Button className="flex-1" disabled={busy || code.length !== 6} onClick={verify}>
                {busy ? "…" : tt(T.verify, lang)}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
