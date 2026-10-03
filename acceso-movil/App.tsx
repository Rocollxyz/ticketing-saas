import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { StatusBar } from "expo-status-bar";
import {
  fetchManifest,
  listEvents,
  login,
  type Manifest,
  peekToken,
  type QueuedScan,
  type ScanOutcome,
  scanOnline,
  store,
  syncQueue,
} from "./src/api";

const DEVICE_ID = "dev-" + Math.random().toString(36).slice(2, 8);
type Screen = "login" | "events" | "scan";

export default function App() {
  const [screen, setScreen] = useState<Screen>("login");
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    store.getToken().then((t) => {
      setScreen(t ? "events" : "login");
      setBooting(false);
    });
  }, []);

  if (booting) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      {screen === "login" && <Login onDone={() => setScreen("events")} />}
      {screen === "events" && (
        <Events onPick={() => setScreen("scan")} onLogout={() => setScreen("login")} />
      )}
      {screen === "scan" && <Scanner onBack={() => setScreen("events")} />}
    </View>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("portero@demo.test");
  const [password, setPassword] = useState("portero123");
  const [slug, setSlug] = useState("demo");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await login(email.trim(), password, slug.trim());
      await store.setAuth(res.token, res.role);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={[styles.pad, styles.center, { flexGrow: 1 }]}>
      <Text style={styles.title}>Acceso</Text>
      <Text style={styles.subtitle}>Control de entradas</Text>
      <TextInput style={styles.input} value={email} onChangeText={setEmail} autoCapitalize="none" placeholder="email" placeholderTextColor="#667" />
      <TextInput style={styles.input} value={password} onChangeText={setPassword} secureTextEntry placeholder="contraseña" placeholderTextColor="#667" />
      <TextInput style={styles.input} value={slug} onChangeText={setSlug} autoCapitalize="none" placeholder="promotor (slug)" placeholderTextColor="#667" />
      {error && <Text style={styles.error}>{error}</Text>}
      <Pressable style={styles.btn} onPress={submit} disabled={busy}>
        <Text style={styles.btnText}>{busy ? "Entrando…" : "Entrar"}</Text>
      </Pressable>
    </ScrollView>
  );
}

function Events({ onPick, onLogout }: { onPick: () => void; onLogout: () => void }) {
  const [events, setEvents] = useState<{ id: string; name: string; status: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  useEffect(() => {
    listEvents()
      .then(setEvents)
      .catch((e) => setError(String(e)));
  }, []);

  async function pick(eventId: string) {
    setDownloading(eventId);
    try {
      const m = await fetchManifest(eventId);
      await store.setManifest(m);
      onPick();
    } catch (e) {
      setError(String(e));
    } finally {
      setDownloading(null);
    }
  }

  async function logout() {
    await store.clear();
    onLogout();
  }

  return (
    <ScrollView contentContainerStyle={styles.pad}>
      <View style={styles.row}>
        <Text style={styles.title}>Eventos</Text>
        <Pressable onPress={logout}>
          <Text style={styles.link}>salir</Text>
        </Pressable>
      </View>
      <Text style={styles.subtitle}>Elige un evento para validar (se descarga para uso offline)</Text>
      {error && <Text style={styles.error}>{error}</Text>}
      {events.map((e) => (
        <Pressable key={e.id} style={styles.card} onPress={() => pick(e.id)} disabled={!!downloading}>
          <Text style={styles.cardTitle}>{e.name}</Text>
          <Text style={styles.cardSub}>{downloading === e.id ? "descargando…" : e.status}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function Scanner({ onBack }: { onBack: () => void }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [offline, setOffline] = useState(false);
  const [queueCount, setQueueCount] = useState(0);
  const [verdict, setVerdict] = useState<(ScanOutcome & { provisional?: boolean }) | null>(null);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const lock = useRef(false);

  useEffect(() => {
    store.getManifest().then(setManifest);
    store.getQueue().then((q) => setQueueCount(q.length));
    if (!permission?.granted) requestPermission();
  }, []);

  async function onBarcode({ data }: { data: string }) {
    if (lock.current) return;
    lock.current = true;
    try {
      const outcome = offline ? await validateOffline(data) : await scanWithFallback(data);
      setVerdict(outcome);
    } finally {
      setTimeout(() => {
        lock.current = false;
        setVerdict(null);
      }, 2300);
    }
  }

  async function scanWithFallback(token: string): Promise<ScanOutcome & { provisional?: boolean }> {
    try {
      return await scanOnline(token, DEVICE_ID);
    } catch {
      // Sin red: cae a validación offline provisional y activa el modo offline.
      setOffline(true);
      return validateOffline(token);
    }
  }

  async function validateOffline(token: string): Promise<ScanOutcome & { provisional?: boolean }> {
    const m = manifest;
    const p = peekToken(token);
    if (!m || !p) return { result: "INVALID", reason: "QR ilegible" };
    const tk = m.tickets.find((t) => t.id === p.t);
    if (!tk || p.e !== m.event.id) return { result: "INVALID", reason: "No es de este evento" };
    if (tk.status === "VOID") return { result: "INVALID", reason: "Entrada anulada", ticket: { id: tk.id, seat: tk.seat, event: m.event.name, attendee: tk.attendee } };
    const queue = await store.getQueue();
    if (queue.some((q) => q.token === token) || tk.status === "CHECKED_IN") {
      return { result: "DUPLICATE", reason: "Ya escaneada", ticket: { id: tk.id, seat: tk.seat, event: m.event.name, attendee: tk.attendee } };
    }
    const item: QueuedScan = { token, seat: tk.seat, scannedAt: new Date().toISOString(), deviceId: DEVICE_ID };
    const next = [...queue, item];
    await store.setQueue(next);
    setQueueCount(next.length);
    return { result: "OK", provisional: true, ticket: { id: tk.id, seat: tk.seat, event: m.event.name, attendee: tk.attendee } };
  }

  async function doSync() {
    setSyncMsg(null);
    const queue = await store.getQueue();
    if (queue.length === 0) {
      setSyncMsg("Nada que sincronizar");
      return;
    }
    try {
      const res = await syncQueue(queue);
      const dup = res.results.filter((r) => r.result === "DUPLICATE").length;
      const ok = res.results.filter((r) => r.result === "OK").length;
      await store.setQueue([]);
      setQueueCount(0);
      setSyncMsg(`Sincronizadas ${res.synced}: ${ok} OK, ${dup} duplicadas/conflicto`);
    } catch (e) {
      setSyncMsg("Sin conexión: se reintentará");
    }
  }

  if (!permission) return <View style={styles.center} />;
  if (!permission.granted) {
    return (
      <View style={[styles.pad, styles.center, { flex: 1 }]}>
        <Text style={styles.subtitle}>Necesitamos la cámara para escanear</Text>
        <Pressable style={styles.btn} onPress={requestPermission}>
          <Text style={styles.btnText}>Permitir cámara</Text>
        </Pressable>
      </View>
    );
  }

  const v = verdict;
  const color = v?.result === "OK" ? "#16a34a" : v?.result === "DUPLICATE" ? "#d97706" : "#dc2626";

  return (
    <View style={{ flex: 1 }}>
      <CameraView
        style={{ flex: 1 }}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={onBarcode}
      />

      {/* Cabecera */}
      <View style={styles.overlayTop}>
        <Pressable onPress={onBack}>
          <Text style={styles.link}>← eventos</Text>
        </Pressable>
        <Text style={styles.headerEvent} numberOfLines={1}>
          {manifest?.event.name ?? ""}
        </Text>
        <Pressable onPress={() => setOffline((o) => !o)}>
          <Text style={[styles.badge, { backgroundColor: offline ? "#d97706" : "#16a34a" }]}>
            {offline ? "OFFLINE" : "ONLINE"}
          </Text>
        </Pressable>
      </View>

      {/* Veredicto grande */}
      {v && (
        <View style={[styles.verdict, { backgroundColor: color }]}>
          <Text style={styles.verdictBig}>
            {v.result === "OK" ? (v.provisional ? "✓ VÁLIDA (offline)" : "✓ ACCESO") : v.result === "DUPLICATE" ? "✗ YA USADA" : "✗ RECHAZADA"}
          </Text>
          {v.ticket?.seat ? <Text style={styles.verdictSeat}>Asiento {v.ticket.seat}</Text> : null}
          {v.ticket?.attendee ? <Text style={styles.verdictSeat}>{v.ticket.attendee}</Text> : null}
          {v.reason ? <Text style={styles.verdictReason}>{v.reason}</Text> : null}
          {v.previousScanAt ? (
            <Text style={styles.verdictReason}>1ª vez: {new Date(v.previousScanAt).toLocaleTimeString()}</Text>
          ) : null}
        </View>
      )}

      {/* Pie: cola + sync */}
      <View style={styles.overlayBottom}>
        <Text style={styles.queueText}>En cola: {queueCount}</Text>
        {syncMsg ? <Text style={styles.syncMsg}>{syncMsg}</Text> : null}
        <Pressable style={[styles.btn, { marginTop: 6 }]} onPress={doSync}>
          <Text style={styles.btnText}>Sincronizar</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f1115" },
  center: { justifyContent: "center", alignItems: "center" },
  pad: { padding: 20, paddingTop: 64 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { color: "#e9edf2", fontSize: 26, fontWeight: "700" },
  subtitle: { color: "#9aa3b2", fontSize: 14, marginVertical: 8, textAlign: "center" },
  input: {
    backgroundColor: "#171a21",
    borderColor: "#2b313c",
    borderWidth: 1,
    borderRadius: 8,
    color: "#e9edf2",
    padding: 12,
    marginVertical: 6,
    width: "100%",
    maxWidth: 320,
  },
  btn: { backgroundColor: "#5b9dff", borderRadius: 8, paddingVertical: 12, paddingHorizontal: 22, marginTop: 10 },
  btnText: { color: "#fff", fontWeight: "600", textAlign: "center", fontSize: 15 },
  link: { color: "#5b9dff", fontSize: 15 },
  error: { color: "#ff6b6b", marginVertical: 6 },
  card: { backgroundColor: "#171a21", borderColor: "#2b313c", borderWidth: 1, borderRadius: 10, padding: 16, marginTop: 10 },
  cardTitle: { color: "#e9edf2", fontSize: 16, fontWeight: "600" },
  cardSub: { color: "#7a8190", fontSize: 12, marginTop: 4 },
  overlayTop: {
    position: "absolute",
    top: 44,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerEvent: { color: "#fff", fontWeight: "600", flex: 1, textAlign: "center", marginHorizontal: 8 },
  badge: { color: "#fff", fontWeight: "700", fontSize: 12, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, overflow: "hidden" },
  verdict: { position: "absolute", top: "32%", left: 24, right: 24, padding: 24, borderRadius: 16, alignItems: "center" },
  verdictBig: { color: "#fff", fontSize: 30, fontWeight: "800" },
  verdictSeat: { color: "#fff", fontSize: 18, marginTop: 6, fontWeight: "600" },
  verdictReason: { color: "#fff", fontSize: 14, marginTop: 4, opacity: 0.9 },
  overlayBottom: { position: "absolute", bottom: 36, left: 0, right: 0, alignItems: "center" },
  queueText: { color: "#fff", fontSize: 14, fontWeight: "600" },
  syncMsg: { color: "#cdd6e0", fontSize: 13, marginTop: 4 },
});
