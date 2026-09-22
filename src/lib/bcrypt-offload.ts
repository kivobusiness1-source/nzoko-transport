// ============================================================
// NZOKO TRANSPORT — Offload bcrypt vers un worker thread
// ------------------------------------------------------------
// bcrypt (cost 12) est du pur CPU : ~300 ms par vérification.
// Exécuté sur le thread principal, il gèle TOUT le serveur pendant
// les transactions SQLite ouvertes → P1008/P2028 sous charge
// (constaté au test de charge : 5 connexions simultanées gelent
// les requêtes concurrentes pendant ~1,5 s, en cascade jusqu'aux
// timeouts). Le worker exécute les opérations en série hors du
// thread principal ; en cas d'indisponibilité, repli synchrone.
// ============================================================

import { Worker } from "node:worker_threads";
import path from "node:path";
import bcrypt from "bcryptjs";

const WORKER_FILE = path.join(process.cwd(), "src", "lib", "bcrypt-worker.mjs");

interface JobMessage {
  id: number;
  op: "hash" | "verify";
  a: string;
  b?: string | number;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

let worker: Worker | null = null;
let workerBroken = false;
let seq = 0;
const pending = new Map<number, Pending>();

function ensureWorker(): Worker | null {
  if (workerBroken) return null;
  if (worker) return worker;
  try {
    const w = new Worker(WORKER_FILE);
    w.unref(); // n'empêche pas l'arrêt du processus Node

    w.on("message", (msg: { id: number; ok: boolean; value?: unknown; error?: string }) => {
      const job = pending.get(msg.id);
      pending.delete(msg.id);
      if (!job) return;
      if (msg.ok) job.resolve(msg.value);
      else job.reject(new Error(msg.error ?? "erreur worker bcrypt"));
    });

    // Worker interrompu : rejeter les jobs en vol (repli thread principal)
    const crash = () => {
      worker = null;
      for (const job of pending.values()) job.reject(new Error("BCRYPT_WORKER_INTERRUPTED"));
      pending.clear();
    };
    w.on("error", crash);
    w.on("exit", (code) => {
      if (code !== 0 && worker === w) crash();
    });

    worker = w;
    return w;
  } catch {
    workerBroken = true; // environnement sans worker_threads → repli
    return null;
  }
}

/** Soumet un job bcrypt au worker ; throw si worker indisponible. */
function submit(op: "hash" | "verify", a: string, b?: string | number): Promise<unknown> {
  const w = ensureWorker();
  if (!w) return Promise.reject(new Error("BCRYPT_WORKER_UNAVAILABLE"));

  const id = ++seq;
  return new Promise<unknown>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    try {
      const job: JobMessage = { id, op, a, b };
      w.postMessage(job);
    } catch (err) {
      pending.delete(id);
      reject(err as Error);
    }
  });
}

/** Vérifie un mot de passe — worker si possible, sinon thread principal. */
export async function bcryptVerify(plain: string, hash: string): Promise<boolean> {
  try {
    return (await submit("verify", plain, hash)) === true;
  } catch {
    return bcrypt.compare(plain, hash);
  }
}

/** Hache un mot de passe (cost 12 par défaut) — worker si possible. */
export async function bcryptHash(plain: string, rounds = 12): Promise<string> {
  try {
    return (await submit("hash", plain, rounds)) as string;
  } catch {
    return bcrypt.hash(plain, rounds);
  }
}
