import { fetchEvent } from "../../../../../lib/api";
import EventClient from "../../../../[slug]/event/[eventId]/EventClient";
import EmbedHeight from "../../../EmbedHeight";

/** Ficha de evento con la compra, para incrustar o abrir en la ventana flotante de `embed.js`. */
export default async function EmbedEvent({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; eventId: string }>;
  searchParams: Promise<{ desde?: string }>;
}) {
  const { slug, eventId } = await params;
  const { desde } = await searchParams;
  const detail = await fetchEvent(slug, eventId);
  return (
    <>
      <EmbedHeight />
      <EventClient slug={slug} detail={detail} embed backToList={desde === "cartelera"} />
    </>
  );
}
