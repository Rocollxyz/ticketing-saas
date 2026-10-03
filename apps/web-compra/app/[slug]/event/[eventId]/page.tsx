import type { Metadata } from "next";
import { fetchEvent } from "../../../../lib/api";
import EventClient from "./EventClient";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; eventId: string }>;
}): Promise<Metadata> {
  const { slug, eventId } = await params;
  const { event, organizer } = await fetchEvent(slug, eventId);
  return {
    title: organizer ? `${event.name} · ${organizer.name}` : event.name,
    description: event.summary ?? undefined,
    openGraph: event.imageUrl ? { images: [event.imageUrl] } : undefined,
  };
}

export default async function EventPage({
  params,
}: {
  params: Promise<{ slug: string; eventId: string }>;
}) {
  const { slug, eventId } = await params;
  const detail = await fetchEvent(slug, eventId);
  return <EventClient slug={slug} detail={detail} />;
}
