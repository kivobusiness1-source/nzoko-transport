"use client";

// ============================================================
// NZOKO TRANSPORT — Utilisateurs (recherche + gestion)
// Création, activation/désactivation, réinitialisation mdp
// ============================================================

import { useState } from "react";
import { toast } from "sonner";
import { KeyRound, Search, UserPlus, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { api, hasPerm } from "@/lib/api-client";
import { ROLE_LABELS } from "@/lib/constants";
import type { RoleCode } from "@/lib/constants";
import { formatDate, relativeTime } from "@/lib/format";
import { apiErrorMessage, useApiData, useDebounced } from "@/components/shared/nzoko-use-api";
import { NzokoEmptyState } from "@/components/shared/nzoko-empty-state";
import { NzokoErrorBox } from "@/components/shared/nzoko-error-box";
import { NzokoListSkeleton } from "@/components/shared/nzoko-skeletons";
import { useApp } from "@/lib/store";
import type { AgencyDTO, RoleDTO, UserDTO } from "@/types";

export function AdminUsers({ refreshKey }: { refreshKey?: number }) {
  const { session } = useApp();
  const [q, setQ] = useState("");
  const debouncedQ = useDebounced(q);
  const [formOpen, setFormOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState<UserDTO | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const canManage = session ? hasPerm(session, "user:manage") : false;

  const { data, loading, error, reload } = useApiData(
    () => api.admin.users(debouncedQ || undefined),
    { refetchKey: [debouncedQ], refreshKey },
  );

  const users = data ?? [];

  const toggleActive = async (user: UserDTO, isActive: boolean) => {
    setBusyId(user.id);
    try {
      await api.admin.updateUser(user.id, { isActive });
      toast.success(`${user.fullName} ${isActive ? "activé" : "désactivé"}.`);
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Rechercher (nom, email, rôle…)"
            className="h-11 pl-9"
            aria-label="Rechercher un utilisateur"
          />
        </div>
        {canManage && (
          <Button className="h-11 gap-2" onClick={() => setFormOpen(true)}>
            <UserPlus className="h-4 w-4" aria-hidden="true" /> Nouvel utilisateur
          </Button>
        )}
      </div>

      <div className="mt-4">
        {loading && <NzokoListSkeleton count={4} />}
        {error && <NzokoErrorBox error={error} onRetry={reload} />}
        {!loading && !error && users.length === 0 && (
          <NzokoEmptyState
            icon={UserRound}
            title="Aucun utilisateur"
            description="Aucun utilisateur ne correspond à cette recherche."
          />
        )}
        {!loading && !error && users.length > 0 && (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {users.map((u) => (
              <Card key={u.id} className="gap-2.5 p-4">
                {/* flex-wrap : un badge de rôle long (« Contrôleur
                    embarquement ») passe sous le nom au lieu de comprimer la
                    carte sur les petits écrans. */}
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold">{u.fullName}</p>
                    <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                  </div>
                  <Badge variant="outline" className="ml-auto shrink-0 border-primary/30 bg-primary/10 text-primary">
                    {u.roleLabel ?? ROLE_LABELS[u.role as RoleCode] ?? u.role}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {u.agencyName ?? "Toutes agences"}
                </p>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[11px] text-muted-foreground">
                    {u.lastLoginAt ? `Connexion ${relativeTime(u.lastLoginAt)}` : "Jamais connecté"}
                    {u.lastLoginAt ? ` · ${formatDate(u.lastLoginAt)}` : ""}
                  </p>
                  {canManage && (
                    <div className="flex items-center gap-2">
                      <Label htmlFor={`user-active-${u.id}`} className="text-xs text-muted-foreground">
                        {u.isActive ? "Actif" : "Inactif"}
                      </Label>
                      <Switch
                        id={`user-active-${u.id}`}
                        checked={u.isActive}
                        disabled={busyId === u.id}
                        onCheckedChange={(v) => void toggleActive(u, v)}
                        aria-label={`Activer ${u.fullName}`}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-9 gap-1.5"
                        onClick={() => setResetTarget(u)}
                      >
                        <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                        <span className="hidden sm:inline">Mot de passe</span>
                      </Button>
                    </div>
                  )}
                  {!canManage && (
                    <Badge variant={u.isActive ? "secondary" : "outline"}>
                      {u.isActive ? "Actif" : "Inactif"}
                    </Badge>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {formOpen && <AdminUserForm onClose={() => setFormOpen(false)} onCreated={reload} />}
      {resetTarget && (
        <AdminUserResetForm
          user={resetTarget}
          onClose={() => setResetTarget(null)}
          onDone={reload}
        />
      )}
    </div>
  );
}

function AdminUserForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { data: roles } = useApiData(() => api.admin.roles(), {});
  const { data: agencies } = useApiData(() => api.admin.agencies(), {});

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<string>("AGENT");
  const [agencyId, setAgencyId] = useState("NONE");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (firstName.trim().length < 2 || lastName.trim().length < 2) {
      toast.error("Renseignez le prénom et le nom.");
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      toast.error("Saisissez une adresse email valide.");
      return;
    }
    if (password.length < 8) {
      toast.error("Le mot de passe doit contenir au moins 8 caractères.");
      return;
    }
    setSubmitting(true);
    try {
      const user = await api.admin.createUser({
        email: email.trim().toLowerCase(),
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        password,
        role: role as RoleCode,
        agencyId: agencyId === "NONE" ? null : agencyId,
      });
      toast.success(`Utilisateur ${user.fullName} créé (${user.email}).`);
      onCreated();
      onClose();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="nzoko-scroll max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nouvel utilisateur</DialogTitle>
          <DialogDescription>
            Le mot de passe est chiffré (bcrypt). L&apos;utilisateur pourra le changer à la première connexion.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="user-first">Prénom</Label>
              <Input
                id="user-first"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="h-11"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="user-last">Nom</Label>
              <Input
                id="user-last"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="h-11"
                required
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="user-email">Email</Label>
            <Input
              id="user-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="geormakoma1+agent@gmail.com"
              className="h-11"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="user-password">Mot de passe (8 caractères min.)</Label>
            <Input
              id="user-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-11"
              required
              minLength={8}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="user-role">Rôle</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger id="user-role" className="h-11" aria-label="Rôle de l'utilisateur">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(roles ?? []).map((r: RoleDTO) => (
                    <SelectItem key={r.id} value={r.code}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="user-agency">Agence</Label>
              <Select value={agencyId} onValueChange={setAgencyId}>
                <SelectTrigger id="user-agency" className="h-11" aria-label="Agence de l'utilisateur">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">Aucune (accès global)</SelectItem>
                  {(agencies ?? []).map((a: AgencyDTO) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" className="h-11" onClick={onClose}>
              Annuler
            </Button>
            <Button type="submit" className="h-11" disabled={submitting}>
              {submitting ? "Création…" : "Créer l'utilisateur"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AdminUserResetForm({
  user,
  onClose,
  onDone,
}: {
  user: UserDTO;
  onClose: () => void;
  onDone: () => void;
}) {
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (password.length < 8) {
      toast.error("Le mot de passe doit contenir au moins 8 caractères.");
      return;
    }
    setSubmitting(true);
    try {
      await api.admin.updateUser(user.id, { password });
      toast.success(`Mot de passe de ${user.fullName} réinitialisé.`);
      onDone();
      onClose();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Réinitialiser le mot de passe</DialogTitle>
          <DialogDescription>
            Nouveau mot de passe pour {user.fullName} ({user.email}).
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="reset-password">Nouveau mot de passe</Label>
            <Input
              id="reset-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-11"
              required
              minLength={8}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" className="h-11" onClick={onClose}>
              Annuler
            </Button>
            <Button type="submit" className="h-11" disabled={submitting}>
              {submitting ? "Réinitialisation…" : "Réinitialiser"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
