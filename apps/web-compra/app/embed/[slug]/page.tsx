import PromoterView from "../../[slug]/PromoterView";

/** Cartelera del promotor para incrustar en su web (`<div data-entradas-cartelera>`). */
export default async function EmbedPromoter({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <PromoterView slug={slug} embed />;
}
