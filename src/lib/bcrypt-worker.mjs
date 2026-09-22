// Worker bcrypt — exécute hash/verify HORS de l'event loop principal.
// Importé par node:worker_threads via chemin absolu (jamais bundlé).

import bcrypt from "bcryptjs";
import { parentPort } from "node:worker_threads";

const port = parentPort;

port?.on("message", (job) => {
  const { id, op, a, b } = job;
  try {
    let value;
    if (op === "hash") {
      value = bcrypt.hashSync(String(a), typeof b === "number" ? b : 12);
    } else {
      value = bcrypt.compareSync(String(a), String(b));
    }
    port.postMessage({ id, ok: true, value });
  } catch (err) {
    port.postMessage({ id, ok: false, error: String(err?.message ?? err) });
  }
});
