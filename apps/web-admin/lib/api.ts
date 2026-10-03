export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

export interface TenantRow {
  id: string;
  name: string;
  slug: string;
  createdAt: string | null;
  eventsCount: number;
  ticketsCount: number;
  revenueCents: number;
}

export interface CreateTenantInput {
  name: string;
  slug: string;
  adminEmail: string;
  adminPassword: string;
}

async function authed<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "content-type": "application/json", Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  if (!r.ok) {
    const msg = await r.text().catch(() => "");
    throw new Error(`${r.status} ${msg}`);
  }
  return r.json();
}

/** Login de plataforma: SIN tenantSlug (el admin de plataforma no tiene tenant). */
export async function login(email: string, password: string) {
  const r = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) throw new Error("Credenciales inválidas");
  const data = (await r.json()) as { token: string; role: string; platform?: boolean };
  if (data.role !== "admin_saas") throw new Error("Ese usuario no es administrador de plataforma");
  return data;
}

export const listTenants = (token: string) => authed<TenantRow[]>(token, "/platform/tenants");

export const createTenant = (token: string, input: CreateTenantInput) =>
  authed<{ id: string; name: string; slug: string; adminEmail: string }>(token, "/platform/tenants", {
    method: "POST",
    body: JSON.stringify(input),
  });

export function euros(cents: number): string {
  return (cents / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}
