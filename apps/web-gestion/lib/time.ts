/**
 * Fechas en la ZONA DEL EVENTO, no en la del navegador: un promotor en Canarias que
 * crea un concierto en Madrid escribe "21:00" y debe guardarse las 21:00 de Madrid.
 * La API guarda UTC; aquí se convierte desde/hacia el valor de un <input
 * type="datetime-local"> ("YYYY-MM-DDTHH:mm") interpretado en `tz`.
 */

/** Desplazamiento (ms) de `tz` respecto a UTC en el instante `at`. */
function offsetMs(at: Date, tz: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** ISO UTC → valor de datetime-local en `tz`. */
export function toLocalInput(iso: string | null | undefined, tz: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const local = new Date(d.getTime() + offsetMs(d, tz));
  return local.toISOString().slice(0, 16);
}

/** Valor de datetime-local en `tz` → ISO UTC (null si vacío). */
export function fromLocalInput(local: string, tz: string): string | null {
  if (!local) return null;
  const naive = new Date(`${local}:00Z`); // la hora "de pared" leída como UTC
  // Dos pasadas: el desplazamiento depende del instante (cambios de horario).
  let utc = naive.getTime() - offsetMs(naive, tz);
  utc = naive.getTime() - offsetMs(new Date(utc), tz);
  return new Date(utc).toISOString();
}

/** Fecha legible en `tz`: "sáb, 12 dic 2026, 21:00". */
export function formatInZone(iso: string | null | undefined, tz: string): string {
  if (!iso) return "Sin fecha";
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: tz,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export const TIMEZONES = [
  "Europe/Madrid",
  "Atlantic/Canary",
  "Europe/Lisbon",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Rome",
  "America/New_York",
  "America/Mexico_City",
  "America/Bogota",
  "America/Argentina/Buenos_Aires",
  "UTC",
];
