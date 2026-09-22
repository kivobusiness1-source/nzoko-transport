"use client";

// ============================================================
// NZOKO — Connexion (clients & équipes)
// 2 modes commutables : mot de passe (email OU téléphone) ·
// code SMS rapide (OTP). Session → WorkspaceRouter (PASSENGER
// → espace client, sinon espace professionnel).
// ============================================================

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { motion } from "framer-motion";
import {
  ArrowLeft, Bus, Eye, EyeOff, Loader2, Lock, LogIn, MessageSquare, Phone, Smartphone, UserPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { api, ApiClientError } from "@/lib/api-client";
import { useApp } from "@/lib/store";
import { OTP } from "@/lib/constants";
import type { OtpRequestDTO, SessionUser } from "@/types";
import { cn } from "@/lib/utils";

type LoginMode = "password" | "otp";

const loginSchema = z.object({
  identifier: z.string().trim().min(3, "Renseignez votre e-mail ou votre numéro de téléphone."),
  password: z.string().min(6, "Mot de passe requis (6 caractères minimum)."),
});

type LoginValues = z.infer<typeof loginSchema>;

// Validation souple du téléphone (le serveur normalise vers E.164)
const PHONE_RE = /^(\+?242)?0?\d{8,9}$/;
const phoneLooksValid = (raw: string) => PHONE_RE.test(raw.trim().replace(/[\s.\-()]/g, ""));

const MODES: { key: LoginMode; label: string; icon: typeof Lock }[] = [
  { key: "password", label: "Mot de passe", icon: Lock },
  { key: "otp", label: "Code SMS (rapide)", icon: MessageSquare },
];

export default function LoginView() {
  const setSession = useApp((s) => s.setSession);
  const setView = useApp((s) => s.setView);
  const [mode, setMode] = useState<LoginMode>("password");
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  // --- Mode code SMS ---
  const [phone, setPhone] = useState("");
  const [otpInfo, setOtpInfo] = useState<OtpRequestDTO | null>(null);
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { identifier: "", password: "" },
  });

  const onSession = (user: SessionUser) => {
    setSession(user);
    // Le routeur d'espaces oriente les clients vers « Mon espace NZOKO »
    // et les équipes vers leur espace professionnel.
    setView("workspace");
    toast.success(`Bon retour ${user.firstName} ! — ${user.roleLabel}`);
  };

  // ---------- Mot de passe ----------
  const onSubmit = async (values: LoginValues) => {
    setError(null);
    try {
      onSession(await api.auth.login(values.identifier.trim(), values.password));
    } catch (err) {
      const message = err instanceof ApiClientError ? err.message : "Connexion impossible. Vérifiez votre réseau.";
      setError(message);
      toast.error(message);
    }
  };

  // ---------- Code SMS ----------
  const requestOtp = async () => {
    setError(null);
    if (!phoneLooksValid(phone)) {
      setError("Numéro invalide. Ex : 06 123 45 67 ou +242 06 123 45 67.");
      return;
    }
    setSending(true);
    try {
      const info = await api.auth.otpRequest(phone.trim());
      setOtpInfo(info);
      setCode("");
      toast.success("Code envoyé par SMS.", { description: `Valable ${Math.max(1, Math.round(info.expiresInSec / 60))} minutes.` });
    } catch (err) {
      const message = err instanceof ApiClientError ? err.message : "Envoi du code impossible. Réessayez.";
      setError(message);
      toast.error(message);
    } finally {
      setSending(false);
    }
  };

  const verifyOtp = async () => {
    if (!otpInfo || code.length !== OTP.codeLength) return;
    setError(null);
    setVerifying(true);
    try {
      onSession(await api.auth.otpVerify({ phone: otpInfo.phone, code }));
    } catch (err) {
      const message = err instanceof ApiClientError ? err.message : "Vérification impossible. Réessayez.";
      setError(message);
      toast.error(message);
    } finally {
      setVerifying(false);
    }
  };

  return (
    <section className="mx-auto flex w-full max-w-md flex-col px-4 py-8" aria-label="Connexion">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
        <Card className="border shadow-lg shadow-primary/5">
          <CardHeader className="items-center text-center">
            <span className="nzoko-hero mx-auto flex size-14 items-center justify-center rounded-2xl text-white shadow-md">
              <Bus className="size-7" aria-hidden />
            </span>
            <CardTitle className="mt-3 text-xl">Connexion</CardTitle>
            <CardDescription>
              Votre espace NZOKO — clients, guichets et administrateurs.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && (
              <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                {error}
              </p>
            )}

            {/* Sélecteur de mode */}
            <div role="tablist" aria-label="Mode de connexion" className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1">
              {MODES.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  role="tab"
                  aria-selected={mode === m.key}
                  onClick={() => {
                    setMode(m.key);
                    setError(null);
                  }}
                  className={cn(
                    "flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg px-2 text-sm font-medium transition-colors",
                    mode === m.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <m.icon className="size-4 shrink-0" aria-hidden />
                  <span className="truncate">{m.label}</span>
                </button>
              ))}
            </div>

            {mode === "password" ? (
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-4">
                  <FormField
                    control={form.control}
                    name="identifier"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email ou téléphone</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="text"
                            autoComplete="username"
                            inputMode="text"
                            className="h-11"
                            placeholder="vous@exemple.cg ou 06 123 45 67"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Mot de passe</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                            <Input
                              {...field}
                              type={showPassword ? "text" : "password"}
                              autoComplete="current-password"
                              className="h-11 pl-9 pr-11"
                              placeholder="••••••••"
                            />
                            <button
                              type="button"
                              onClick={() => setShowPassword((v) => !v)}
                              aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                              className="absolute right-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
                            >
                              {showPassword ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
                            </button>
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <Button type="submit" size="lg" disabled={form.formState.isSubmitting} className="h-12 w-full">
                    {form.formState.isSubmitting ? (
                      <Loader2 className="size-5 animate-spin" aria-hidden />
                    ) : (
                      <LogIn className="size-5" aria-hidden />
                    )}
                    {form.formState.isSubmitting ? "Connexion…" : "Connexion"}
                  </Button>
                </form>
              </Form>
            ) : (
              <div className="space-y-4">
                {!otpInfo ? (
                  <>
                    <div>
                      <label htmlFor="otp-phone" className="mb-1.5 block text-sm font-medium">
                        Téléphone
                      </label>
                      <div className="relative">
                        <Phone className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                        <Input
                          id="otp-phone"
                          type="tel"
                          inputMode="tel"
                          autoComplete="tel"
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void requestOtp();
                          }}
                          className="h-11 pl-9"
                          placeholder="06 123 45 67 ou +242 06 123 45 67"
                        />
                      </div>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Nous vous envoyons un code à 6 chiffres par SMS.
                      </p>
                    </div>
                    <Button type="button" size="lg" onClick={requestOtp} disabled={sending} className="h-12 w-full">
                      {sending ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <Smartphone className="size-5" aria-hidden />}
                      {sending ? "Envoi du code…" : "Recevoir mon code"}
                    </Button>
                  </>
                ) : (
                  <>
                    <div className="flex items-center justify-between rounded-lg border bg-muted/40 px-3 py-2.5 text-sm">
                      <span className="flex min-w-0 items-center gap-2">
                        <Phone className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="truncate font-medium">{phone.trim()}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setOtpInfo(null);
                          setCode("");
                          setError(null);
                        }}
                        className="ml-2 shrink-0 text-xs font-medium text-primary hover:underline"
                      >
                        Modifier
                      </button>
                    </div>

                    {/* Mode test (sandbox, sans passerelle SMS) — uniquement si le serveur renvoie devCode */}
                    {otpInfo.devCode && (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300" role="status">
                        Mode test — votre code :{" "}
                        <span className="font-mono font-bold tracking-widest">
                          {otpInfo.devCode.slice(0, 3)} {otpInfo.devCode.slice(3)}
                        </span>
                      </div>
                    )}

                    <div>
                      <label htmlFor="otp-code" className="mb-1.5 block text-sm font-medium">
                        Code à 6 chiffres
                      </label>
                      <InputOTP
                        id="otp-code"
                        maxLength={OTP.codeLength}
                        value={code}
                        onChange={setCode}
                        disabled={verifying}
                        autoComplete="one-time-code"
                      >
                        <InputOTPGroup>
                          {Array.from({ length: OTP.codeLength }).map((_, i) => (
                            <InputOTPSlot key={i} index={i} className="h-12 w-9 text-base sm:w-10" />
                          ))}
                        </InputOTPGroup>
                      </InputOTP>
                      <p className="mt-1.5 text-[11px] text-muted-foreground">
                        Code valable {Math.max(1, Math.round(otpInfo.expiresInSec / 60))} minutes.
                      </p>
                    </div>

                    <Button
                      type="button"
                      size="lg"
                      onClick={verifyOtp}
                      disabled={verifying || code.length !== OTP.codeLength}
                      className="h-12 w-full"
                    >
                      {verifying ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <LogIn className="size-5" aria-hidden />}
                      {verifying ? "Connexion…" : "Se connecter"}
                    </Button>

                    <button
                      type="button"
                      onClick={requestOtp}
                      disabled={sending}
                      className="w-full text-center text-xs font-medium text-muted-foreground hover:text-foreground hover:underline"
                    >
                      Renvoyer le code
                    </button>
                  </>
                )}
              </div>
            )}

            <div className="space-y-1 pt-1">
              <Button variant="ghost" onClick={() => setView("register")} className="h-11 w-full gap-1.5">
                <UserPlus className="size-4" aria-hidden /> Pas encore de compte ? Créer mon compte
              </Button>
              <Button variant="ghost" onClick={() => setView("home")} className="h-11 w-full gap-1.5">
                <ArrowLeft className="size-4" aria-hidden /> Retour à l&apos;accueil
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </section>
  );
}
