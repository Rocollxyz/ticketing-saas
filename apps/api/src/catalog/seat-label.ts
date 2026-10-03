/** Etiqueta visible de una plaza: "A3" en numerados; la categoría en entrada general. */
export function seatLabel(s: {
  fila: string;
  numero: number;
  isGeneral: boolean;
  categoria?: string | null;
}): string {
  return s.isGeneral ? (s.categoria ?? "Entrada general") : `${s.fila}${s.numero}`;
}
