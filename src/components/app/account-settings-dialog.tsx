"use client";

// ============================================================
// OCÉAN DU NORD — Paramètres du compte (dialogue)
// ============================================================
// Accessible depuis le menu utilisateur (tous les rôles connectés).
// Fonctionnalité 2026-09 « reprise de l'authentification » : chaque
// membre de l'administration Océan du Nord démarre avec une adresse technique
// kivobusiness1+<rôle>@gmail.com (boîte unique kivobusiness1@gmail.com)
// et peut LA REMPLACER par son adresse personnelle ici — le changement
// s'applique chez Neon Auth (source de vérité de la connexion) et dans
// le miroir applicatif, puis révoque toutes les sessions : reconnexion
// immédiate avec la nouvelle adresse.
// ============================================================

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Mail, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiClientError } from "@/lib/api-client";
import { useApp } from "@/lib/store";

export function AccountSettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { session, logout } = useApp();
  const [newEmail, setNewEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [passwordStep, setPasswordStep] = useState(false);
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setNewEmail("");
    setCurrentPassword("");
    setPasswordStep(false);
    setSaving(false);
  };

  const close = () => {
    if (saving) return;
    reset();
    onOpenChange(false);
  };

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(newEmail.trim());
  const isOwnAddress = session?.email?.toLowerCase() === newEmail.trim().toLowerCase();

  const startChange = () => {
    if (!emailValid) {
      toast.error("Saisissez une adresse e-mail valide.");
      return;
    }
    if (isOwnAddress) {
      toast.error("Cette adresse est déjà celle de votre compte.");
      return;
    }
    setPasswordStep(true);
  };

  const confirmChange = async () => {
    if (!currentPassword) {
      toast.error("Saisissez votre mot de passe actuel pour confirmer.");
      return;
    }
    setSaving(true);
    try {
      const result = await api.account.changeEmail(newEmail.trim(), currentPassword);
      toast.success("Adresse e-mail mise à jour ✅", {
        description: `Reconnectez-vous avec ${result.email}.`,
        duration: 8000,
      });
      reset();
      onOpenChange(false);
      // Le serveur a révoqué toutes les sessions : déconnexion propre
      await logout();
    } catch (err) {
      const message = err instanceof ApiClientError ? err.message : "Changement impossible. Réessayez.";
      toast.error(message);
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-primary" aria-hidden />
            Paramètres du compte
          </DialogTitle>
          <DialogDescription>
            Gérez l&apos;adresse e-mail utilisée pour vous connecter.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Adresse actuelle */}
          <div className="rounded-lg border bg-muted/40 p-3">
            <p className="text-xs font-medium text-muted-foreground">Adresse actuelle</p>
            <p className="mt-1 flex items-center gap-2 break-all text-sm font-semibold">
              <Mail className="size-4 shrink-0 text-primary" aria-hidden />
              {session?.email}
            </p>
          </div>

          {!passwordStep ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="new-email">Nouvelle adresse e-mail</Label>
                <Input
                  id="new-email"
                  type="email"
                  autoComplete="email"
                  placeholder="prenom.nom@exemple.com"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  disabled={saving}
                  className="min-h-[44px]"
                />
                <p className="text-xs text-muted-foreground">
                  Après le changement, vous vous connecterez avec cette nouvelle adresse (et le même
                  mot de passe). Toutes vos sessions seront déconnectées.
                </p>
              </div>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button variant="outline" onClick={close} disabled={saving} className="min-h-[44px] sm:min-h-0">
                  Annuler
                </Button>
                <Button onClick={startChange} disabled={saving || !emailValid || isOwnAddress} className="min-h-[44px] sm:min-h-0">
                  Continuer
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">Mot de passe actuel</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="••••••••••"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !saving) void confirmChange();
                  }}
                  autoFocus
                  disabled={saving}
                  className="min-h-[44px]"
                />
                <p className="text-xs text-muted-foreground">
                  Confirmation de votre identité pour remplacer l&apos;adresse par{" "}
                  <span className="font-medium text-foreground">{newEmail.trim()}</span>.
                </p>
              </div>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button
                  variant="outline"
                  onClick={() => {
                    setPasswordStep(false);
                    setCurrentPassword("");
                  }}
                  disabled={saving}
                  className="min-h-[44px] sm:min-h-0"
                >
                  Retour
                </Button>
                <Button onClick={() => void confirmChange()} disabled={saving || !currentPassword} className="min-h-[44px] sm:min-h-0">
                  {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                  Confirmer le changement
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
