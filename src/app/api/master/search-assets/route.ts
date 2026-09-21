import { requireMasterUser, unauthorizedResponse } from '@/lib/apiSecurity';
import { getAdminJsonDocument, listAdminJsonDocuments, upsertAdminJsonDocument } from '@/lib/firebaseAdmin';
import { loadExposureRows } from '@/lib/master/keywordData';
import { assetKeywordSummary, buildSearchAssetRegistry, generateKeywordSlots, mergeVerifiedKeywords, SITEMAP_SEGMENT_LABELS, type AssetKeywordPlan, type SearchAsset } from '@/lib/master/searchAssets';

export const runtime = 'edge';

const REGISTRY = buildSearchAssetRegistry();

function pathKey(value: string): string {
  try { return new URL(value).pathname.replace(/\/$/, '') || '/'; } catch { return value.replace(/\/$/, '') || '/'; }
}

function rowsByPath(rows: Awaited<ReturnType<typeof loadExposureRows>>['rows']) {
  const map = new Map<string, typeof rows>();
  for (const row of rows) {
    const path = pathKey(row.page);
    map.set(path, [...(map.get(path) || []), row]);
  }
  return map;
}

function segmentSummary(assets: Array<SearchAsset & { queryCount: number; verifiedQueryCount: number; clusterCount: number; keywordCluster: string[] }>) {
  return [...new Set(REGISTRY.map((asset) => asset.sitemapSegment))].map((segment) => {
    const rows = assets.filter((asset) => asset.sitemapSegment === segment);
    return {
      segment,
      label: SITEMAP_SEGMENT_LABELS[segment],
      total: rows.length,
      observed: rows.filter((asset) => asset.queryCount > 0).length,
      verified: rows.filter((asset) => asset.verifiedQueryCount > 0).length,
      queries: rows.reduce((sum, asset) => sum + asset.queryCount, 0),
    };
  });
}

export async function GET(request: Request) {
  try {
    await requireMasterUser(request);
  } catch (error) {
    return unauthorizedResponse(error);
  }
  const url = new URL(request.url);
  const detailPath = url.searchParams.get('path') || '';
  const current = await loadExposureRows(28);
  const byPath = rowsByPath(current.rows);
  const planDocuments = detailPath ? [] : await listAdminJsonDocuments('searchAssetClusters').catch(() => []);
  const plans = new Map(planDocuments.map((item) => [item.id, item.data as AssetKeywordPlan]));
  const summaries = REGISTRY.map((asset) => {
    const slots = mergeVerifiedKeywords(asset, generateKeywordSlots(asset, plans.get(asset.id)), byPath.get(asset.targetPath) || []);
    return assetKeywordSummary(asset, slots);
  });
  const segments = segmentSummary(summaries);
  const observed = summaries.filter((asset) => asset.queryCount > 0);
  const response: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    range: current.range,
    source: current.source,
    sourceMessage: current.message,
    summary: {
      targetCount: summaries.length,
      importantCount: summaries.filter((asset) => asset.important).length,
      observedCount: observed.length,
      verifiedQueryCount: summaries.reduce((sum, asset) => sum + asset.verifiedQueryCount, 0),
      candidateQueryCount: summaries.reduce((sum, asset) => sum + Math.max(0, asset.queryCount - asset.verifiedQueryCount), 0),
      unverifiedImportantCount: summaries.filter((asset) => asset.important && asset.verifiedQueryCount === 0).length,
    },
    segments,
    assets: summaries,
    priorityUrls: summaries.filter((asset) => asset.important).map((asset) => asset.targetPath),
  };
  if (detailPath) {
    const asset = REGISTRY.find((item) => item.targetPath === detailPath);
    if (!asset) return Response.json({ error: '대상 URL을 자산 목록에서 찾을 수 없습니다.' }, { status: 404 });
    const stored = await getAdminJsonDocument('searchAssetClusters', asset.id).catch(() => null);
    const plan = stored?.data as AssetKeywordPlan | undefined;
    const slots = mergeVerifiedKeywords(asset, generateKeywordSlots(asset, plan), byPath.get(asset.targetPath) || []);
    response.asset = { ...assetKeywordSummary(asset, slots), keywordSlots: slots, plan: plan || null };
  }
  return Response.json(response);
}

export async function POST(request: Request) {
  let user;
  try {
    user = await requireMasterUser(request);
  } catch (error) {
    return unauthorizedResponse(error);
  }
  const body = await request.json().catch(() => null) as { action?: string; assetId?: string; primaryKeyword?: string; approvedKeywords?: string[]; urls?: string[] } | null;
  if (body?.action === 'savePlan') {
    const asset = REGISTRY.find((item) => item.id === body.assetId);
    if (!asset) return Response.json({ error: '대상 URL을 자산 목록에서 찾을 수 없습니다.' }, { status: 404 });
    const approvedKeywords = [...new Set((body.approvedKeywords || []).map((item) => String(item).trim()).filter((item) => item && item.length <= 160))].slice(0, 80);
    const primaryKeyword = String(body.primaryKeyword || approvedKeywords[0] || '').trim().slice(0, 160);
    if (primaryKeyword && !approvedKeywords.includes(primaryKeyword)) approvedKeywords.unshift(primaryKeyword);
    await upsertAdminJsonDocument('searchAssetClusters', asset.id, { assetId: asset.id, targetPath: asset.targetPath, primaryKeyword, approvedKeywords, updatedBy: user.email || user.uid, updatedAt: new Date().toISOString() });
    return Response.json({ ok: true, assetId: asset.id, targetPath: asset.targetPath, approvedKeywords: approvedKeywords.length });
  }
  if (body?.action === 'queuePriorityUrls') {
    const urls = [...new Set((body.urls || []).map((item) => String(item).trim()).filter((item) => REGISTRY.some((asset) => asset.targetPath === item)))].slice(0, 1_000);
    await upsertAdminJsonDocument('searchIndexQueue', 'priority', { urls, status: 'QUEUED', updatedBy: user.email || user.uid, updatedAt: new Date().toISOString(), note: 'Google Search Console URL 검사와 내부 링크·사이트맵 재검토 대상' });
    return Response.json({ ok: true, queued: urls.length, note: 'Google 색인은 강제 완료할 수 없으며 Search Console URL 검사와 크롤링 대기 대상만 등록했습니다.' });
  }
  return Response.json({ error: '요청 작업이 올바르지 않습니다.' }, { status: 400 });
}
