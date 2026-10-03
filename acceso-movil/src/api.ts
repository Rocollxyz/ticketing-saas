import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";

/**
 * Base de la API. En el móvil `localhost` es el propio teléfono, así que derivamos
 * la IP del Mac del host del bundler de Expo (p.ej. "192.168.1.38:8081" → ":3000").
 * Se puede forzar con EXPO_PUBLIC_API_URL.
 */
export function apiBase(): string {
  const env = process.env.EXPO_PUBLIC_API_URL;
  if (env) return env;
  const hostUri =
    Constants.expoConfig?.hostUri ??
    (Constants.expoGoConfig?.debuggerHost as string | undefined);
  const host = hostUri?.split(":")[0];
  return host ? `http://${host}:3000` : "http://localhost:3000";
}

const K = {
  token: "acceso.token",
  role: "acceso.role",
  manifest: "acceso.manifest",
  queue: "acceso.queue",
};

export interface ScanOutcome {
  result: "OK" | "DUPLICATE" | "INVALID";
  reason?: string;
  ticket?: { id: string; seat: string; event: string; attendee?: string | null };
  previousScanAt?: string;
}

export interface Manifest {
  event: { id: string; name: string; status: string };
  key: string | null;
  generatedAt: string;
  tickets: { id: string; status: string; seat: string; attendee?: string | null }[];
}

export interface QueuedScan {
  token: string;
  seat: string;
  scannedAt: string;
  deviceId: string;
}

async function jget<T>(k: string): Promise<T | null> {
  const v = await AsyncStorage.getItem(k);
  return v ? (JSON.parse(v) as T) : null;
}
const jset = (k: string, v: unknown) => AsyncStorage.setItem(k, JSON.stringify(v));

export const store = {
  getToken: () => AsyncStorage.getItem(K.token),
  getRole: () => AsyncStorage.getItem(K.role),
  setAuth: async (token: string, role: string) => {
    await AsyncStorage.multiSet([
      [K.token, token],
      [K.role, role],
    ]);
  },
  clear: () => AsyncStorage.multiRemove(Object.values(K)),
  getManifest: () => jget<Manifest>(K.manifest),
  setManifest: (m: Manifest) => jset(K.manifest, m),
  getQueue: async () => (await jget<QueuedScan[]>(K.queue)) ?? [],
  setQueue: (q: QueuedScan[]) => jset(K.queue, q),
};

async function authed(path: string, init?: RequestInit) {
  const token = await store.getToken();
  const r = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  return r;
}

export async function login(email: string, password: string, tenantSlug: string) {
  const r = await fetch(`${apiBase()}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, tenantSlug }),
  });
  if (!r.ok) throw new Error("Credenciales inválidas");
  return r.json() as Promise<{ token: string; role: string }>;
}

export async function listEvents() {
  const r = await authed("/events");
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json() as Promise<{ id: string; name: string; status: string }[]>;
}

export async function scanOnline(token: string, deviceId: string): Promise<ScanOutcome> {
  const r = await authed("/access/scan", {
    method: "POST",
    body: JSON.stringify({ token, deviceId }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export async function fetchManifest(eventId: string): Promise<Manifest> {
  const r = await authed(`/access/manifest/${eventId}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export async function syncQueue(checkins: QueuedScan[]) {
  const r = await authed("/access/sync", {
    method: "POST",
    body: JSON.stringify({
      checkins: checkins.map((c) => ({ token: c.token, deviceId: c.deviceId, scannedAt: c.scannedAt })),
    }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json() as Promise<{ synced: number; results: (ScanOutcome & { token: string })[] }>;
}

/** Lee el eventId/ticketId que viaja en el QR (sin verificar firma — eso es del server). */
export function peekToken(token: string): { t: string; e: string } | null {
  try {
    const body = token.split(".")[0];
    const json = decodeBase64Url(body);
    const p = JSON.parse(json);
    return typeof p?.t === "string" && typeof p?.e === "string" ? p : null;
  } catch {
    return null;
  }
}

function decodeBase64Url(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  // atob existe en Hermes/RN moderno.
  // eslint-disable-next-line no-undef
  const bin = globalThis.atob ? globalThis.atob(b64) : Buffer.from(b64, "base64").toString("binary");
  try {
    return decodeURIComponent(
      bin
        .split("")
        .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
        .join(""),
    );
  } catch {
    return bin;
  }
}
