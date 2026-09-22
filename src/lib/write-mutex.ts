// ============================================================
// NZOKO TRANSPORT — Verrou d'écriture applicatif (SQLite)
// ------------------------------------------------------------
// SQLite n'autorise qu'UN écrivain à la fois. Soumis à des
// transactions interactives concurrentes ($transaction), le
// moteur Prisma sature (attentes SQLITE_BUSY de 5-10 s, puis
// parfois crash brutal du process — constaté au test de charge).
// Ce verrou sérialise les transactions au niveau applicatif :
// chacune s'exécute en quelques ms, les lectures restent
// parfaitement concurrentes grâce au mode WAL.
//
// ⚠ Ne jamais imbriquer : withWriteLock dans withWriteLock.
// ============================================================

let writeChain: Promise<unknown> = Promise.resolve();

/**
 * Exécute `fn` en exclusion mutuelle avec les autres écritures.
 * Les erreurs de `fn` sont propagées à l'appelant mais ne
 * cassent jamais la chaîne (le verrou est toujours relâché).
 */
export function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn);
  writeChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}
