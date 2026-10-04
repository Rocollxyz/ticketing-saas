import SuccessView from "../../../[slug]/success/SuccessView";
import EmbedHeight from "../../EmbedHeight";

/** Compra completada dentro del módulo incrustado: los enlaces siguen dentro del módulo. */
export default async function EmbedSuccess({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { slug } = await params;
  return (
    <>
      <EmbedHeight />
      <SuccessView slug={slug} base={`/embed/${slug}`} searchParams={searchParams} />
    </>
  );
}
