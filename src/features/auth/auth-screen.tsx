"use client";

// ============================================================
// NZOKO — Écran d'authentification (clients & équipes)
// DEUX accès, rien de plus :
//  • Connexion   → le client A DÉJÀ un compte (email ou téléphone
//                  + mot de passe ; comptes clients gérés par
//                  Supabase lorsqu'il est configuré).
//  • Inscription → le client N'A PAS de compte (prénom, nom,
//                  téléphone, email, mot de passe).
// ============================================================

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { motion } from "framer-motion";
import {
  ArrowLeft, ArrowRight, Bell, Bus, CheckCircle2, Eye, EyeOff, Loader2, Lock, LogIn, Mail,
  Phone, ShieldCheck, Star, Ticket, UserPlus, UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, ApiClientError } from "@/lib/api-client";
import { useApp } from "@/lib/store";
import type { RegisterResult, SessionUser } from "@/types";

// ---------- Schémas ----------

const loginSchema = z.object({
  identifier: z.string().trim().min(3, "Renseignez votre e-mail ou votre numéro de téléphone."),
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
      // NOTE : pas de .transform() ici — zodResolver v5 + zod v4 ne propage
      // pas correctement les transformations chaînées (refine sur valeur brute).
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

// ---------- Avantages (panneau de marque) ----------

const BENEFITS = [
  { icon: Ticket, title: "Tous vos billets au même endroit", text: "Historique complet, QR codes et reçus toujours disponibles." },
  { icon: Star, title: "Des points à chaque voyage", text: "100 points par trajet payé, réductions dès 500 points." },
  { icon: Bell, title: "Alertes intelligentes", text: "Départ dans 2 h, confirmation de paiement, promotions." },
  { icon: ShieldCheck, title: "Réclamations suivies", text: "Un numéro de dossier et une réponse de nos équipes." },
];

export default function AuthScreen({ defaultTab = "login" }: { defaultTab?: "login" | "register" }) {
  const setSession = useApp((s) => s.setSession);
  const setView = useApp((s) => s.setView);
  const [tab, setTab] = useState<"login" | "register">(defaultTab);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [supabase, setSupabase] = useState<boolean | null>(null);
  const [confirmation, setConfirmation] = useState<{ email: string } | null>(null);

  useEffect(() => {
    setTab(defaultTab);
  }, [defaultTab]);

  // Modes d'authentification actifs (badge Supabase)
  useEffect(() => {
    api.auth
      .providers()
      .then((p) => setSupabase(p.supabase))
      .catch(() => setSupabase(false));
  }, []);

  const loginForm = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { identifier: "", password: "" },
  });
  const registerForm = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { firstName: "", lastName: "", phone: "", email: "", password: "", confirmPassword: "" },
  });

  const onSession = (user: SessionUser) => {
    setSession(user);
    setView("workspace");
    toast.success(`Bienvenue ${user.firstName} !`, { description: user.roleLabel });
  };

  // ---------- Connexion (compte existant) ----------
  const onLogin = async (values: LoginValues) => {
    setError(null);
    try {
      onSession(await api.auth.login(values.identifier.trim(), values.password));
    } catch (err) {
      const message = err instanceof ApiClientError ? err.message : "Connexion impossible. Vérifiez votre réseau.";
      setError(message);
      toast.error(message);
    }
  };

  // ---------- Inscription (nouveau compte) ----------
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
        // Mode Supabase avec confirmation d'e-mail activée
        setConfirmation({ email: result.email });
        return;
      }
      onSession(result);
    } catch (err) {
      const message = err instanceof ApiClientError ? err.message : "Inscription impossible. Vérifiez votre réseau.";
      setError(message);
      toast.error(message);
    }
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
              <h2 className="mt-3 text-xl font-bold lg:mt-0">
                {tab === "login" ? "Content de vous revoir" : "Créer mon compte"}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {tab === "login"
                  ? "Connectez-vous pour accéder à vos billets et points fidélité."
                  : "Quelques informations et vos billets achetés avec ce numéro remontent automatiquement."}
              </p>
            </div>

            {confirmation ? (
              // ---------- Confirmation d'e-mail requise (Supabase) ----------
              <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="space-y-4 py-6 text-center">
                <span className="mx-auto flex size-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                  <Mail className="size-8" aria-hidden />
                </span>
                <div>
                  <h3 className="text-lg font-bold">Vérifiez votre boîte mail</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Un lien de confirmation a été envoyé à{" "}
                    <span className="font-medium text-foreground">{confirmation.email}</span>.
                    Cliquez dessus puis connectez-vous.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="lg"
                  className="h-11 w-full"
                  onClick={() => {
                    setConfirmation(null);
                    setTab("login");
                  }}
                >
                  <LogIn className="size-4" aria-hidden /> Aller à la connexion
                </Button>
              </motion.div>
            ) : (
              <Tabs value={tab} onValueChange={(v) => { setTab(v as "login" | "register"); setError(null); }}>
                <TabsList className="grid h-12 w-full grid-cols-2">
                  <TabsTrigger value="login" className="gap-1.5 text-sm">
                    <LogIn className="size-4" aria-hidden /> Connexion
                  </TabsTrigger>
                  <TabsTrigger value="register" className="gap-1.5 text-sm">
                    <UserPlus className="size-4" aria-hidden /> Inscription
                  </TabsTrigger>
                </TabsList>

                {/* ================= CONNEXION ================= */}
                <TabsContent value="login" className="mt-5 space-y-4">
                  {error && errBox(error)}
                  <Form {...loginForm}>
                    <form onSubmit={loginForm.handleSubmit(onLogin)} noValidate className="space-y-4">
                      <FormField
                        control={loginForm.control}
                        name="identifier"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Email ou téléphone</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                type="text"
                                autoComplete="username"
                                className="h-11"
                                placeholder="vous@exemple.cg ou 06 123 45 67"
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
                  <p className="text-center text-sm text-muted-foreground">
                    Pas encore de compte ?{" "}
                    <button
                      type="button"
                      onClick={() => { setTab("register"); setError(null); }}
                      className="font-medium text-primary hover:underline"
                    >
                      Je m&apos;inscris
                    </button>
                  </p>
                </TabsContent>

                {/* ================= INSCRIPTION ================= */}
                <TabsContent value="register" className="mt-5 space-y-4">
                  {error && errBox(error)}
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

                      {supabase && (
                        <p className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300" role="status">
                          <ShieldCheck className="size-4 shrink-0" aria-hidden />
                          Vos identifiants sont protégés par <strong>Supabase Auth</strong>.
                        </p>
                      )}

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
                  <p className="text-center text-sm text-muted-foreground">
                    Vous avez déjà un compte ?{" "}
                    <button
                      type="button"
                      onClick={() => { setTab("login"); setError(null); }}
                      className="font-medium text-primary hover:underline"
                    >
                      Je me connecte
                    </button>
                  </p>
                </TabsContent>
              </Tabs>
            )}

            {!confirmation && (
              <div className="mt-5 border-t pt-4">
                <Button variant="ghost" onClick={() => setView("home")} className="h-11 w-full gap-1.5">
                  <ArrowLeft className="size-4" aria-hidden /> Retour à l&apos;accueil
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </section>
  );
}
