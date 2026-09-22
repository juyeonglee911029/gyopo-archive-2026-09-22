import KoreanStuffStorefront from '../../KoreanStuffStorefront';

export const runtime = 'edge';

export default async function KoreanStuffProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <KoreanStuffStorefront initialProductId={decodeURIComponent(id)} />;
}
