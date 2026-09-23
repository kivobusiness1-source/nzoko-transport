import "dotenv/config";
const BASE = process.env.NEON_AUTH_BASE_URL ?? "";
const SERVICE_EMAIL = (process.env.NEON_AUTH_SERVICE_EMAIL ?? "").trim().toLowerCase();
const SERVICE_PASSWORD = process.env.NEON_AUTH_SERVICE_PASSWORD ?? "";
const ORIGIN = process.env.NEON_SERVICE_ORIGIN?.trim() || "http://localhost:3000";

async function call(path: string, init: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Origin: ORIGIN, ...(init.headers ?? {}) },
    cache: "no-store",
  });
  const body = (await res.json().catch(() => null)) as unknown;
  return { status: res.status, body };
}

// health
const ok = await call("/ok", { method: "GET" });
console.log(`GET /ok → ${ok.status} ${JSON.stringify(ok.body)?.slice(0, 120)}`);

const signIn = await call("/sign-in/email", {
  method: "POST",
  body: JSON.stringify({ email: SERVICE_EMAIL, password: SERVICE_PASSWORD }),
});
const setCookies = (signIn as { setCookies?: string[] }).setCookies ?? [];
const cookie = setCookies.map((c) => c.split(";")[0]).join("; ");
console.log(`sign-in → ${signIn.status}`);

const authCall = (path: string, payload: unknown) =>
  call(path, { method: "POST", headers: { Cookie: cookie }, body: JSON.stringify(payload) });

const probes: Array<[string, unknown]> = [
  ["/admin/list-users", { query: { limit: 1 } }],
  ["/admin/get-user", { userId: "a0b4dae3-400b-4c6f-a1d6-5ce97c267b3a" }],
  ["/admin/update-user", { userId: "a0b4dae3-400b-4c6f-a1d6-5ce97c267b3a", data: { name: "NZOKO Service" } }],
  ["/admin/set-user-role", { userId: "a0b4dae3-400b-4c6f-a1d6-5ce97c267b3a", role: "admin" }],
  ["/admin/set-user-password", { userId: "inexistant", newPassword: "Test@2026!X" }],
  ["/admin/remove-user", { userId: "inexistant" }],
  ["/admin/ban-user", { userId: "inexistant" }],
  ["/admin/list-user-sessions", { userId: "a0b4dae3-400b-4c6f-a1d6-5ce97c267b3a" }],
  ["/admin/create-user", { email: `probe-${Date.now()}@example.com`, password: "Test@2026!X", name: "Probe", role: "user" }],
  ["/user/get-session", {}],
  ["/admin/ok", {}],
];
for (const [path, payload] of probes) {
  const r = await authCall(path, payload);
  console.log(`POST ${path} → ${r.status} ${JSON.stringify(r.body)?.slice(0, 160)}`);
}
