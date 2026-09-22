"use client";

// ============================================================
// NZOKO — Création de compte client « MON ESPACE NZOKO »
// Prénom, nom, téléphone (requis), e-mail (optionnel),
// mot de passe + confirmation. Les billets achetés avec le
// même numéro sont rattachés automatiquement au compte.
// ============================================================

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { motion } from "framer-motion";
import {
  ArrowLeft, Bus, Eye, EyeOff, Gift, Loader2, Lock, Mail, Phone, Sparkles, User, UserPlus,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { api, ApiClientError } from "@/lib/api-client";
import { useApp } from "@/lib/store";
import { LOYALTY } from "@/lib/constants";
import { cn } from "@/lib/utils";

const registerSchema = z
  .object({
    firstName: z.string().trim().min(2, "Le prénom est requis (2 caractères minimum)."),
    lastName: z.string().trim().min(2, "Le nom est requis (2 caractères minimum)."),
    phone: z
      .string()
      .trim()
      .refine(
        (v) => /^(\+?242)?0?\d{8,9}$/.test(v.replace(/[\s.\-()]/g, "")),
        "Numéro invalide. Ex : 06 123 45 67 ou +242 06 123 45 67."
      ),
    email: z
      .string()
      .trim()
      .refine((v) => !v || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), "Adresse e-mail invalide.")
      .optional(),
    password: z.string().min(8, "Mot de passe : 8 caractères minimum."),
    confirmPassword: z.string().min(1, "Confirmez votre mot de passe."),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "Les mots de passe ne correspondent pas.",
  });

type RegisterValues = z.infer<typeof registerSchema>;

/** Indicateur de force simple : 0 (trop court) → 3 (solide). */
function passwordScore(pw: string): 0 | 1 | 2 | 3 {
  if (pw.length < 8) return 0;
  let score = 1;
  if (/\d/.test(pw) && /[a-zA-Z]/.test(pw)) score += 1;
  if (pw.length >= 12 || (/[^a-zA-Z0-9]/.test(pw) && /[A-Z]/.test(pw) && /\d/.test(pw))) score += 1;
  return Math.min(3, score) as 0 | 1 | 2 | 3;
}

const STRENGTH_LABELS = ["Trop court", "Faible", "Moyen", "Solide"] as const;
const STRENGTH_COLORS = ["bg-zinc-300", "bg-red-400", "bg-amber-400", "bg-emerald-500"] as const;

export default function RegisterView() {
  const setSession = useApp((s) => s.setSession);
  const setView = useApp((s) => s.setView);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const form = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { firstName: "", lastName: "", phone: "", email: "", password: "", confirmPassword: "" },
  });

  // Indicateur de force : miroir local du champ (mis à jour via onChange —
  // form.watch en rendu est incompatible react-compiler).
  const [password, setPassword] = useState("");
  const score = passwordScore(password);

  const onSubmit = async (values: RegisterValues) => {
    setError(null);
    try {
      const user = await api.auth.register({
        firstName: values.firstName.trim(),
        lastName: values.lastName.trim(),
        phone: values.phone.replace(/[\s.\-()]/g, ""),
        email: values.email?.trim() ? values.email.trim() : undefined,
        password: values.password,
      });
      setSession(user);
      setView("workspace");
      toast.success("Bienvenue chez NZOKO 🎉", {
        description: "Votre espace client est prêt — vos anciens billets seront rattachés automatiquement.",
      });
    } catch (err) {
      const message = err instanceof ApiClientError ? err.message : "Inscription impossible. Vérifiez votre réseau.";
      setError(message);
      toast.error(message);
    }
  };

  return (
    <section className="mx-auto flex w-full max-w-md flex-col px-4 py-8" aria-label="Création de compte">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
        <Card className="border shadow-lg shadow-primary/5">
          <CardHeader className="items-center text-center">
            <span className="nzoko-hero mx-auto flex size-14 items-center justify-center rounded-2xl text-white shadow-md">
              <Bus className="size-7" aria-hidden />
            </span>
            <CardTitle className="mt-3 text-xl">Créer mon compte</CardTitle>
            <CardDescription>
              Rejoignez NZOKO et gagnez des points à chaque voyage.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && (
              <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                {error}
              </p>
            )}

            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="firstName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Prénom</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <User className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                            <Input {...field} autoComplete="given-name" className="h-11 pl-9" placeholder="Ex : Marie" />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="lastName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Nom</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <User className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                            <Input {...field} autoComplete="family-name" className="h-11 pl-9" placeholder="Ex : Nkouka" />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Téléphone</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Phone className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                          <Input
                            {...field}
                            type="tel"
                            inputMode="tel"
                            autoComplete="tel"
                            className="h-11 pl-9"
                            placeholder="+242 06 123 45 67"
                          />
                        </div>
                      </FormControl>
                      <FormMessage />
                      <p className="text-[11px] text-muted-foreground">
                        Vos billets achetés avec ce numéro seront rattachés automatiquement.
                      </p>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-1.5">
                        E-mail
                        <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground">optionnel</Badge>
                      </FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                          <Input {...field} type="email" autoComplete="email" className="h-11 pl-9" placeholder="vous@exemple.cg" />
                        </div>
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
                            autoComplete="new-password"
                            className="h-11 pl-9 pr-11"
                            placeholder="8 caractères minimum"
                            onChange={(e) => {
                              field.onChange(e);
                              setPassword(e.target.value);
                            }}
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
                      {password.length > 0 && (
                        <div className="flex items-center gap-2" aria-live="polite">
                          <div className="flex flex-1 gap-1">
                            {[0, 1, 2].map((i) => (
                              <span
                                key={i}
                                className={cn("h-1.5 flex-1 rounded-full transition-colors", i < score ? STRENGTH_COLORS[score] : "bg-muted")}
                              />
                            ))}
                          </div>
                          <span className="text-[11px] text-muted-foreground">{STRENGTH_LABELS[score]}</span>
                        </div>
                      )}
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="confirmPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Confirmation du mot de passe</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                          <Input
                            {...field}
                            type={showPassword ? "text" : "password"}
                            autoComplete="new-password"
                            className="h-11 pl-9"
                            placeholder="Ressaisissez votre mot de passe"
                          />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Bénéfices du compte */}
                <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3" role="note">
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-primary">
                    <Sparkles className="size-4 shrink-0" aria-hidden /> Avantages du compte
                  </p>
                  <ul className="mt-2 space-y-1 text-xs leading-relaxed text-muted-foreground">
                    <li className="flex items-start gap-1.5">
                      <Gift className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
                      Retrouvez tous vos billets et vos voyages
                    </li>
                    <li className="flex items-start gap-1.5">
                      <Gift className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
                      Gagnez {LOYALTY.pointsPerTrip} points par voyage et échangez-les contre des réductions
                    </li>
                    <li className="flex items-start gap-1.5">
                      <Gift className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
                      Suivi de vos réclamations et réponses de nos équipes
                    </li>
                  </ul>
                </div>

                <Button type="submit" size="lg" disabled={form.formState.isSubmitting} className="h-12 w-full">
                  {form.formState.isSubmitting ? (
                    <Loader2 className="size-5 animate-spin" aria-hidden />
                  ) : (
                    <UserPlus className="size-5" aria-hidden />
                  )}
                  {form.formState.isSubmitting ? "Création du compte…" : "Créer mon compte"}
                </Button>
              </form>
            </Form>

            <div className="space-y-1 pt-1">
              <Button variant="ghost" onClick={() => setView("login")} className="h-11 w-full gap-1.5">
                <ArrowLeft className="size-4" aria-hidden /> J&apos;ai déjà un compte
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
