"use client";

// ============================================================
// NZOKO — Écran de connexion UNIFIÉ (une seule identité)
// ============================================================
// Deux moyens de connexion, un seul système d'identité et de session :
//  • Téléphone (marché congolais, par défaut) : numéro → code à 6
//    chiffres → session.
//  • E-mail : mot de passe (équipes NZOKO) ou inscription (clients).
//
// Mode NEON (production) — Neon Auth centralise l'identité et la session :
//  - Téléphone : provisioning silencieux (serveur) → SDK sendOtp →
//    webhook SMS → SDK verify → session Neon → échange NZOKO ;
//  - E-mail : SDK signIn.email → session Neon → échange NZOKO ;
//    au premier échec (« identifiants inconnus »), PONT D'IMPORT :
//    le serveur vérifie l'ancien mot de passe local bcrypt et crée le
//    compte Neon avec ce même mot de passe (migration transparente) ;
//  - Inscription : SDK signUp.email → code de vérification par e-mail.
//
// Mode LOCAL (sandbox/dev) : mêmes écrans, moteur local (bcrypt + OTP).
// ============================================================

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { motion } from "framer-motion";
import {
  ArrowLeft, ArrowRight, Bell, Bus, CheckCircle2, Eye, EyeOff, KeyRound, Loader2, Lock, LogIn, Mail,
  MessageSquareText, Phone, ShieldCheck, Star, Ticket, UserPlus, UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, ApiClientError } from "@/lib/api-client";
import { SHORT_ID_EMAILS } from "@/lib/constants";
import { neonAuthCall, neonAuthClient, neonAuthErrorMessage } from "@/lib/neon-auth/client";
import { useApp } from "@/lib/store";
import type { AuthProvidersDTO, RegisterResult, SessionUser } from "@/types";

// ---------- Schémas ----------

const phoneSchema = z.object({
  phone: z
    .string()
    .trim()
    .min(6, "Numéro de téléphone requis.")
    .refine((v) => /^(\+?242)?0?[\d\s().-]{8,16}$/.test(v), "Numéro invalide. Ex : 06 123 45 67 ou +242 06 123 45 67."),
});
type PhoneValues = z.infer<typeof phoneSchema>;

const codeSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, "Code à 6 chiffres requis."),
});
type CodeValues = z.infer<typeof codeSchema>;

// E-mail — connexion (email OU identifiant court : « superadmin », téléphone…)
const loginSchema = z.object({
  identifier: z.string().trim().min(3, "Renseignez votre e-mail ou votre identifiant."),
  password: z.string().min(6, "Mot de passe requis (6 caractères minimum)."),
});
type LoginValues = z.infer<typeof loginSchema>;

const registerSchema = z
  .object({
    firstName: z.string().trim().min(2, "Prénom requis (2 caractères minimum).").max(60),
    lastName: z.string().trim().min(2, "Nom requis (2 caractères minimum).").max(60),
    phone: z
      .string()
      .trim()
      .min(6, "Numéro de téléphone requis.")
      // Tolère espaces/points/tirets/parenthèses à la saisie — le serveur
      // normalise en E.164 ("06 123 45 67" → 242061234567).
      .refine((v) => /^(\+?242)?0?[\d\s().-]{8,16}$/.test(v), "Numéro invalide. Ex : 06 123 45 67 ou +242 06 123 45 67."),
    email: z.email("Adresse e-mail invalide (ex : vous@exemple.cg)."),
    password: z.string().min(8, "Mot de passe : 8 caractères minimum."),
    confirmPassword: z.string().min(8, "Confirmez votre mot de passe."),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: "Les deux mots de passe ne correspondent pas.",
    path: ["confirmPassword"],
  });
type RegisterValues = z.infer<typeof registerSchema>;

// E-mail (mode Neon) — inscription
const emailSignupSchema = z.object({
  name: z.string().trim().min(2, "Nom complet requis (2 caractères minimum).").max(80, "Nom trop long (80 caractères max)."),
  email: z.email("Adresse e-mail invalide (ex : vous@exemple.cg)."),
  password: z.string().min(8, "Mot de passe : 8 caractères minimum."),
});
type EmailSignupValues = z.infer<typeof emailSignupSchema>;

// Vérification d'adresse e-mail (code à 6 chiffres reçu par mail)
const verifyEmailSchema = z.object({
  otp: z.string().trim().regex(/^\d{6}$/, "Code à 6 chiffres requis."),
});
type VerifyEmailValues = z.infer<typeof verifyEmailSchema>;

// Mot de passe oublié — étape 1 : demande du code (e-mail OU identifiant court)
const resetRequestSchema = z.object({
  identifier: z.string().trim().min(3, "Renseignez votre e-mail ou votre identifiant."),
});
type ResetRequestValues = z.infer<typeof resetRequestSchema>;

// Mot de passe oublié — étape 2 : code + nouveau mot de passe
const resetVerifySchema = z
  .object({
    code: z.string().trim().regex(/^\d{6}$/, "Code à 6 chiffres requis."),
    password: z.string().min(8, "Mot de passe : 8 caractères minimum."),
    confirmPassword: z.string().min(8, "Confirmez le mot de passe."),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: "Les deux mots de passe ne correspondent pas.",
    path: ["confirmPassword"],
  });
type ResetVerifyValues = z.infer<typeof resetVerifySchema>;

// ---------- Avantages (panneau de marque) ----------

const BENEFITS = [
  { icon: Ticket, title: "Tous vos billets au même endroit", text: "Historique complet, QR codes et reçus toujours disponibles." },
  { icon: Star, title: "Des points à chaque voyage", text: "100 points par trajet payé, réductions dès 500 points." },
  { icon: Bell, title: "Alertes intelligentes", text: "Départ dans 2 h, confirmation de paiement, promotions." },
  { icon: ShieldCheck, title: "Réclamations suivies", text: "Un numéro de dossier et une réponse de nos équipes." },
];

type AuthTab = "phone" | "email";

export default function AuthScreen({ defaultTab = "login" }: { defaultTab?: "login" | "register" }) {
  const setSession = useApp((s) => s.setSession);
  const setView = useApp((s) => s.setView);
  const [tab, setTab] = useState<AuthTab>(defaultTab === "register" ? "email" : "phone");
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // Modes d'authentification (serveur) : neon = identité centralisée,
  // local = stub sandbox. Onglet E-mail en sous-mode connexion/inscription.
  const [providers, setProviders] = useState<AuthProvidersDTO>({ supabase: false, neon: false, mode: "local", neonService: false });
  const neon = providers.mode === "neon";
  const [emailMode, setEmailMode] = useState<"signin" | "signup">(defaultTab === "register" ? "signup" : "signin");

  // Pipeline téléphone : étape + numéro normalisé (E.164 avec « + » en mode Neon)
  const [otpStep, setOtpStep] = useState<"phone" | "code">("phone");
  const [otpPhone, setOtpPhone] = useState("");
  const [otpDevCode, setOtpDevCode] = useState<string | null>(null);

  // Vérification d'adresse e-mail (inscription Neon)
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);

  // Réinitialisation de mot de passe oublié (onglet e-mail)
  const [resetStep, setResetStep] = useState<"idle" | "request" | "code">("idle");
  const [resetEmail, setResetEmail] = useState("");
  const [resetIdentifier, setResetIdentifier] = useState("");
  const [resetDevCode, setResetDevCode] = useState<string | null>(null);

  useEffect(() => {
    api.auth
      .providers()
      .then((p) => setProviders(p))
      .catch(() => setProviders({ supabase: false, neon: false, mode: "local", neonService: false }));
  }, []);

  const onSession = (user: SessionUser) => {
    setSession(user);
    setView("workspace");
    toast.success(`Bienvenue ${user.firstName} !`, { description: user.roleLabel });
  };

  // ---------- Téléphone : demande du code ----------
  const phoneForm = useForm<PhoneValues>({
    resolver: zodResolver(phoneSchema),
    defaultValues: { phone: "" },
  });

  const onPhoneRequest = async (values: PhoneValues) => {
    setError(null);
    try {
      const res = await api.auth.otpRequest(values.phone.trim());
      if (res.mode === "neon") {
        // Provisioning fait côté serveur → envoi du code par le service
        // managé (webhook send.otp → SMS).
        const { error: sdkError } = await neonAuthCall(() =>
          neonAuthClient.phoneNumber.sendOtp({ phoneNumber: res.phone })
        );
        if (sdkError) {
          throw new Error(neonAuthErrorMessage(sdkError));
        }
        setOtpPhone(res.phone);
        setOtpDevCode(null);
      } else {
        // Mode local (sandbox) : code généré localement (devCode si debug)
        setOtpPhone(res.phone);
        setOtpDevCode(res.devCode ?? null);
      }
      setOtpStep("code");
    } catch (err) {
      const message =
        err instanceof ApiClientError || err instanceof Error
          ? err.message
          : "Envoi du code impossible. Vérifiez votre réseau.";
      setError(message);
      toast.error(message);
    }
  };

  // ---------- Téléphone : vérification du code ----------
  const codeForm = useForm<CodeValues>({
    resolver: zodResolver(codeSchema),
    defaultValues: { code: "" },
  });

  const onPhoneVerify = async (values: CodeValues) => {
    setError(null);
    try {
      if (neon) {
        // Session Neon Auth (cookie signé) → échange applicatif NZOKO
        const { error: sdkError } = await neonAuthCall(() =>
          neonAuthClient.phoneNumber.verify({
            phoneNumber: otpPhone,
            code: values.code.trim(),
          })
        );
        if (sdkError) {
          throw new Error(neonAuthErrorMessage(sdkError));
        }
        onSession(await api.auth.exchangeNeonSession());
      } else {
        onSession(await api.auth.otpVerify({ phone: phoneForm.getValues("phone").trim(), code: values.code.trim() }));
      }
    } catch (err) {
      const message =
        err instanceof ApiClientError || err instanceof Error
          ? err.message
          : "Vérification impossible. Réessayez.";
      setError(message);
      toast.error(message);
    }
  };

  // ---------- E-mail : connexion (pont d'import en mode Neon) ----------
  const loginForm = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { identifier: "", password: "" },
  });

  const onEmailLogin = async (values: LoginValues) => {
    setError(null);
    const identifier = values.identifier.trim();
    try {
      if (!neon) {
        onSession(await api.auth.login(identifier, values.password));
        return;
      }

      // ---- Mode Neon : session centralisée ----
      // 1. Résolution de l'identifiant : adresse e-mail directe OU
      //    identifiant court interne (« superadmin »…) complété vers
      //    l'e-mail réel du compte — si le compte a déjà été migré vers
      //    Neon Auth, la connexion est DIRECTE (aucun pont, aucun bcrypt
      //    local : identité centralisée uniquement).
      const isEmail = identifier.includes("@");
      const shortEmail = !isEmail ? SHORT_ID_EMAILS[identifier.toLowerCase()] ?? null : null;
      const neonEmail = isEmail ? identifier.toLowerCase() : shortEmail;
      if (neonEmail) {
        const { error: sdkError } = await neonAuthCall(() =>
          neonAuthClient.signIn.email({
            email: neonEmail,
            password: values.password,
          })
        );
        if (!sdkError) {
          onSession(await api.auth.exchangeNeonSession());
          return;
        }
        // « Identifiants incorrects » → peut-être un compte interne pas
        // encore importé : pont d'import (bcrypt local → compte Neon).
        const credentialsIssue = /identifiants incorrects/i.test(neonAuthErrorMessage(sdkError));
        if (!credentialsIssue) {
          throw new Error(neonAuthErrorMessage(sdkError));
        }
      }

      // 2. Pont d'import : le serveur vérifie l'ancien mot de passe local
      //    et crée/aligne le compte Neon avec ce même mot de passe.
      //    (Téléphone, identifiant court inconnu, ou compte non migré.)
      const bridge = await api.auth.loginBridge(identifier, values.password);

      // 3. Connexion Neon avec l'e-mail résolu par le pont.
      const { error: retryError } = await neonAuthCall(() =>
        neonAuthClient.signIn.email({
          email: bridge.email,
          password: values.password,
        })
      );
      if (retryError) {
        throw new Error(neonAuthErrorMessage(retryError));
      }
      onSession(await api.auth.exchangeNeonSession());
    } catch (err) {
      const message =
        err instanceof ApiClientError || err instanceof Error
          ? err.message
          : "Connexion impossible. Vérifiez votre réseau.";
      setError(message);
      toast.error(message);
    }
  };

  // ---------- E-mail : inscription ----------
  const registerForm = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { firstName: "", lastName: "", phone: "", email: "", password: "", confirmPassword: "" },
  });
  const emailSignupForm = useForm<EmailSignupValues>({
    resolver: zodResolver(emailSignupSchema),
    defaultValues: { name: "", email: "", password: "" },
  });

  const onRegister = async (values: RegisterValues) => {
    setError(null);
    try {
      const result: RegisterResult = await api.auth.register({
        firstName: values.firstName.trim(),
        lastName: values.lastName.trim(),
        phone: values.phone.trim(),
        email: values.email.trim().toLowerCase(),
        password: values.password,
      });
      if ("requiresEmailConfirmation" in result) {
        setPendingEmail(result.email);
        return;
      }
      onSession(result);
    } catch (err) {
      const message = err instanceof ApiClientError ? err.message : "Inscription impossible. Vérifiez votre réseau.";
      setError(message);
      toast.error(message);
    }
  };

  const onEmailSignup = async (values: EmailSignupValues) => {
    setError(null);
    try {
      const { data, error: sdkError } = await neonAuthCall(() =>
        neonAuthClient.signUp.email({
          name: values.name.trim(),
          email: values.email.trim(),
          password: values.password,
        })
      );
      if (sdkError) {
        throw new Error(neonAuthErrorMessage(sdkError));
      }
      if (!data?.token) {
        // token null = vérification d'e-mail exigée par la configuration
        // Neon Auth : aucune session tant que le code n'a pas été confirmé.
        setPendingEmail(values.email.trim());
        return;
      }
      onSession(await api.auth.exchangeNeonSession());
    } catch (err) {
      const message =
        err instanceof ApiClientError || err instanceof Error
          ? err.message
          : "Inscription impossible. Vérifiez votre réseau.";
      setError(message);
      toast.error(message);
    }
  };

  // ---------- Vérification d'adresse e-mail (code reçu par mail) ----------
  const verifyEmailForm = useForm<VerifyEmailValues>({
    resolver: zodResolver(verifyEmailSchema),
    defaultValues: { otp: "" },
  });

  const onVerifyEmail = async (values: VerifyEmailValues) => {
    setError(null);
    try {
      const { error: sdkError } = await neonAuthCall(() =>
        neonAuthClient.emailOtp.verifyEmail({
          email: pendingEmail ?? "",
          otp: values.otp.trim(),
        })
      );
      if (sdkError) {
        throw new Error(neonAuthErrorMessage(sdkError));
      }
      toast.success("Adresse e-mail vérifiée !", { description: "Connectez-vous avec vos identifiants." });
      setPendingEmail(null);
      setTab("email");
      setEmailMode("signin");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Vérification impossible.";
      setError(message);
      toast.error(message);
    }
  };

  // ---------- Mot de passe oublié : demande du code ----------
  const resetRequestForm = useForm<ResetRequestValues>({
    resolver: zodResolver(resetRequestSchema),
    defaultValues: { identifier: "" },
  });

  const onRequestReset = async (values: ResetRequestValues) => {
    setError(null);
    try {
      const res = await api.auth.passwordResetRequest(values.identifier.trim());
      setResetIdentifier(values.identifier.trim());
      setResetEmail(res.email);
      setResetDevCode(res.devCode ?? null);
      setResetStep("code");
      toast.success("Code envoyé par e-mail", {
        description: `Vérifiez la boîte ${res.email} — le code expire dans 15 minutes.`,
      });
    } catch (err) {
      const message =
        err instanceof ApiClientError || err instanceof Error
          ? err.message
          : "Envoi du code impossible. Vérifiez votre réseau.";
      setError(message);
      toast.error(message);
    }
  };

  // ---------- Mot de passe oublié : code + nouveau mot de passe ----------
  const resetVerifyForm = useForm<ResetVerifyValues>({
    resolver: zodResolver(resetVerifySchema),
    defaultValues: { code: "", password: "", confirmPassword: "" },
  });

  const onResetVerify = async (values: ResetVerifyValues) => {
    setError(null);
    try {
      await api.auth.passwordResetVerify(resetEmail, values.code.trim(), values.password);
      toast.success("Mot de passe réinitialisé !", { description: "Connectez-vous avec votre nouveau mot de passe." });
      setResetStep("idle");
      setResetEmail("");
      setResetIdentifier("");
      setResetDevCode(null);
      resetVerifyForm.reset();
      resetRequestForm.reset();
      setEmailMode("signin");
    } catch (err) {
      const message =
        err instanceof ApiClientError || err instanceof Error
          ? err.message
          : "Réinitialisation impossible. Réessayez.";
      setError(message);
      toast.error(message);
    }
  };

  /** Renvoi du code de réinitialisation avec l'identifiant déjà validé. */
  const onResendResetCode = async () => {
    if (!resetIdentifier) return;
    setError(null);
    try {
      const res = await api.auth.passwordResetRequest(resetIdentifier);
      setResetEmail(res.email);
      setResetDevCode(res.devCode ?? null);
      toast.success("Nouveau code envoyé par e-mail", { description: `Vérifiez la boîte ${res.email}.` });
    } catch (err) {
      const message =
        err instanceof ApiClientError || err instanceof Error
          ? err.message
          : "Envoi du code impossible. Vérifiez votre réseau.";
      setError(message);
      toast.error(message);
    }
  };

  const exitResetFlow = () => {
    setResetStep("idle");
    setResetEmail("");
    setResetDevCode(null);
    setError(null);
  };

  const errBox = (message: string) => (
    <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
      {message}
    </p>
  );

  const passwordAdornment = (visible: boolean, toggle: () => void, label: string) => (
    <button
      type="button"
      onClick={toggle}
      aria-label={visible ? `Masquer ${label}` : `Afficher ${label}`}
      className="absolute right-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
    >
      {visible ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
    </button>
  );

  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-8 lg:py-12" aria-label="Connexion et inscription">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="grid gap-6 lg:grid-cols-[1.05fr_1fr] lg:gap-0"
      >
        {/* ---------- Panneau de marque (desktop) ---------- */}
        <div className="relative hidden overflow-hidden rounded-l-2xl nzoko-hero p-8 lg:flex lg:flex-col lg:justify-between">
          <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
          <div aria-hidden className="pointer-events-none absolute -bottom-20 -left-10 h-64 w-64 rounded-full bg-black/10 blur-2xl" />

          <div className="relative">
            <div className="flex items-center gap-3">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-white/15 text-white backdrop-blur">
                <Bus className="size-6" aria-hidden />
              </span>
              <div>
                <p className="text-xl font-bold tracking-tight text-white">NZOKO</p>
                <p className="text-[10px] uppercase tracking-[0.2em] text-white/70">Transport</p>
              </div>
            </div>
            <h1 className="mt-8 text-2xl font-bold leading-snug text-white">
              Un compte,
              <br />
              tous vos voyages.
            </h1>
            <p className="mt-2 max-w-xs text-sm text-white/80">
              Réservez, suivez vos billets et gagnez des points à chaque trajet au Congo.
            </p>
          </div>

          <ul className="relative mt-8 space-y-4">
            {BENEFITS.map((b) => (
              <li key={b.title} className="flex items-start gap-3">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/15 text-white">
                  <b.icon className="size-4" aria-hidden />
                </span>
                <div>
                  <p className="text-sm font-semibold text-white">{b.title}</p>
                  <p className="text-xs text-white/70">{b.text}</p>
                </div>
              </li>
            ))}
          </ul>

          <p className="relative mt-8 text-[11px] text-white/60">
            🇨🇬 Brazzaville · Pointe-Noire · Dolisie · Nkayi · Ouesso
          </p>
        </div>

        {/* ---------- Formulaire ---------- */}
        <Card className="border shadow-lg shadow-primary/5 lg:rounded-l-none">
          <CardContent className="p-6 sm:p-8">
            {/* En-tête compact (mobile : le panneau de marque est masqué) */}
            <div className="mb-5 text-center lg:text-left">
              <span className="nzoko-hero mx-auto flex size-12 items-center justify-center rounded-2xl text-white shadow-md lg:hidden">
                <Bus className="size-6" aria-hidden />
              </span>
              <h2 className="mt-3 text-xl font-bold lg:mt-0">Content de vous revoir</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Connectez-vous pour accéder à vos billets et points fidélité.
              </p>
            </div>

            {pendingEmail ? (
              // ---------- Vérification d'adresse e-mail (code reçu) ----------
              <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="space-y-4 py-2 text-center">
                <span className="mx-auto flex size-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                  <Mail className="size-8" aria-hidden />
                </span>
                <div>
                  <h3 className="text-lg font-bold">Vérifiez votre boîte mail</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Un code à 6 chiffres a été envoyé à{" "}
                    <span className="font-medium text-foreground">{pendingEmail}</span>.
                    Saisissez-le pour activer votre compte.
                  </p>
                </div>
                <Form {...verifyEmailForm}>
                  <form onSubmit={verifyEmailForm.handleSubmit(onVerifyEmail)} noValidate className="space-y-4">
                    {error && errBox(error)}
                    <FormField
                      control={verifyEmailForm.control}
                      name="otp"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="sr-only">Code de vérification</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              inputMode="numeric"
                              autoComplete="one-time-code"
                              maxLength={6}
                              className="h-12 text-center text-lg tracking-[0.5em]"
                              placeholder="••••••"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <Button type="submit" size="lg" disabled={verifyEmailForm.formState.isSubmitting} className="h-12 w-full">
                      {verifyEmailForm.formState.isSubmitting ? (
                        <Loader2 className="size-5 animate-spin" aria-hidden />
                      ) : (
                        <CheckCircle2 className="size-5" aria-hidden />
                      )}
                      {verifyEmailForm.formState.isSubmitting ? "Vérification…" : "Activer mon compte"}
                    </Button>
                  </form>
                </Form>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full"
                  onClick={() => {
                    setPendingEmail(null);
                    setEmailMode("signin");
                  }}
                >
                  J&apos;ai déjà vérifié mon adresse — me connecter
                </Button>
              </motion.div>
            ) : (
              <Tabs value={tab} onValueChange={(v) => { setTab(v as AuthTab); setError(null); setOtpStep("phone"); setResetStep("idle"); }}>
                <TabsList className="grid h-12 w-full grid-cols-2">
                  <TabsTrigger value="phone" className="gap-1.5 text-sm">
                    <Phone className="size-4" aria-hidden /> Téléphone
                  </TabsTrigger>
                  <TabsTrigger value="email" className="gap-1.5 text-sm">
                    <Mail className="size-4" aria-hidden /> E-mail
                  </TabsTrigger>
                </TabsList>

                {/* ================= TÉLÉPHONE + OTP ================= */}
                <TabsContent value="phone" className="mt-5 space-y-4">
                  {error && errBox(error)}

                  {otpStep === "phone" ? (
                    <Form {...phoneForm}>
                      <form onSubmit={phoneForm.handleSubmit(onPhoneRequest)} noValidate className="space-y-4">
                        <FormField
                          control={phoneForm.control}
                          name="phone"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Votre numéro de téléphone</FormLabel>
                              <FormControl>
                                <div className="relative">
                                  <Phone className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                                  <Input
                                    {...field}
                                    type="tel"
                                    inputMode="tel"
                                    autoComplete="tel"
                                    className="h-11 pl-9"
                                    placeholder="06 123 45 67"
                                  />
                                </div>
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <p className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300" role="status">
                          <MessageSquareText className="mt-0.5 size-4 shrink-0" aria-hidden />
                          <span>
                            Nous vous enverrons un code à 6 chiffres par SMS. Sans mot de passe, sans friction —
                            votre numéro reste votre clé de compte.
                          </span>
                        </p>
                        <Button type="submit" size="lg" disabled={phoneForm.formState.isSubmitting} className="h-12 w-full">
                          {phoneForm.formState.isSubmitting ? (
                            <Loader2 className="size-5 animate-spin" aria-hidden />
                          ) : (
                            <MessageSquareText className="size-5" aria-hidden />
                          )}
                          {phoneForm.formState.isSubmitting ? "Envoi du code…" : "Recevoir mon code"}
                        </Button>
                      </form>
                    </Form>
                  ) : (
                    <motion.div initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} className="space-y-4">
                      <div className="flex items-center justify-between rounded-lg border bg-muted/40 px-3 py-2 text-sm">
                        <span className="flex items-center gap-2 text-muted-foreground">
                          <Phone className="size-4" aria-hidden /> Code envoyé au
                          <strong className="text-foreground">{otpPhone}</strong>
                        </span>
                        <button
                          type="button"
                          className="font-medium text-primary hover:underline"
                          onClick={() => { setOtpStep("phone"); setError(null); }}
                        >
                          Modifier
                        </button>
                      </div>

                      {otpDevCode && (
                        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300" role="status">
                          Mode développement : code <strong className="tracking-widest">{otpDevCode}</strong>
                        </p>
                      )}

                      <Form {...codeForm}>
                        <form onSubmit={codeForm.handleSubmit(onPhoneVerify)} noValidate className="space-y-4">
                          <FormField
                            control={codeForm.control}
                            name="code"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Code reçu par SMS</FormLabel>
                                <FormControl>
                                  <Input
                                    {...field}
                                    inputMode="numeric"
                                    autoComplete="one-time-code"
                                    maxLength={6}
                                    className="h-12 text-center text-lg tracking-[0.5em]"
                                    placeholder="••••••"
                                    autoFocus
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <Button type="submit" size="lg" disabled={codeForm.formState.isSubmitting} className="h-12 w-full">
                            {codeForm.formState.isSubmitting ? (
                              <Loader2 className="size-5 animate-spin" aria-hidden />
                            ) : (
                              <ArrowRight className="size-5" aria-hidden />
                            )}
                            {codeForm.formState.isSubmitting ? "Connexion…" : "Me connecter"}
                          </Button>
                        </form>
                      </Form>

                      <button
                        type="button"
                        className="w-full text-center text-sm text-muted-foreground hover:text-foreground"
                        onClick={() => phoneForm.handleSubmit(onPhoneRequest)()}
                      >
                        Je n&apos;ai rien reçu — renvoyer le code
                      </button>
                    </motion.div>
                  )}
                </TabsContent>

                {/* ================= E-MAIL ================= */}
                <TabsContent value="email" className="mt-5 space-y-4">
                  {error && errBox(error)}

                  {resetStep === "request" ? (
                    /* ---------- Mot de passe oublié : demande du code ---------- */
                    <motion.div initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} className="space-y-4">
                      <div className="flex items-center gap-3">
                        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                          <KeyRound className="size-5" aria-hidden />
                        </span>
                        <div>
                          <h3 className="text-base font-bold">Mot de passe oublié ?</h3>
                          <p className="text-xs text-muted-foreground">
                            Nous vous enverrons un code à 6 chiffres pour définir un nouveau mot de passe.
                          </p>
                        </div>
                      </div>
                      <Form {...resetRequestForm}>
                        <form onSubmit={resetRequestForm.handleSubmit(onRequestReset)} noValidate className="space-y-4">
                          <FormField
                            control={resetRequestForm.control}
                            name="identifier"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>E-mail ou identifiant du compte</FormLabel>
                                <FormControl>
                                  <div className="relative">
                                    <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                                    <Input
                                      {...field}
                                      type="text"
                                      autoComplete="username"
                                      className="h-11 pl-9"
                                      placeholder="vous@exemple.cg ou superadmin"
                                      autoFocus
                                    />
                                  </div>
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300" role="status">
                            <MessageSquareText className="mt-0.5 size-4 shrink-0" aria-hidden />
                            <span>
                              Les comptes créés par <strong>téléphone</strong> se connectent par SMS (onglet Téléphone) —
                              ils n&apos;ont pas de mot de passe à réinitialiser.
                            </span>
                          </p>
                          <Button type="submit" size="lg" disabled={resetRequestForm.formState.isSubmitting} className="h-12 w-full">
                            {resetRequestForm.formState.isSubmitting ? (
                              <Loader2 className="size-5 animate-spin" aria-hidden />
                            ) : (
                              <KeyRound className="size-5" aria-hidden />
                            )}
                            {resetRequestForm.formState.isSubmitting ? "Envoi du code…" : "Envoyer le code de réinitialisation"}
                          </Button>
                          <Button type="button" variant="ghost" className="h-11 w-full gap-1.5" onClick={exitResetFlow}>
                            <ArrowLeft className="size-4" aria-hidden /> Retour à la connexion
                          </Button>
                        </form>
                      </Form>
                    </motion.div>
                  ) : resetStep === "code" ? (
                    /* ---------- Mot de passe oublié : code + nouveau mot de passe ---------- */
                    <motion.div initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} className="space-y-4">
                      <div className="flex items-center justify-between gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
                        <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
                          <Mail className="size-4 shrink-0" aria-hidden /> Code envoyé à
                          <strong className="break-all text-foreground">{resetEmail}</strong>
                        </span>
                        <button
                          type="button"
                          className="shrink-0 font-medium text-primary hover:underline"
                          onClick={() => { setResetStep("request"); setError(null); }}
                        >
                          Modifier
                        </button>
                      </div>

                      {resetDevCode && (
                        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300" role="status">
                          Mode développement : code <strong className="tracking-widest">{resetDevCode}</strong>
                        </p>
                      )}

                      <Form {...resetVerifyForm}>
                        <form onSubmit={resetVerifyForm.handleSubmit(onResetVerify)} noValidate className="space-y-4">
                          <FormField
                            control={resetVerifyForm.control}
                            name="code"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Code reçu par e-mail</FormLabel>
                                <FormControl>
                                  <Input
                                    {...field}
                                    inputMode="numeric"
                                    autoComplete="one-time-code"
                                    maxLength={6}
                                    className="h-12 text-center text-lg tracking-[0.5em]"
                                    placeholder="••••••"
                                    autoFocus
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={resetVerifyForm.control}
                            name="password"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Nouveau mot de passe</FormLabel>
                                <FormControl>
                                  <div className="relative">
                                    <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                                    <Input
                                      {...field}
                                      type={showPassword ? "text" : "password"}
                                      autoComplete="new-password"
                                      className="h-11 pl-9 pr-11"
                                      placeholder="8 caractères min."
                                    />
                                    {passwordAdornment(showPassword, () => setShowPassword((v) => !v), "le mot de passe")}
                                  </div>
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={resetVerifyForm.control}
                            name="confirmPassword"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Confirmation</FormLabel>
                                <FormControl>
                                  <div className="relative">
                                    <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                                    <Input
                                      {...field}
                                      type={showConfirm ? "text" : "password"}
                                      autoComplete="new-password"
                                      className="h-11 pl-9 pr-11"
                                      placeholder="••••••••"
                                    />
                                    {passwordAdornment(showConfirm, () => setShowConfirm((v) => !v), "la confirmation")}
                                  </div>
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <Button type="submit" size="lg" disabled={resetVerifyForm.formState.isSubmitting} className="h-12 w-full">
                            {resetVerifyForm.formState.isSubmitting ? (
                              <Loader2 className="size-5 animate-spin" aria-hidden />
                            ) : (
                              <CheckCircle2 className="size-5" aria-hidden />
                            )}
                            {resetVerifyForm.formState.isSubmitting ? "Réinitialisation…" : "Réinitialiser mon mot de passe"}
                          </Button>
                          <button
                            type="button"
                            className="w-full text-center text-sm text-muted-foreground hover:text-foreground disabled:opacity-60"
                            onClick={onResendResetCode}
                            disabled={resetVerifyForm.formState.isSubmitting}
                          >
                            Je n&apos;ai rien reçu — renvoyer le code
                          </button>
                          <Button type="button" variant="ghost" className="h-11 w-full gap-1.5" onClick={exitResetFlow}>
                            <ArrowLeft className="size-4" aria-hidden /> Retour à la connexion
                          </Button>
                        </form>
                      </Form>
                    </motion.div>
                  ) : (
                    <>
                      {/* Bascule connexion / inscription */}
                      <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1" role="group" aria-label="Mode E-mail">
                    <Button
                      type="button"
                      variant={emailMode === "signin" ? "default" : "ghost"}
                      size="sm"
                      className="h-9"
                      onClick={() => { setEmailMode("signin"); setError(null); }}
                    >
                      <LogIn className="size-4" aria-hidden /> Se connecter
                    </Button>
                    <Button
                      type="button"
                      variant={emailMode === "signup" ? "default" : "ghost"}
                      size="sm"
                      className="h-9"
                      onClick={() => { setEmailMode("signup"); setError(null); }}
                    >
                      <UserPlus className="size-4" aria-hidden /> Créer un compte
                    </Button>
                  </div>

                  {emailMode === "signin" ? (
                    <Form {...loginForm}>
                      <form onSubmit={loginForm.handleSubmit(onEmailLogin)} noValidate className="space-y-4">
                        <FormField
                          control={loginForm.control}
                          name="identifier"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>{neon ? "E-mail ou identifiant" : "E-mail, identifiant ou téléphone"}</FormLabel>
                              <FormControl>
                                <Input
                                  {...field}
                                  type="text"
                                  autoComplete="username"
                                  className="h-11"
                                  placeholder={neon ? "vous@exemple.cg ou superadmin" : "vous@exemple.cg ou 06 123 45 67"}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={loginForm.control}
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
                                  {passwordAdornment(showPassword, () => setShowPassword((v) => !v), "le mot de passe")}
                                </div>
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <button
                          type="button"
                          className="self-end text-sm font-medium text-primary hover:underline"
                          onClick={() => { setResetStep("request"); setError(null); }}
                        >
                          Mot de passe oublié ?
                        </button>
                        {neon && (
                          <p className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300" role="status">
                            <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
                            <span>
                              Vos identifiants sont protégés par <strong>Neon Auth</strong>. À la première connexion,
                              votre compte NZOKO existant est relié automatiquement.
                            </span>
                          </p>
                        )}
                        <Button type="submit" size="lg" disabled={loginForm.formState.isSubmitting} className="h-12 w-full">
                          {loginForm.formState.isSubmitting ? (
                            <Loader2 className="size-5 animate-spin" aria-hidden />
                          ) : (
                            <ArrowRight className="size-5" aria-hidden />
                          )}
                          {loginForm.formState.isSubmitting ? "Connexion…" : "Se connecter"}
                        </Button>
                      </form>
                    </Form>
                  ) : neon ? (
                    // ---- Inscription (mode Neon : e-mail + code de vérification) ----
                    <Form {...emailSignupForm}>
                      <form onSubmit={emailSignupForm.handleSubmit(onEmailSignup)} noValidate className="space-y-4">
                        <FormField
                          control={emailSignupForm.control}
                          name="name"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Nom complet</FormLabel>
                              <FormControl>
                                <div className="relative">
                                  <UserRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                                  <Input {...field} autoComplete="name" className="h-11 pl-9" placeholder="Grâce Mabika" />
                                </div>
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={emailSignupForm.control}
                          name="email"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Adresse e-mail</FormLabel>
                              <FormControl>
                                <div className="relative">
                                  <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                                  <Input {...field} type="email" inputMode="email" autoComplete="email" className="h-11 pl-9" placeholder="vous@exemple.cg" />
                                </div>
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={emailSignupForm.control}
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
                                    autoComplete="new-password"
                                    className="h-11 pl-9 pr-11"
                                    placeholder="8 caractères min."
                                  />
                                  {passwordAdornment(showPassword, () => setShowPassword((v) => !v), "le mot de passe")}
                                </div>
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <Button type="submit" size="lg" disabled={emailSignupForm.formState.isSubmitting} className="h-12 w-full">
                          {emailSignupForm.formState.isSubmitting ? (
                            <Loader2 className="size-5 animate-spin" aria-hidden />
                          ) : (
                            <CheckCircle2 className="size-5" aria-hidden />
                          )}
                          {emailSignupForm.formState.isSubmitting ? "Création…" : "Créer mon compte"}
                        </Button>
                        <p className="text-center text-xs text-muted-foreground">
                          Un code de vérification vous sera envoyé par e-mail. Vous pourrez ensuite lier votre
                          téléphone pour vous connecter par SMS.
                        </p>
                      </form>
                    </Form>
                  ) : (
                    // ---- Inscription (mode local : formulaire complet) ----
                    <Form {...registerForm}>
                      <form onSubmit={registerForm.handleSubmit(onRegister)} noValidate className="space-y-4">
                        <div className="grid gap-4 sm:grid-cols-2">
                          <FormField
                            control={registerForm.control}
                            name="firstName"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Prénom</FormLabel>
                                <FormControl>
                                  <div className="relative">
                                    <UserRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                                    <Input {...field} autoComplete="given-name" className="h-11 pl-9" placeholder="Grâce" />
                                  </div>
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={registerForm.control}
                            name="lastName"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Nom</FormLabel>
                                <FormControl>
                                  <Input {...field} autoComplete="family-name" className="h-11" placeholder="Mabika" />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>
                        <FormField
                          control={registerForm.control}
                          name="phone"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Téléphone</FormLabel>
                              <FormControl>
                                <div className="relative">
                                  <Phone className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                                  <Input {...field} type="tel" inputMode="tel" autoComplete="tel" className="h-11 pl-9" placeholder="06 123 45 67" />
                                </div>
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={registerForm.control}
                          name="email"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Adresse e-mail</FormLabel>
                              <FormControl>
                                <div className="relative">
                                  <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                                  <Input {...field} type="email" inputMode="email" autoComplete="email" className="h-11 pl-9" placeholder="vous@exemple.cg" />
                                </div>
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <div className="grid gap-4 sm:grid-cols-2">
                          <FormField
                            control={registerForm.control}
                            name="password"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Mot de passe</FormLabel>
                                <FormControl>
                                  <div className="relative">
                                    <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                                    <Input {...field} type={showPassword ? "text" : "password"} autoComplete="new-password" className="h-11 pl-9 pr-11" placeholder="8 caractères min." />
                                    {passwordAdornment(showPassword, () => setShowPassword((v) => !v), "le mot de passe")}
                                  </div>
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={registerForm.control}
                            name="confirmPassword"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Confirmation</FormLabel>
                                <FormControl>
                                  <div className="relative">
                                    <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                                    <Input {...field} type={showConfirm ? "text" : "password"} autoComplete="new-password" className="h-11 pl-9 pr-11" placeholder="••••••••" />
                                    {passwordAdornment(showConfirm, () => setShowConfirm((v) => !v), "la confirmation")}
                                  </div>
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>
                        <Button type="submit" size="lg" disabled={registerForm.formState.isSubmitting} className="h-12 w-full">
                          {registerForm.formState.isSubmitting ? (
                            <Loader2 className="size-5 animate-spin" aria-hidden />
                          ) : (
                            <CheckCircle2 className="size-5" aria-hidden />
                          )}
                          {registerForm.formState.isSubmitting ? "Création…" : "Créer mon compte"}
                        </Button>
                      </form>
                    </Form>
                  )}
                    </>
                  )}
                </TabsContent>
              </Tabs>
            )}

            <div className="mt-5 border-t pt-4">
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
