"use client";

// ============================================================
// NZOKO TRANSPORT — Assistant IA flottant (voyages / tarifs / promos)
// Bouton rond + panneau de chat : quasi plein écran sur mobile
// (375px), carte latérale sur ordinateur. Conversation persistée
// en sessionStorage (session + messages). Le rendu du markdown
// léger (**gras**, listes) se fait en nœuds React — jamais de
// innerHTML (règle XSS).
// ============================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bot, Send, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, ApiClientError } from "@/lib/api-client";
import { ASSISTANT_LIMITS } from "@/lib/constants";
import type { AssistantReplyDTO } from "@/types";

type ChatMessage = { role: "user" | "assistant"; content: string };

const WELCOME: ChatMessage = {
  role: "assistant",
  content:
    "Bonjour 👋 Je suis **l'assistant NZOKO**.\n\nPosez-moi vos questions sur nos destinations, horaires, tarifs et promotions — je réponds à partir des départs réels de notre réseau.",
};

const SUGGESTIONS = [
  "Quelles villes desservez-vous ?",
  "Prix d'un billet Brazzaville → Pointe-Noire ?",
  "Y a-t-il des promotions en cours ?",
  "Comment payer avec MTN MoMo ?",
];

const SESSION_KEY = "nzoko-assistant-session";
const MESSAGES_KEY = "nzoko-assistant-messages";

// ---------- Rendu markdown léger (bold + listes) en nœuds React ----------

function renderInline(text: string, keyPrefix: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter((p) => p.length > 0);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={`${keyPrefix}-b${i}`} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <span key={`${keyPrefix}-t${i}`}>{part}</span>;
  });
}

function renderContent(content: string) {
  const lines = content.split("\n");
  const blocks: React.ReactNode[] = [];
  let listItems: string[] = [];

  const flushList = (key: number) => {
    if (listItems.length === 0) return;
    blocks.push(
      <ul key={`ul-${key}`} className="my-1 ml-4 list-disc space-y-0.5">
        {listItems.map((item, i) => (
          <li key={`li-${key}-${i}`}>{renderInline(item, `li-${key}-${i}`)}</li>
        ))}
      </ul>
    );
    listItems = [];
  };

  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      flushList(idx);
      return;
    }
    const bullet = trimmed.match(/^[-•*]\s+(.*)$/);
    const numbered = trimmed.match(/^\d+[.)]\s+(.*)$/);
    if (bullet) {
      listItems.push(bullet[1]);
      return;
    }
    if (numbered) {
      listItems.push(numbered[1]);
      return;
    }
    flushList(idx);
    blocks.push(
      <p key={`p-${idx}`} className="leading-relaxed">
        {renderInline(trimmed, `p-${idx}`)}
      </p>
    );
  });
  flushList(9999);
  return <div className="space-y-1">{blocks}</div>;
}

// ---------- Composant principal ----------

export function AssistantWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState("");

  const messagesRef = useRef<ChatMessage[]>([WELCOME]);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Restaurer la conversation (sessionStorage) — différé hors corps synchrone (react-compiler)
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const sid = sessionStorage.getItem(SESSION_KEY);
        if (sid) setSessionId(sid);
        const stored = sessionStorage.getItem(MESSAGES_KEY);
        if (stored) {
          const parsed: unknown = JSON.parse(stored);
          if (Array.isArray(parsed) && parsed.length > 0) {
            const safe = parsed.filter(
              (m): m is ChatMessage =>
                typeof m === "object" &&
                m !== null &&
                ((m as { role?: unknown }).role === "user" || (m as { role?: unknown }).role === "assistant") &&
                typeof (m as { content?: unknown }).content === "string"
            );
            if (safe.length > 0) {
              messagesRef.current = [WELCOME, ...safe.filter((m) => m.content !== WELCOME.content)].slice(-30);
              setMessages(messagesRef.current);
            }
          }
        }
      } catch {
        /* stockage indisponible — conversation neuve */
      }
    }, 0);
    return () => clearTimeout(t);
  }, []);

  // Échap ferme le panneau (aucun setState synchrone dans le corps de l'effet)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const focus = setTimeout(() => inputRef.current?.focus(), 120);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearTimeout(focus);
    };
  }, [open]);

  // Défilement automatif vers le bas
  useEffect(() => {
    const el = containerRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, pending, open]);

  const commitMessages = useCallback((next: ChatMessage[]) => {
    const bounded = next.slice(-30);
    messagesRef.current = bounded;
    setMessages(bounded);
    try {
      sessionStorage.setItem(MESSAGES_KEY, JSON.stringify(bounded));
    } catch {
      /* stockage indisponible */
    }
  }, []);

  const send = useCallback(
    async (raw: string) => {
      const message = raw.trim().slice(0, ASSISTANT_LIMITS.maxMessageLength);
      if (!message || pending) return;

      setInput("");
      setError(null);
      commitMessages([...messagesRef.current, { role: "user", content: message }]);
      setPending(true);

      try {
        const res: AssistantReplyDTO = await api.assistant.chat({
          sessionId: sessionId || undefined,
          message,
        });
        if (res.sessionId && res.sessionId !== sessionId) {
          setSessionId(res.sessionId);
          try {
            sessionStorage.setItem(SESSION_KEY, res.sessionId);
          } catch {
            /* ignore */
          }
        }
        commitMessages([...messagesRef.current, { role: "assistant", content: res.reply }]);
      } catch (err) {
        if (err instanceof ApiClientError) {
          if (err.status === 429) {
            setError("Trop de questions à la suite — patientez une minute. ⏳");
          } else if (err.status === 503) {
            setError(err.message);
          } else if (err.status === 400) {
            setError("Message invalide (500 caractères maximum).");
          } else {
            setError("L'assistant est indisponible pour le moment. Réessayez.");
          }
        } else {
          setError("Connexion impossible. Vérifiez votre réseau.");
        }
      } finally {
        setPending(false);
      }
    },
    [pending, sessionId, commitMessages]
  );

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void send(input);
  };

  const showSuggestions = messages.length <= 1;

  return (
    <>
      {/* Bouton flottant — au-dessus de la barre de navigation mobile */}
      <motion.button
        type="button"
        whileTap={{ scale: 0.92 }}
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Fermer l'assistant IA" : "Ouvrir l'assistant IA (voyages, tarifs, promotions)"}
        aria-expanded={open}
        className="fixed right-4 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-50 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30 transition-transform hover:scale-105 md:right-6 md:bottom-6"
      >
        {open ? <X className="h-5 w-5" /> : <Bot className="h-6 w-6" />}
        {!open && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-orange-600 text-[9px] font-bold text-white">
            IA
          </span>
        )}
      </motion.button>

      {/* Panneau de conversation */}
      <AnimatePresence>
        {open && (
          <motion.section
            role="dialog"
            aria-label="Assistant NZOKO — voyages, tarifs, promotions"
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="fixed z-50 flex flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl inset-x-3 top-20 bottom-[calc(9rem+env(safe-area-inset-bottom))] md:inset-x-auto md:right-6 md:top-auto md:bottom-24 md:h-[34rem] md:max-h-[calc(100vh-10rem)] md:w-[24rem]"
          >
            {/* En-tête */}
            <header className="flex items-center gap-2.5 border-b bg-primary px-4 py-3 text-primary-foreground">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/15">
                <Bot className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-sm font-bold">
                  Assistant NZOKO
                  <Sparkles className="h-3.5 w-3.5 opacity-80" aria-hidden />
                </p>
                <p className="truncate text-[11px] opacity-80">Voyages · Tarifs · Promotions</p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setOpen(false)}
                className="h-9 w-9 shrink-0 text-primary-foreground hover:bg-white/15 hover:text-primary-foreground"
                aria-label="Fermer l'assistant"
              >
                <X className="h-5 w-5" />
              </Button>
            </header>

            {/* Messages */}
            <div
              ref={containerRef}
              aria-live="polite"
              aria-label="Messages de la conversation"
              className="nzoko-scroll flex-1 space-y-3 overflow-y-auto bg-muted/30 p-3"
            >
              {messages.map((m, i) => (
                <div
                  key={`msg-${i}`}
                  className={`flex gap-2 ${m.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  {m.role === "assistant" && (
                    <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <Bot className="h-4 w-4" aria-hidden />
                    </span>
                  )}
                  <div
                    className={
                      m.role === "user"
                        ? "max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2.5 text-sm text-primary-foreground shadow-sm"
                        : "max-w-[85%] rounded-2xl rounded-bl-md border bg-background px-3.5 py-2.5 text-sm shadow-sm"
                    }
                  >
                    {renderContent(m.content)}
                  </div>
                </div>
              ))}

              {pending && (
                <div className="flex gap-2">
                  <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Bot className="h-4 w-4" aria-hidden />
                  </span>
                  <div className="flex items-center gap-1 rounded-2xl rounded-bl-md border bg-background px-4 py-3 shadow-sm">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:0ms]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:150ms]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:300ms]" />
                    <span className="sr-only">L’assistant rédige une réponse…</span>
                  </div>
                </div>
              )}

              {showSuggestions && !pending && (
                <div className="flex flex-wrap gap-2 pt-1" role="group" aria-label="Questions suggérées">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => void send(s)}
                      className="rounded-full border bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-sm transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary min-h-[36px]"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Saisie */}
            <form onSubmit={onSubmit} className="border-t bg-background p-3">
              {error && (
                <p role="alert" className="mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
                  {error}
                </p>
              )}
              <div className="flex items-center gap-2">
                <input
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  maxLength={ASSISTANT_LIMITS.maxMessageLength}
                  placeholder="Votre question (ex. horaires Pointe-Noire)…"
                  aria-label="Votre question"
                  enterKeyHint="send"
                  disabled={pending}
                  className="h-11 flex-1 rounded-xl border bg-background px-3.5 text-sm outline-none transition-colors focus:border-primary/60 focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
                />
                <Button
                  type="submit"
                  size="icon"
                  disabled={pending || input.trim().length === 0}
                  className="h-11 w-11 shrink-0 rounded-xl"
                  aria-label="Envoyer la question"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
              <p className="mt-1.5 text-center text-[10px] text-muted-foreground">
                Réponses générées par IA à partir de nos données réelles · aucune donnée personnelle demandée
              </p>
            </form>
          </motion.section>
        )}
      </AnimatePresence>
    </>
  );
}
