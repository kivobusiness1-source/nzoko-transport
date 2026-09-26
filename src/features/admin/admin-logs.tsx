"use client";

// ============================================================
// OCÉAN DU NORD — Journal : audit & sécurité (paginés)
// ============================================================

import { useState } from "react";
import { ScrollText, Search, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { useApiData, useDebounced } from "@/components/shared/nzoko-use-api";
import { NzokoSubTabs } from "@/components/shared/nzoko-chips";
import { NzokoEmptyState } from "@/components/shared/nzoko-empty-state";
import { NzokoErrorBox } from "@/components/shared/nzoko-error-box";
import { NzokoListSkeleton } from "@/components/shared/nzoko-skeletons";
import { NzokoPagination } from "@/components/shared/nzoko-pagination";
import type { AuditLogDTO, SecurityLogDTO } from "@/types";

const SECURITY_EVENTS = [
  { value: "LOGIN_FAILED", label: "Connexion échouée" },
  { value: "RATE_LIMITED", label: "Limite de requêtes" },
  { value: "ACCESS_DENIED", label: "Accès refusé" },
  { value: "SUSPICIOUS", label: "Activité suspecte" },
  { value: "WEBHOOK_REJECTED", label: "Webhook rejeté" },
];

const EVENT_TONES: Record<string, string> = {
  LOGIN_FAILED: "border-amber-300 bg-amber-100 text-amber-800",
  RATE_LIMITED: "border-orange-300 bg-orange-100 text-orange-800",
  ACCESS_DENIED: "border-red-300 bg-red-100 text-red-800",
  SUSPICIOUS: "border-violet-300 bg-violet-100 text-violet-800",
  WEBHOOK_REJECTED: "border-zinc-300 bg-zinc-100 text-zinc-600",
};

export function AdminLogs({ refreshKey }: { refreshKey?: number }) {
  const [sub, setSub] = useState("audit");

  return (
    <div className="space-y-4">
      <NzokoSubTabs
        tabs={[
          { key: "audit", label: "Audit", icon: ScrollText },
          { key: "security", label: "Sécurité", icon: ShieldAlert },
        ]}
        active={sub}
        onChange={setSub}
        ariaLabel="Sections du journal"
      />
      {sub === "audit" ? <AuditLogsSection refreshKey={refreshKey} /> : <SecurityLogsSection refreshKey={refreshKey} />}
    </div>
  );
}

function AuditLogsSection({ refreshKey }: { refreshKey?: number }) {
  const [entity, setEntity] = useState("");
  const debouncedEntity = useDebounced(entity);
  const [page, setPage] = useState(1);

  // Retour en page 1 quand le filtre change (ajustement pendant le rendu).
  const [prevFilter, setPrevFilter] = useState(debouncedEntity);
  if (debouncedEntity !== prevFilter) {
    setPrevFilter(debouncedEntity);
    setPage(1);
  }

  const { data, loading, error, reload } = useApiData(
    () => api.logs.audit({ entity: debouncedEntity || undefined, page }),
    { refetchKey: [debouncedEntity, page], refreshKey },
  );

  const items = data?.items ?? [];

  return (
    <div>
      <div className="relative max-w-sm">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          value={entity}
          onChange={(e) => setEntity(e.target.value)}
          placeholder="Filtrer par entité (ex. TRIP, PAYMENT…)"
          className="h-11 pl-9"
          aria-label="Filtrer le journal d'audit"
        />
      </div>

      <div className="mt-4">
        {loading && <NzokoListSkeleton count={4} />}
        {error && <NzokoErrorBox error={error} onRetry={reload} />}
        {!loading && !error && items.length === 0 && (
          <NzokoEmptyState icon={ScrollText} title="Aucune entrée d'audit" />
        )}
        {!loading && !error && items.length > 0 && (
          <>
            <div className="grid gap-2 md:hidden">
              {items.map((l: AuditLogDTO) => (
                <Card key={l.id} className="gap-1.5 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant="secondary" className="font-mono text-[10px]">
                      {l.action}
                    </Badge>
                    <span className="text-[11px] text-muted-foreground">{formatDateTime(l.createdAt)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Entité <span className="font-mono">{l.entity}</span>
                    {l.entityId ? ` · ${l.entityId}` : ""}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {l.userName ?? "Système"} · IP {l.ipAddress ?? "—"}
                  </p>
                </Card>
              ))}
            </div>

            <Card className="hidden gap-0 p-0 md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Action</TableHead>
                    <TableHead>Entité</TableHead>
                    <TableHead>Utilisateur</TableHead>
                    <TableHead>IP</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((l: AuditLogDTO) => (
                    <TableRow key={l.id}>
                      <TableCell className="font-mono text-[11px] font-semibold">{l.action}</TableCell>
                      <TableCell className="font-mono text-[11px]">
                        {l.entity}
                        {l.entityId ? ` · ${l.entityId}` : ""}
                      </TableCell>
                      <TableCell className="text-xs">{l.userName ?? "Système"}</TableCell>
                      <TableCell className="font-mono text-[11px]">{l.ipAddress ?? "—"}</TableCell>
                      <TableCell className="text-xs">{formatDateTime(l.createdAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>

            <NzokoPagination
              page={data?.page ?? 1}
              totalPages={data?.totalPages ?? 1}
              total={data?.total ?? 0}
              onPageChange={setPage}
              unit="entrées"
            />
          </>
        )}
      </div>
    </div>
  );
}

function SecurityLogsSection({ refreshKey }: { refreshKey?: number }) {
  const [event, setEvent] = useState("ALL");
  const [page, setPage] = useState(1);

  // Retour en page 1 quand le filtre change (ajustement pendant le rendu).
  const [prevFilter, setPrevFilter] = useState(event);
  if (event !== prevFilter) {
    setPrevFilter(event);
    setPage(1);
  }

  const { data, loading, error, reload } = useApiData(
    () => api.logs.security({ event: event === "ALL" ? undefined : event, page }),
    { refetchKey: [event, page], refreshKey },
  );

  const items = data?.items ?? [];

  return (
    <div>
      <Select value={event} onValueChange={setEvent}>
        <SelectTrigger className="h-11 w-full max-w-56" aria-label="Filtrer par événement de sécurité">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">Tous les événements</SelectItem>
          {SECURITY_EVENTS.map((e) => (
            <SelectItem key={e.value} value={e.value}>
              {e.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="mt-4">
        {loading && <NzokoListSkeleton count={4} />}
        {error && <NzokoErrorBox error={error} onRetry={reload} />}
        {!loading && !error && items.length === 0 && (
          <NzokoEmptyState icon={ShieldAlert} title="Aucun événement de sécurité" />
        )}
        {!loading && !error && items.length > 0 && (
          <>
            <div className="grid gap-2 md:hidden">
              {items.map((l: SecurityLogDTO) => (
                <Card key={l.id} className="gap-1.5 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant="outline" className={EVENT_TONES[l.event] ?? ""}>
                      {l.event}
                    </Badge>
                    <span className="text-[11px] text-muted-foreground">{formatDateTime(l.createdAt)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{l.email ?? "Email inconnu"}</p>
                  <p className="text-[11px] text-muted-foreground">IP {l.ipAddress ?? "—"}</p>
                  {l.details && <p className="text-[11px] italic text-muted-foreground">{l.details}</p>}
                </Card>
              ))}
            </div>

            <Card className="hidden gap-0 p-0 md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Événement</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>IP</TableHead>
                    <TableHead>Détails</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((l: SecurityLogDTO) => (
                    <TableRow key={l.id}>
                      <TableCell>
                        <Badge variant="outline" className={EVENT_TONES[l.event] ?? ""}>
                          {l.event}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">{l.email ?? "—"}</TableCell>
                      <TableCell className="font-mono text-[11px]">{l.ipAddress ?? "—"}</TableCell>
                      <TableCell className="max-w-64 truncate text-xs text-muted-foreground">
                        {l.details ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs">{formatDateTime(l.createdAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>

            <NzokoPagination
              page={data?.page ?? 1}
              totalPages={data?.totalPages ?? 1}
              total={data?.total ?? 0}
              onPageChange={setPage}
              unit="événements"
            />
          </>
        )}
      </div>
    </div>
  );
}
