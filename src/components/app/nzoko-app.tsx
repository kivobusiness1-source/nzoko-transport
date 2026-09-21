"use client";

// ============================================================
// NZOKO TRANSPORT — Coquille applicative monopage (v3)
// Route unique "/" : navigation par vues côté client.
// Les vues métier sont importées depuis src/features/* (stub → rempli)
// ============================================================

import { useEffect, useCallback, useState, useMemo, lazy, Suspense, type ReactNode } from "react";
import Link from "next/link";
import { Bus, Bell, LogOut, Home, Ticket, Search, UserRound, ChevronDown, Menu, Loader2, Map as MapIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { useApp, restorePersistedView } from "@/lib/store";
import { api } from "@/lib/api-client";
import { installGlobalErrorReporting } from "@/lib/client-telemetry";
import { APP_NAME, APP_SLOGAN } from "@/lib/constants";
import { initials, relativeTime } from "@/lib/format";
import type { NotificationDTO } from "@/types";

// Vues métier (remplacées par les modules feature)
import HomeView from "@/features/booking/home-view";
import BookingFlow from "@/features/booking/booking-flow";
import TrackingView from "@/features/tracking/tracking-view";

// Espaces professionnels : chargés à la demande (code-splitting — audit
// architecture, point 6). Ils ne sont rendus qu'APRÈS l'authentification
// côté client (session Zustand nulle pendant le SSR) : React.lazy n'est
// donc jamais résolu côté serveur, sans effet sur le SEO (l'accueil, lui,
// reste un import statique rendu serveur avec son H1 crawlable).
// NOTE : React.lazy + Suspense (et non next/dynamic) — contournement
// robuste d'une corruption HMR Turbopack (« dynamic is not defined »
// lors de la ré-évaluation du module, cf. worklog Task 9) et le
// comportement de chargement est strictement identique.
const WorkspaceLoader = () => (
  <div className="flex min-h-[50vh] items-center justify-center" role="status" aria-label="Chargement de l'espace…">
    <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden />
  </div>
);
const CheckerView = lazy(() => import("@/features/checker/checker-view"));
const DriverView = lazy(() => import("@/features/driver/driver-view"));
const AgentDesk = lazy(() => import("@/features/agent/agent-desk"));
const AdminWorkspace = lazy(() => import("@/features/admin/admin-workspace"));
const AgencyWorkspace = lazy(() => import("@/features/agency/agency-workspace"));
const FinanceWorkspace = lazy(() => import("@/features/finance/finance-workspace"));
// Espace client « MON ESPACE NZOKO » + écran d'authentification (Connexion /
// Inscription, comptes clients Supabase) — même principe : client-only,
// jamais résolus côté serveur.
const ClientWorkspace = lazy(() => import("@/features/client/client-workspace"));
const AuthScreen = lazy(() => import("@/features/auth/auth-screen"));
// Vue publique « Carte des lignes » (Leaflet) — client-only, aucune auth.
const PublicMapView = lazy(() => import("@/features/client/public-map-view"));

import { PwaRegister } from "@/components/app/pwa-register";
import { AssistantWidget } from "@/components/app/assistant-widget";
import { ChunkErrorBoundary } from "@/components/app/chunk-error-boundary";

function Brand({ onClick }: { onClick?: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-2 min-h-[44px] px-1" aria-label={`${APP_NAME} — accueil`}>
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
        <Bus className="h-5 w-5" />
      </span>
      <span className="hidden sm:flex flex-col leading-none text-left">
        <span className="font-bold tracking-tight text-primary text-[15px]">NZOKO</span>
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Transport</span>
      </span>
    </button>
  );
}

function NotificationsMenu() {
  const { session } = useApp();
  const [items, setItems] = useState<NotificationDTO[]>([]);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(await api.notifications.list());
    } catch {
      // silencieux
    }
  }, []);

  useEffect(() => {
    if (!session) return;
    // Chargement différé hors du corps synchrone de l'effet (react-compiler)
    const initial = setTimeout(load, 0);
    const t = setInterval(load, 60_000);
    return () => {
      clearTimeout(initial);
      clearInterval(t);
    };
  }, [session, load]);

  const unread = items.filter((n) => !n.isRead).length;

  const markAll = async () => {
    try {
      await api.notifications.markRead();
      setItems((prev) => prev.map((n) => ({ ...n, isRead: true })));
    } catch {
      toast.error("Impossible de marquer les notifications comme lues.");
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-10 w-10" aria-label="Notifications">
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-orange-600 px-1 text-[10px] font-bold text-white">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <p className="font-semibold text-sm">Notifications</p>
          {unread > 0 && (
            <Button variant="ghost" size="sm" onClick={markAll} className="h-7 text-xs">
              Tout marquer lu
            </Button>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto nzoko-scroll">
          {items.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">Aucune notification.</p>
          ) : (
            items.map((n) => (
              <div key={n.id} className={`border-b px-4 py-3 ${n.isRead ? "opacity-60" : ""}`}>
                <p className="text-sm font-medium">{n.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{n.message}</p>
                <p className="mt-1 text-[10px] text-muted-foreground">{relativeTime(n.createdAt)}</p>
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function UserMenu() {
  const { session, logout, setView } = useApp();
  if (!session) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-10 gap-2 px-2">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
              {initials(session.fullName)}
            </AvatarFallback>
          </Avatar>
          <span className="hidden md:flex flex-col items-start leading-none">
            <span className="text-sm font-medium">{session.fullName}</span>
            <span className="text-[10px] text-muted-foreground">{session.roleLabel}</span>
          </span>
          <ChevronDown className="hidden md:block h-4 w-4 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>
          <p className="text-sm font-semibold">{session.fullName}</p>
          <p className="text-xs text-muted-foreground">{session.email}</p>
          <div className="mt-1.5 flex items-center gap-1.5">
            <Badge variant="secondary" className="text-[10px]">{session.roleLabel}</Badge>
            {session.agencyName && <Badge variant="outline" className="text-[10px]">{session.agencyName}</Badge>}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => setView("workspace")} className="min-h-[40px]">
          <Home className="mr-2 h-4 w-4" /> Mon espace
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={async () => {
            await logout();
            toast.success("Vous êtes déconnecté.");
          }}
          className="min-h-[40px] text-red-600 focus:text-red-600"
        >
          <LogOut className="mr-2 h-4 w-4" /> Se déconnecter
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PublicNavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const { setView, view, session } = useApp();
  // shortLabel : libellé compact sous lg pour préserver l'en-tête
  // (même principe que la barre mobile « Suivi » pour « Suivi billet »).
  const items: { key: string; label: string; shortLabel?: string; icon: typeof Home; target: Parameters<typeof setView>[0] }[] = [
    { key: "home", label: "Accueil", icon: Home, target: "home" },
    { key: "booking", label: "Réserver", icon: Ticket, target: "booking" },
    { key: "tracking", label: "Suivi billet", icon: Search, target: "tracking" },
    { key: "map", label: "Carte des lignes", shortLabel: "Carte", icon: MapIcon, target: "map" },
  ];
  return (
    <>
      {items.map((item) => (
        <button
          key={item.key}
          onClick={() => {
            setView(item.target);
            onNavigate?.();
          }}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors min-h-[40px] ${
            view === item.target ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted"
          }`}
        >
          <item.icon className="h-4 w-4" />
          {item.shortLabel ? (
            <>
              <span className="hidden lg:inline">{item.label}</span>
              <span className="lg:hidden">{item.shortLabel}</span>
            </>
          ) : (
            item.label
          )}
        </button>
      ))}
      {session && (
        <button
          onClick={() => {
            setView("workspace");
            onNavigate?.();
          }}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors min-h-[40px] ${
            view === "workspace" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted"
          }`}
        >
          <UserRound className="h-4 w-4" />
          Mon espace
        </button>
      )}
    </>
  );
}

function MobileMenu() {
  const [open, setOpen] = useState(false);
  return (
    <div className="md:hidden">
      <Button variant="ghost" size="icon" className="h-10 w-10" onClick={() => setOpen(!open)} aria-label="Menu">
        {open ? <ChevronDown className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </Button>
      {open && (
        <div className="absolute left-0 right-0 top-14 z-50 border-b bg-background shadow-lg">
          <nav className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-3" onClick={() => setOpen(false)}>
            <PublicNavLinks />
          </nav>
        </div>
      )}
    </div>
  );
}

function BottomNav() {
  const { setView, view, session } = useApp();
  const items: { key: string; label: string; icon: typeof Home; target: "home" | "booking" | "tracking" | "login" | "workspace" }[] = [
    { key: "home", label: "Accueil", icon: Home, target: "home" },
    { key: "booking", label: "Réserver", icon: Ticket, target: "booking" },
    { key: "tracking", label: "Suivi", icon: Search, target: "tracking" },
    {
      key: "account",
      label: session ? "Mon espace" : "Connexion",
      icon: UserRound,
      target: session ? "workspace" : "login",
    },
  ];
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Navigation principale mobile"
    >
      <div className="grid grid-cols-4">
        {items.map((item) => (
          <button
            key={item.key}
            onClick={() => setView(item.target)}
            className={`flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
              view === item.target ? "text-primary" : "text-muted-foreground"
            }`}
          >
            <item.icon className="h-5 w-5" />
            {item.label}
          </button>
        ))}
      </div>
    </nav>
  );
}

function WorkspaceRouter() {
  const { session } = useApp();
  if (!session) return null;

  let workspace: ReactNode;
  switch (session.role) {
    case "PASSENGER":
      workspace = <ClientWorkspace />;
      break;
    case "SUPER_ADMIN":
    case "ADMIN":
      workspace = <AdminWorkspace />;
      break;
    case "AGENCY_MANAGER":
      workspace = <AgencyWorkspace />;
      break;
    case "AGENT":
      workspace = <AgentDesk />;
      break;
    case "CHECKER":
      workspace = <CheckerView />;
      break;
    case "ACCOUNTANT":
      workspace = <FinanceWorkspace />;
      break;
    case "DRIVER":
      workspace = <DriverView />;
      break;
    default:
      workspace = <AgencyWorkspace />;
  }

  return <Suspense fallback={<WorkspaceLoader />}>{workspace}</Suspense>;
}

export default function NzokoApp() {
  const { session, sessionReady, view, setView, setBookingSearch, refreshSession } = useApp();

  // Au montage UNIQUEMENT (client) : restauration de la dernière vue
  // persistée + rafraîchissement de session. La restauration se fait au
  // montage — et non à l'évaluation du module — pour rester compatible
  // avec le premier rendu serveur (l'accueil SSR reste la source de
  // vérité de l'hydratation, la vue persistée s'applique juste après).
  useEffect(() => {
    restorePersistedView();
    void refreshSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- montage unique
  }, []);

  // Télémétrie globale : erreurs non capturées + promesses rejetées
  // (posées une seule fois, nettoyées au démontage HMR).
  useEffect(() => installGlobalErrorReporting(), []);

  const handleSearch = useCallback(
    (params: { from: string; to: string; date: string }) => {
      setBookingSearch(params);
      setView("booking");
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [setBookingSearch, setView]
  );

  const go = useCallback(
    (target: Parameters<typeof setView>[0]) => {
      setView(target);
      window.scrollTo({ top: 0 });
    },
    [setView]
  );

  const content = useMemo(() => {
    // SEO + vitesse perçue : l'accueil est rendu côté serveur (H1 + contenu
    // statique crawlables). La vérification de session est rapide et, une fois
    // prête, re-render sans saut (view par défaut = "home").
    if (!sessionReady) {
      return <HomeView onSearch={handleSearch} />;
    }
    switch (view) {
      case "home":
        return <HomeView onSearch={handleSearch} />;
      case "booking":
        return session?.role === "AGENT" ? (
          <Suspense fallback={<WorkspaceLoader />}>
            <AgentDesk />
          </Suspense>
        ) : (
          <BookingFlow channel="WEB" />
        );
      case "tracking":
        return <TrackingView />;
      case "map":
        return (
          <Suspense fallback={<WorkspaceLoader />}>
            <PublicMapView />
          </Suspense>
        );
      case "login":
      case "register":
        return (
          <Suspense fallback={<WorkspaceLoader />}>
            <AuthScreen defaultTab={view === "register" ? "register" : "login"} />
          </Suspense>
        );
      case "workspace":
        return session ? (
          <WorkspaceRouter />
        ) : (
          <Suspense fallback={<WorkspaceLoader />}>
            <AuthScreen defaultTab="login" />
          </Suspense>
        );
      default:
        return <HomeView onSearch={handleSearch} />;
    }
  }, [sessionReady, view, session, handleSearch]);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-2 px-4">
          <Brand onClick={() => go("home")} />
          <nav className="hidden md:flex items-center gap-1">
            <PublicNavLinks />
          </nav>
          <div className="flex items-center gap-1">
            {session ? (
              <>
                <NotificationsMenu />
                <UserMenu />
              </>
            ) : (
              <Button onClick={() => go("login")} className="h-10" data-testid="login-button">
                Connexion
              </Button>
            )}
            <MobileMenu />
          </div>
        </div>
      </header>

      <main className="flex-1 pb-24 md:pb-8">
        <Link href="/" className="sr-only">NZOKO TRANSPORT — Page principale</Link>
        {/* Récupération ChunkLoadError (chunks Turbopack obsolètes après un
            redémarrage du serveur dev ou de la machine) : auto-rechargement
            unique + écran de secours « Réessayer / Recharger ». La key par vue
            réinitialise le boundary à chaque navigation (une vue cassée ne
            bloque pas le site) et le context alimente la télémétrie serveur. */}
        <ChunkErrorBoundary key={view} context={view}>{content}</ChunkErrorBoundary>
      </main>

      <div className="mx-auto w-full max-w-6xl px-4">
        <PwaRegister />
      </div>

      <footer className="mt-auto border-t bg-muted/40 pb-20 md:pb-0">
        <div className="mx-auto max-w-6xl px-4 py-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Bus className="h-4 w-4" />
              </span>
              <div>
                <p className="text-sm font-bold text-primary">{APP_NAME}</p>
                <p className="text-xs text-muted-foreground">{APP_SLOGAN}</p>
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              <p>🇨🇬 Congo-Brazzaville · Pointe-Noire — Brazzaville — Dolisie — Nkayi — Ouesso</p>
              <p className="mt-0.5">
                © {new Date().getFullYear()} NZOKO TRANSPORT · Tous droits réservés
              </p>
            </div>
          </div>
        </div>
      </footer>

      <BottomNav />
      <AssistantWidget />
      <Toaster richColors position="top-center" />
    </div>
  );
}
