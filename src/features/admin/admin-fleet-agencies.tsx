"use client";

// ============================================================
// NZOKO TRANSPORT — Parc : agences (liste + création)
// ============================================================

import { useState } from "react";
import { toast } from "sonner";
import { Building2, Mail, MapPin, Phone, Plus } from "lucide-react";
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
import { api } from "@/lib/api-client";
import { apiErrorMessage, useApiData } from "@/components/shared/nzoko-use-api";
import { NzokoEmptyState } from "@/components/shared/nzoko-empty-state";
import { NzokoErrorBox } from "@/components/shared/nzoko-error-box";
import { NzokoListSkeleton } from "@/components/shared/nzoko-skeletons";

export function AdminFleetAgencies({ refreshKey }: { refreshKey?: number }) {
  const { data, loading, error, reload } = useApiData(() => api.admin.agencies(), { refreshKey });
  const [formOpen, setFormOpen] = useState(false);

  const agencies = data ?? [];

  return (
    <div>
      <div className="flex justify-end">
        <Button className="h-11 gap-2" onClick={() => setFormOpen(true)}>
          <Plus className="h-4 w-4" aria-hidden="true" /> Nouvelle agence
        </Button>
      </div>

      <div className="mt-4">
        {loading && <NzokoListSkeleton count={3} />}
        {error && <NzokoErrorBox error={error} onRetry={reload} />}
        {!loading && !error && agencies.length === 0 && (
          <NzokoEmptyState icon={Building2} title="Aucune agence" description="Créez la première agence NZOKO." />
        )}
        {!loading && !error && agencies.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {agencies.map((a) => (
              <Card key={a.id} className="gap-2 p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="font-mono text-[11px] font-bold text-primary">{a.code}</span>
                    <p className="truncate text-sm font-bold">{a.name}</p>
                  </div>
                  <Badge variant={a.isActive ? "secondary" : "outline"}>
                    {a.isActive ? "Active" : "Inactive"}
                  </Badge>
                </div>
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  {a.cityName ?? a.cityId}
                  {a.address ? ` · ${a.address}` : ""}
                </p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {a.phone && (
                    <p className="flex items-center gap-1.5">
                      <Phone className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      {a.phone}
                    </p>
                  )}
                  {a.email && (
                    <p className="flex items-center gap-1.5">
                      <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      {a.email}
                    </p>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {formOpen && <AdminAgencyForm onClose={() => setFormOpen(false)} onCreated={reload} />}
    </div>
  );
}

function AdminAgencyForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { data: cities } = useApiData(() => api.admin.cities(), {});

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [cityId, setCityId] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (code.trim().length < 2 || name.trim().length < 3) {
      toast.error("Renseignez un code (2 caractères min.) et un nom d'agence.");
      return;
    }
    if (!cityId) {
      toast.error("Sélectionnez la ville de l'agence.");
      return;
    }
    setSubmitting(true);
    try {
      await api.admin.createAgency({
        code: code.trim().toUpperCase(),
        name: name.trim(),
        cityId,
        address: address.trim() || undefined,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
      });
      toast.success(`Agence « ${name.trim()} » créée.`);
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nouvelle agence</DialogTitle>
          <DialogDescription>Le code d’agence doit être unique.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_2fr]">
            <div className="space-y-1.5">
              <Label htmlFor="agency-code">Code</Label>
              <Input
                id="agency-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="BZV"
                className="h-11"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="agency-name">Nom</Label>
              <Input
                id="agency-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Agence Brazzaville Centre"
                className="h-11"
                required
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="agency-city">Ville</Label>
            <Select value={cityId} onValueChange={setCityId}>
              <SelectTrigger id="agency-city" className="h-11" aria-label="Ville de l'agence">
                <SelectValue placeholder="Choisir" />
              </SelectTrigger>
              <SelectContent>
                {(cities ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="agency-address">Adresse (optionnel)</Label>
            <Input
              id="agency-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Avenue de l'Indépendance, Brazzaville"
              className="h-11"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="agency-phone">Téléphone (optionnel)</Label>
              <Input
                id="agency-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+242 06 000 0000"
                className="h-11"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="agency-email">Email (optionnel)</Label>
              <Input
                id="agency-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="geormakoma1+agence@gmail.com"
                className="h-11"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" className="h-11" onClick={onClose}>
              Annuler
            </Button>
            <Button type="submit" className="h-11" disabled={submitting}>
              {submitting ? "Création…" : "Créer l'agence"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
