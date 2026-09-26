// ============================================================
// OCÉAN DU NORD — Constantes partagées client/serveur (auth)
// (fichier importable côté client sans dépendance node:crypto)
// ============================================================

export const SESSION_COOKIE = "nzoko_session";
export const SESSION_HOURS = 12;
export const GLOBAL_ROLES = ["SUPER_ADMIN", "ADMIN"] as const;
export const CSRF_HEADER = "x-requested-with";
export const CSRF_HEADER_VALUE = "nzoko";
