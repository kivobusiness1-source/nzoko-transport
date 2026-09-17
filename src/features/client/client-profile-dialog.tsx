"use client";

// ============================================================
// NZOKO — Dialog profil client : prénom / nom / e-mail +
// changement de mot de passe. Le téléphone (clé de rattachement
// des billets) est affiché en lecture seule.
// ============================================================

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { KeyRound, Info, Loader2, Phone, Save, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api-client";
import { useApp } from "@/lib/store";
import { formatPhone } from "@/lib/phone";
import { friendlyApiError, type ApiErrorInfo } from "@/components/shared/nzoko-use-api";
import { NzokoErrorBox } from "@/components/shared/nzoko-error-box";
import type { ClientProfileDTO } from "@/types";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function ClientProfileDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const session = useApp((s) => s.session);
  const setSession = useApp((s) => s.setSession);

  const [profile, setProfile] = useState<ClientProfileDTO | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiErrorInfo | null>(null);

  const [form, setForm] = useState({ firstName: "", lastName: "", email: "" });
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [pw, setPw] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSaving, setPwSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.client.profile();
      setProfile(data);
      setForm({ firstName: data.firstName, lastName: data.lastName, email: data.emailIsSynthetic ? "" : data.email });
    } catch (err) {
      setError(friendlyApiError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
    if (!open) {
      setProfile(null);
      setError(null);
      setFormError(null);
      setPwError(null);
      setPw({ currentPassword: "", newPassword: "", confirm: "" });
    }
  }, [open, load]);

  const saveProfile = async () => {
    setFormError(null);
    const firstName = form.firstName.trim();
    const lastName = form.lastName.trim();
    const email = form.email.trim();
    if (firstName.length < 2 || lastName.length < 2) {
      setFormError("Le prénom et le nom sont requis (2 caractères minimum).");
      return;
    }
    if (email && !EMAIL_RE.test(email)) {
      setFormError("Adresse e-mail invalide.");
      return;
    }
    setSaving(true);
    try {
      const updated = await api.client.updateProfile({ firstName, lastName, email: email || undefined });
      setProfile(updated);
      toast.success("Profil mis à jour.");
      // Rafraîchit l'affichage global (en-têtes, menus) sans reconnexion.
      if (session) {
        setSession({
          ...session,
          firstName: updated.firstName,
          lastName: updated.lastName,
          fullName: `${updated.firstName} ${updated.lastName}`,
          email: updated.email,
        });
      }
    } catch (err) {
      const message = friendlyApiError(err).message;
      setFormError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const changePassword = async () => {
    setPwError(null);
    if (pw.currentPassword.length < 1) {
      setPwError("Renseignez votre mot de passe actuel.");
      return;
    }
    if (pw.newPassword.length < 8) {
      setPwError("Le nouveau mot de passe doit contenir 8 caractères minimum.");
      return;
    }
    if (pw.newPassword !== pw.confirm) {
      setPwError("Les mots de passe ne correspondent pas.");
      return;
    }
    setPwSaving(true);
    try {
      await api.client.changePassword({ currentPassword: pw.currentPassword, newPassword: pw.newPassword });
      toast.success("Mot de passe modifié.");
      setPw({ currentPassword: "", newPassword: "", confirm: "" });
    } catch (err) {
      const message = friendlyApiError(err).message;
      setPwError(message);
      toast.error(message);
    } finally {
      setPwSaving(false);
    }
  };

  // Compte client géré par Supabase Auth : le mot de passe ne se change
  // pas ici (section masquée, encart explicatif) — le profil reste éditable.
  const supabaseManaged = session?.authProvider === "SUPABASE";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="nzoko-scroll max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserRound className="size-5 text-primary" aria-hidden /> Mon profil
          </DialogTitle>
          <DialogDescription>
            Vos informations personnelles et la sécurité de votre compte.
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="space-y-3">
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
          </div>
        )}
        {error && !loading && <NzokoErrorBox error={error} onRetry={load} />}

        {profile && !loading && (
          <div className="space-y-5">
            {/* --- Identité --- */}
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="profile-firstname" className="mb-1.5">Prénom</Label>
                  <Input
                    id="profile-firstname"
                    value={form.firstName}
                    onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
                    className="h-11"
                    autoComplete="given-name"
                  />
                </div>
                <div>
                  <Label htmlFor="profile-lastname" className="mb-1.5">Nom</Label>
                  <Input
                    id="profile-lastname"
                    value={form.lastName}
                    onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
                    className="h-11"
                    autoComplete="family-name"
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="profile-email" className="mb-1.5">
                  E-mail <span className="font-normal text-muted-foreground">(optionnel)</span>
                </Label>
                <Input
                  id="profile-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  className="h-11"
                  placeholder="vous@exemple.cg"
                  autoComplete="email"
                />
                {profile.emailIsSynthetic && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Aucun e-mail renseigné : renseignez-en un pour recevoir vos confirmations.
                  </p>
                )}
              </div>
              <div>
                <Label className="mb-1.5">Téléphone</Label>
                <p className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2.5 text-sm">
                  <Phone className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="font-medium">{formatPhone(profile.phone)}</span>
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Le téléphone identifie votre compte — vos billets y sont rattachés.
                </p>
              </div>

              {formError && (
                <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                  {formError}
                </p>
              )}

              <Button onClick={saveProfile} disabled={saving} className="h-11 w-full gap-1.5">
                {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Save className="size-4" aria-hidden />}
                {saving ? "Enregistrement…" : "Enregistrer mon profil"}
              </Button>
            </div>

            <Separator />

            {/* --- Mot de passe --- */}
            {supabaseManaged ? (
              <p className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
                <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                <span>
                  <span className="font-semibold text-foreground">Mot de passe géré par Supabase.</span>{" "}
                  Utilisez la réinitialisation depuis l&apos;écran de connexion pour le modifier — vos identifiants NZOKO restent inchangés.
                </span>
              </p>
            ) : (
            <div className="space-y-3">
              <p className="flex items-center gap-1.5 text-sm font-semibold">
                <KeyRound className="size-4 text-primary" aria-hidden /> Changer mon mot de passe
              </p>
              <div>
                <Label htmlFor="pw-current" className="mb-1.5">Mot de passe actuel</Label>
                <Input
                  id="pw-current"
                  type="password"
                  value={pw.currentPassword}
                  onChange={(e) => setPw((p) => ({ ...p, currentPassword: e.target.value }))}
                  className="h-11"
                  autoComplete="current-password"
                />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="pw-new" className="mb-1.5">Nouveau mot de passe</Label>
                  <Input
                    id="pw-new"
                    type="password"
                    value={pw.newPassword}
                    onChange={(e) => setPw((p) => ({ ...p, newPassword: e.target.value }))}
                    className="h-11"
                    autoComplete="new-password"
                    placeholder="8 caractères minimum"
                  />
                </div>
                <div>
                  <Label htmlFor="pw-confirm" className="mb-1.5">Confirmation</Label>
                  <Input
                    id="pw-confirm"
                    type="password"
                    value={pw.confirm}
                    onChange={(e) => setPw((p) => ({ ...p, confirm: e.target.value }))}
                    className="h-11"
                    autoComplete="new-password"
                  />
                </div>
              </div>

              {pwError && (
                <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                  {pwError}
                </p>
              )}

              <Button variant="outline" onClick={changePassword} disabled={pwSaving} className="h-11 w-full gap-1.5">
                {pwSaving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <KeyRound className="size-4" aria-hidden />}
                {pwSaving ? "Modification…" : "Modifier mon mot de passe"}
              </Button>
            </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
