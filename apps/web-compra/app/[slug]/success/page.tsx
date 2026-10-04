import SuccessView from "./SuccessView";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | undefined>> };

export default async function SuccessPage(props: Props) {
  const { slug } = await props.params;
  return <SuccessView slug={slug} base={`/${slug}`} searchParams={props.searchParams} />;
}
