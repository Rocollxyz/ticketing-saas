/** Fecha legible en la zona horaria del evento (emails/PDF): "sáb, 12 dic 2026, 21:00". */
export function formatInZone(d: Date, timeZone: string, timeOnly = false): string {
  return new Intl.DateTimeFormat("es-ES", {
    timeZone,
    ...(timeOnly
      ? { hour: "2-digit", minute: "2-digit" }
      : { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }),
  }).format(d);
}
