import "dotenv/config";
const BASE = process.env.NEON_AUTH_BASE_URL ?? "";
const SERVICE_EMAIL = (process.env.NEON_AUTH_SERVICE_EMAIL ?? "").trim().toLowerCase();
const SERVICE_PASSWORD = process.env.NEON_AUTH_SERVICE_PASSWORD ?? "";
const ORIGIN = "https://nzoko-transport-eight.vercel.app";

async function call(path: string, init: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Origin: ORIGIN, ...(init.headers ?? {}) },
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body, setCookies: res.headers.getSetCookie?.() ?? [] };
}

const signIn = await call("/sign-in/email", {
  method: "POST",
  body: JSON.stringify({ email: SERVICE_EMAIL, password: SERVICE_PASSWORD }),
});
console.log("sign-in status:", signIn.status);
const user = (signIn.body.user ?? {}) as Record<string, unknown>;
console.log("user:", JSON.stringify({ id: user.id, email: user.email, role: user.role, emailVerified: user.emailVerified, banned: user.banned }));
const cookie = signIn.setCookies.map((c) => c.split(";")[0]).join("; ");

const authCall = (path: string, payload: unknown) =>
  call(path, { method: "POST", headers: { Cookie: cookie }, body: JSON.stringify(payload) });

// list-users (admin requis)
const listed = await authCall("/admin/list-users", { query: { limit: 3 } });
console.log("list-users:", listed.status, JSON.stringify(listed.body).slice(0, 400));
