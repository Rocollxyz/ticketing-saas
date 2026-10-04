import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { schema } from "@ticketing/database";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { currentPriceCents, qualified, seatSold, seatTaken } from "../catalog/pricing";
import { eventSalesState, SALES_REASON_TEXT, ticketTypeSalesState } from "../catalog/sales-rules";
import { seatLabel } from "../catalog/seat-label";
import { AdminDb } from "../database/admin-db.service";
import { tenantContext } from "../database/tenant-context";
import { TenantDb } from "../database/tenant-db.service";
import { parseBilling } from "../billing/billing.service";
import { CheckoutService } from "../checkout/checkout.service";
import { hasActiveCouponTx } from "../catalog/coupon";
import { listTx as listFieldsTx } from "../events/attendee-fields.service";
import { PaymentRegistry } from "../payments/payment-registry";
import { HoldReleaseService } from "../reservation/hold-release.service";
import { HOLD_TTL_MINUTES, ReservationService } from "../reservation/reservation.service";

// Campos del perfil del promotor que son públicos (nunca ids internos ni fechas).
const PUBLIC_PROFILE = {
  name: schema.tenant.name,
  slug: schema.tenant.slug,
  tagline: schema.tenant.tagline,
  description: schema.tenant.description,
  logoUrl: schema.tenant.logoUrl,
  coverUrl: schema.tenant.coverUrl,
  accentColor: schema.tenant.accentColor,
  theme: schema.tenant.shopTheme,
  city: schema.tenant.city,
  contactEmail: schema.tenant.contactEmail,
  phone: schema.tenant.phone,
  website: schema.tenant.website,
  instagram: schema.tenant.instagram,
  facebook: schema.tenant.facebook,
  tiktok: schema.tenant.tiktok,
  x: schema.tenant.x,
  youtube: schema.tenant.youtube,
};

// Validación deliberadamente laxa: la prueba real es que el correo llegue.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Tienda pública (web de compra). El comprador es ANÓNIMO: no hay JWT. El tenant se
 * resuelve del slug del promotor en la URL (vía AdminDb) y se fija en el contexto
 * para que el resto de servicios (reserva, checkout) operen bajo RLS igual que
 * siempre. Reutiliza la lógica de negocio existente sin duplicarla.
 */
@Injectable()
export class StorefrontService {
  constructor(
    private readonly db: TenantDb,
    private readonly admin: AdminDb,
    private readonly reservation: ReservationService,
    private readonly checkout: CheckoutService,
    private readonly releaser: HoldReleaseService,
    private readonly payments: PaymentRegistry,
  ) {}

  /** Resuelve el tenant por slug y ejecuta `fn` con el contexto de tenant fijado. */
  private async withTenant<T>(slug: string, fn: () => Promise<T>): Promise<T> {
    const [t] = await this.admin.db
      .select({ id: schema.tenant.id })
      .from(schema.tenant)
      .where(eq(schema.tenant.slug, slug))
      .limit(1);
    if (!t) throw new NotFoundException("Promotor no encontrado");
    return new Promise<T>((resolve, reject) => {
      tenantContext.run(
        { tenantId: t.id, userId: "public", role: "buyer" },
        () => fn().then(resolve, reject),
      );
    });
  }

  /** Perfil público del promotor (cabecera de su página). Solo campos públicos. */
  profile(slug: string) {
    return this.withTenant(slug, () =>
      this.db.run(async (tx) => {
        const [t] = await tx.select(PUBLIC_PROFILE).from(schema.tenant);
        if (!t) throw new NotFoundException("Promotor no encontrado");
        return t;
      }),
    );
  }

  /** Últimos eventos ya celebrados (públicos y no cancelados), del más reciente. */
  pastEvents(slug: string) {
    return this.withTenant(slug, () =>
      this.db.run((tx) =>
        tx
          .select({
            id: schema.event.id,
            name: schema.event.name,
            category: schema.event.category,
            imageUrl: schema.event.imageUrl,
            timezone: schema.event.timezone,
            startsAt: schema.event.startsAt,
            venueName: schema.venue.name,
            venueCity: schema.venue.city,
          })
          .from(schema.event)
          .leftJoin(schema.venue, eq(schema.venue.id, schema.event.venueId))
          .where(
            and(
              inArray(schema.event.status, ["ON_SALE", "CLOSED"]),
              eq(schema.event.visibility, "PUBLIC"),
              sql`coalesce(${schema.event.endsAt}, ${schema.event.startsAt}) <= now()`,
            ),
          )
          .orderBy(sql`${schema.event.startsAt} desc`)
          .limit(12),
      ),
    );
  }

  /**
   * Listado público del promotor: eventos ON_SALE y PUBLIC (los UNLISTED solo se
   * abren con el enlace) que no hayan terminado, por fecha, con "desde X €".
   */
  listEvents(slug: string) {
    return this.withTenant(slug, () =>
      this.db.run(async (tx) => {
        const rows = await tx
          .select({
            id: schema.event.id,
            name: schema.event.name,
            summary: schema.event.summary,
            category: schema.event.category,
            imageUrl: schema.event.imageUrl,
            timezone: schema.event.timezone,
            startsAt: schema.event.startsAt,
            endsAt: schema.event.endsAt,
            salesStartAt: schema.event.salesStartAt,
            salesEndAt: schema.event.salesEndAt,
            status: schema.event.status,
            venueName: schema.venue.name,
            venueCity: schema.venue.city,
            // "Desde X €" = la entrada de PAGO más barata (una invitación a 0 € no
            // convierte el evento en gratuito). null + allFree = todo gratis.
            fromCents: sql<number | null>`(
              select min(pr) from (
                select ${currentPriceCents(schema.ticketType.id)} as pr from ticket_type
                where ticket_type.event_id = ${qualified(schema.event.id)}
              ) x where pr > 0
            )`.mapWith(Number),
            allFree: sql<boolean>`coalesce((
              select bool_and(pr = 0) from (
                select ${currentPriceCents(schema.ticketType.id)} as pr from ticket_type
                where ticket_type.event_id = ${qualified(schema.event.id)}
              ) x
            ), false)`,
            free: sql<number>`(
              select count(*) from seat
              where seat.event_id = ${qualified(schema.event.id)} and seat.ticket_type_id is not null
                and not ${seatTaken(schema.seat.id)}
            )`.mapWith(Number),
          })
          .from(schema.event)
          .leftJoin(schema.venue, eq(schema.venue.id, schema.event.venueId))
          .where(
            and(
              eq(schema.event.status, "ON_SALE"),
              eq(schema.event.visibility, "PUBLIC"),
              // No terminados (o sin fecha todavía).
              sql`coalesce(${schema.event.endsAt}, ${schema.event.startsAt}, 'infinity') > now()`,
            ),
          )
          .orderBy(sql`${schema.event.startsAt} asc nulls last`);
        return rows.map(({ salesStartAt, salesEndAt, status, endsAt, free, ...r }) => {
          const st = eventSalesState({ status, startsAt: r.startsAt, endsAt, salesStartAt, salesEndAt });
          return {
            ...r,
            soldOut: free === 0,
            salesOpen: st.open,
            salesMessage: st.open ? null : SALES_REASON_TEXT[st.reason],
          };
        });
      }),
    );
  }

  /**
   * Ficha pública del evento. Se ve también CLOSED/CANCELLED (para informar al que
   * llega con el enlace) pero solo se compra si `sales.open`. Numerado → plano con
   * disponibilidad por asiento; entrada general → plazas libres por categoría.
   */
  getEvent(slug: string, eventId: string) {
    return this.withTenant(slug, () =>
      this.db.run(async (tx) => {
        const [{ privacy: priv, ...organizer }] = await tx
          .select({
            name: schema.tenant.name,
            slug: schema.tenant.slug,
            logoUrl: schema.tenant.logoUrl,
            accentColor: schema.tenant.accentColor,
            theme: schema.tenant.shopTheme,
            privacy: {
              fiscalName: schema.tenant.fiscalName,
              contactEmail: schema.tenant.contactEmail,
              privacyUrl: schema.tenant.privacyUrl,
              termsUrl: schema.tenant.termsUrl,
              retentionDays: schema.tenant.attendeeRetentionDays,
            },
          })
          .from(schema.tenant);
        const [row] = await tx
          .select({ ev: schema.event, venue: schema.venue })
          .from(schema.event)
          .leftJoin(schema.venue, eq(schema.venue.id, schema.event.venueId))
          .where(and(eq(schema.event.id, eventId), ne(schema.event.status, "DRAFT")));
        if (!row) throw new NotFoundException("Evento no disponible");
        const { ev, venue } = row;

        const types = await tx
          .select({
            id: schema.ticketType.id,
            name: schema.ticketType.name,
            // Numerada (se elige en el plano) o general (por cantidad).
            seating: schema.ticketType.seating,
            description: schema.ticketType.description,
            salesStartAt: schema.ticketType.salesStartAt,
            salesEndAt: schema.ticketType.salesEndAt,
            minPerOrder: schema.ticketType.minPerOrder,
            maxPerOrder: schema.ticketType.maxPerOrder,
            precioCents: currentPriceCents(schema.ticketType.id),
            // Precio normal (sin fecha de fin) y fin del precio vigente: para mostrar
            // "anticipada 20 € (luego 25 €) hasta el 1/12".
            regularCents: sql<number | null>`(
              select p.amount_cents from price p
              where p.ticket_type_id = ${qualified(schema.ticketType.id)} and p.valid_to is null
              limit 1
            )`.mapWith(Number),
            priceEndsAt: sql<Date | null>`(
              select p.valid_to from price p
              where p.ticket_type_id = ${qualified(schema.ticketType.id)}
                and (p.valid_from is null or p.valid_from <= now())
                and (p.valid_to is null or p.valid_to > now())
              order by p.valid_to asc nulls last
              limit 1
            )`.mapWith((v) => (v == null ? null : new Date(v))),
          })
          .from(schema.ticketType)
          .where(eq(schema.ticketType.eventId, eventId))
          .orderBy(schema.ticketType.sortOrder, schema.ticketType.name);

        const seats = await tx
          .select({
            id: schema.seat.id,
            fila: schema.seat.fila,
            numero: schema.seat.numero,
            posX: schema.seat.posX,
            posY: schema.seat.posY,
            isGeneral: schema.seat.isGeneral,
            ticketTypeId: schema.seat.ticketTypeId,
            ocupado: seatTaken(schema.seat.id),
            vendido: seatSold(schema.seat.id),
          })
          .from(schema.seat)
          .where(eq(schema.seat.eventId, eventId));

        const free = new Map<string, number>();
        for (const s of seats) {
          if (s.ticketTypeId && !s.ocupado) free.set(s.ticketTypeId, (free.get(s.ticketTypeId) ?? 0) + 1);
        }
        const typeById = new Map(types.map((t) => [t.id, t]));
        const st = eventSalesState(ev);

        return {
          organizer: organizer ?? null,
          // Información de protección de datos que se muestra al comprar (art. 13 RGPD).
          privacy: {
            controller: priv.fiscalName ?? organizer.name,
            contactEmail: priv.contactEmail ?? row.ev.contactEmail,
            privacyUrl: priv.privacyUrl,
            termsUrl: priv.termsUrl,
            retentionDays: priv.retentionDays,
          },
          event: {
            id: ev.id,
            name: ev.name,
            status: ev.status,
            summary: ev.summary,
            description: ev.description,
            category: ev.category,
            imageUrl: ev.imageUrl,
            timezone: ev.timezone,
            startsAt: ev.startsAt,
            endsAt: ev.endsAt,
            doorsAt: ev.doorsAt,
            seatingMode: ev.seatingMode,
            maxPerOrder: ev.maxPerOrder,
            minAge: ev.minAge,
            refundPolicy: ev.refundPolicy,
            contactEmail: ev.contactEmail,
          },
          venue: venue && {
            name: venue.name,
            address: venue.address,
            city: venue.city,
            postalCode: venue.postalCode,
            mapsUrl: venue.mapsUrl,
          },
          // Formulario de asistentes (solo lo necesario para pintarlo).
          attendeeFields: (await listFieldsTx(tx, eventId)).map((f) => ({
            id: f.id,
            presetKey: f.presetKey,
            label: f.label,
            type: f.type,
            required: f.required,
            helpText: f.helpText,
            options: f.options,
            ticketTypeIds: f.ticketTypeIds,
          })),
          // Cómo se puede pagar (tarjeta, Bizum), según las pasarelas activas.
          paymentMethods: this.payments.methods(),
          holdMinutes: HOLD_TTL_MINUTES,
          // Solo para mostrar (o no) la casilla «código de descuento»; nunca los códigos.
          couponsAvailable: await hasActiveCouponTx(tx, eventId),
          sales: st.open
            ? { open: true, message: null }
            : { open: false, message: SALES_REASON_TEXT[st.reason], from: st.from ?? null },
          ticketTypes: types.map(({ salesStartAt, salesEndAt, ...t }) => {
            const tst = ticketTypeSalesState({ salesStartAt, salesEndAt });
            return {
              ...t,
              regularCents: t.regularCents !== t.precioCents ? t.regularCents : null,
              disponibles: free.get(t.id) ?? 0,
              salesOpen: tst.open,
              salesMessage: tst.open ? null : SALES_REASON_TEXT[tst.reason],
            };
          }),
          seats:
            ev.seatingMode === "RESERVED"
              ? seats
                  .filter((s) => !s.isGeneral)
                  .map((s) => {
                    const t = s.ticketTypeId ? typeById.get(s.ticketTypeId) : undefined;
                    return {
                      id: s.id,
                      fila: s.fila,
                      numero: s.numero,
                      posX: s.posX,
                      posY: s.posY,
                      ticketTypeId: s.ticketTypeId,
                      categoria: t?.name ?? null,
                      precioCents: t?.precioCents ?? null,
                      disponible: !s.ocupado && !!t,
                      vendido: s.vendido,
                    };
                  })
              : [],
        };
      }),
    );
  }

  createHold(
    slug: string,
    eventId: string,
    selection: { seatIds?: string[]; quantities?: Record<string, number> },
    sessionId: string,
  ) {
    return this.withTenant(slug, async () => {
      // Asientos (categorías numeradas) y/o cantidades (generales) en una sola reserva.
      const hold = await this.reservation.createHoldMixed(eventId, selection, sessionId);
      // Qué plaza y categoría tocó a cada entrada (en entrada general las elige el
      // servidor): el formulario de asistentes se monta por plaza con esto.
      const seats = await this.db.run((tx) =>
        tx
          .select({
            seatId: schema.seat.id,
            ticketTypeId: schema.seat.ticketTypeId,
            fila: schema.seat.fila,
            numero: schema.seat.numero,
            isGeneral: schema.seat.isGeneral,
            categoria: schema.ticketType.name,
          })
          .from(schema.seat)
          .leftJoin(schema.ticketType, eq(schema.ticketType.id, schema.seat.ticketTypeId))
          .where(inArray(schema.seat.id, hold.seatIds))
          .orderBy(schema.seat.numero),
      );
      return {
        ...hold,
        seats: seats.map((s) => ({ seatId: s.seatId, ticketTypeId: s.ticketTypeId, label: seatLabel(s) })),
      };
    });
  }

  /**
   * El comprador suelta su reserva ("cambiar selección"). Solo su propia sesión puede
   * hacerlo (sessionId), y si ya inició el pago se cancela antes el cobro.
   */
  releaseHold(slug: string, holdId: string, sessionId: string) {
    return this.withTenant(slug, async () => {
      const [h] = await this.db.run((tx) =>
        tx
          .select({ id: schema.hold.id })
          .from(schema.hold)
          .where(and(eq(schema.hold.id, holdId), eq(schema.hold.sessionId, sessionId ?? ""))),
      );
      if (!h) throw new NotFoundException("Reserva no encontrada");
      return { released: await this.releaser.release(h.id, "RELEASED") };
    });
  }

  /** Mensaje de confirmación del evento para la página de "compra completada". */
  confirmation(slug: string, eventId: string) {
    return this.withTenant(slug, () =>
      this.db.run(async (tx) => {
        const [ev] = await tx
          .select({ name: schema.event.name, message: schema.event.confirmationMessage })
          .from(schema.event)
          .where(and(eq(schema.event.id, eventId), ne(schema.event.status, "DRAFT")));
        if (!ev) throw new NotFoundException("Evento no disponible");
        return ev;
      }),
    );
  }

  /**
   * El comprador de la tienda es anónimo: el email es la ÚNICA vía de entregarle las
   * entradas (outbox → PDF por correo), así que aquí es obligatorio.
   */
  createCheckout(
    slug: string,
    holdId: string,
    buyerEmail?: string,
    buyer: { name?: unknown; attendees?: unknown; couponCode?: unknown; billing?: unknown; method?: unknown } = {},
  ) {
    const method = buyer.method === "bizum" ? "bizum" : "card";
    if (!UUID_RE.test(holdId ?? "")) throw new BadRequestException("Reserva inválida");
    const email = buyerEmail?.trim().toLowerCase();
    if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
      throw new BadRequestException("Email del comprador obligatorio y válido");
    }
    if (buyer.name != null && (typeof buyer.name !== "string" || buyer.name.length > 120)) {
      throw new BadRequestException("Nombre del comprador inválido");
    }
    return this.withTenant(slug, () =>
      this.checkout.createCheckout(holdId, email, {
        name: buyer.name as string | undefined,
        attendees: buyer.attendees,
        couponCode: couponCodeOf(buyer.couponCode),
        billing: buyer.billing == null ? null : parseBilling(buyer.billing),
        method,
        // Vuelta desde la pasarela (Redsys). La página de éxito verifica el pago firmado.
        returnUrls: (orderId) => ({
          ok: `${SHOP_URL}/${slug}/success?order=${orderId}&pay=redsys`,
          ko: `${SHOP_URL}/${slug}/success?order=${orderId}&pay=redsys&ko=1`,
        }),
      }),
    );
  }

  /**
   * Vuelta del comprador desde Redsys: trae el resultado FIRMADO (los mismos campos que la
   * notificación). Se verifica y se procesa igual que el webhook (idempotente), así el
   * pago se confirma aunque la notificación no llegue (p. ej. servidor local).
   */
  async confirmReturn(slug: string, orderId: string, params: Record<string, unknown>) {
    if (!UUID_RE.test(orderId)) throw new BadRequestException("Pedido inválido");
    const form = new URLSearchParams();
    for (const k of ["Ds_SignatureVersion", "Ds_MerchantParameters", "Ds_Signature"]) {
      if (typeof params[k] === "string") form.set(k, params[k] as string);
    }
    if (form.has("Ds_MerchantParameters")) {
      await this.checkout.handleWebhook("redsys", form.toString(), {}).catch(() => null);
    }
    return this.withTenant(slug, () => this.checkout.orderStatus(orderId));
  }

  /** Total de una selección con un código de descuento (sin reservar ni gastar el uso). */
  quoteCoupon(
    slug: string,
    eventId: string,
    selection: { seatIds?: unknown; quantities?: unknown },
    code: unknown,
  ) {
    const c = couponCodeOf(code);
    if (!c) throw new BadRequestException("Escribe un código");
    if (!UUID_RE.test(eventId)) throw new BadRequestException("Evento inválido");
    const seatIds = Array.isArray(selection.seatIds) ? selection.seatIds.filter((s) => typeof s === "string") : undefined;
    const quantities =
      selection.quantities && typeof selection.quantities === "object"
        ? (selection.quantities as Record<string, number>)
        : undefined;
    return this.withTenant(slug, () => this.checkout.quote(eventId, { seatIds, quantities }, c));
  }
}

/** URL pública de la tienda (vuelta desde las pasarelas por redirección). */
const SHOP_URL = process.env.SHOP_PUBLIC_URL ?? "http://localhost:3001";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function couponCodeOf(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v !== "string" || v.length > 40) throw new BadRequestException("Código de descuento no válido");
  return v.trim() || null;
}
