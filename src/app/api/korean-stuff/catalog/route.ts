import { getAdminJsonDocument, listAdminJsonDocuments } from '@/lib/firebaseAdmin';
import { normalizeKoreanStuffPolicy, productIsSellable, type KoreanStuffProduct } from '@/lib/koreanStuff';

export const runtime = 'edge';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const category = url.searchParams.get('category') || '';
  const query = (url.searchParams.get('q') || '').trim().toLocaleLowerCase('ko-KR');
  try {
    const [rows, settingsRow] = await Promise.all([
      listAdminJsonDocuments('koreanStuffProducts'),
      getAdminJsonDocument('koreanStuffSettings', 'default'),
    ]);
    const settings = normalizeKoreanStuffPolicy(settingsRow?.data);
    const products = rows
      .map((row) => ({ id: row.id, ...(row.data as Omit<KoreanStuffProduct, 'id'>) }))
      .filter((product): product is KoreanStuffProduct => productIsSellable(product, settings))
      .filter((product) => !category || product.category === category)
      .filter((product) => !query || `${product.title} ${product.brand || ''} ${product.sourceName}`.toLocaleLowerCase('ko-KR').includes(query))
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    return Response.json({ products, count: products.length, generatedAt: new Date().toISOString() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '상품 목록을 불러오지 못했습니다.' }, { status: 503 });
  }
}
