import type { Metadata } from "next";
import { fetchProfile } from "../../lib/api";
import PromoterView from "./PromoterView";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const p = await fetchProfile(slug);
  return {
    title: `${p.name} · Entradas`,
    description: p.tagline ?? p.description?.slice(0, 160) ?? undefined,
    openGraph: p.coverUrl || p.logoUrl ? { images: [(p.coverUrl ?? p.logoUrl)!] } : undefined,
  };
}

/** Página pública del promotor (ver PromoterView). */
export default async function PromoterPage({ params }: Params) {
  const { slug } = await params;
  return <PromoterView slug={slug} />;
}
