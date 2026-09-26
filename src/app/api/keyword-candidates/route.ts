import { buildSearchAssetRegistry, generateKeywordSlots, SITEMAP_SEGMENT_LABELS } from '@/lib/master/searchAssets';
import { REFERENCE_INDEX_GENERATED_AT, SELECTED_CITY_LABELS, SELECTED_US_CANDIDATES } from './selectedReference';

export const runtime = 'edge';

// Public taxonomy only: never join stored plans, provider responses, or admin data here.
const REGISTRY = buildSearchAssetRegistry();
const ASSETS = REGISTRY.map((asset) => {
  const cityLabel = SELECTED_CITY_LABELS[asset.citySlug];
  return {
    ...asset,
    primaryIntent: cityLabel ? asset.primaryIntent.replace(cityLabel[0], cityLabel[1]) : asset.primaryIntent,
    countryCode: asset.targetPath.startsWith('/uk/') ? 'UK' : asset.countryCode,
    sitemapSegmentLabel: SITEMAP_SEGMENT_LABELS[asset.sitemapSegment],
  };
});
const SEGMENTS = [...new Set(ASSETS.map((asset) => asset.sitemapSegment))].map((segment) => ({
  segment,
  label: SITEMAP_SEGMENT_LABELS[segment],
  total: ASSETS.filter((asset) => asset.sitemapSegment === segment).length,
}));

export function GET(request: Request) {
  const path = new URL(request.url).searchParams.get('path');
  if (path !== null) {
    if (path.length > 400 || !path.startsWith('/') || path.startsWith('//') || /[?#\\]/.test(path)) {
      return Response.json({ error: '사이트 내부 URL 경로를 지정해주세요.' }, { status: 400 });
    }
    const targetPath = path.replace(/\/+$/, '') || '/';
    const assetIndex = ASSETS.findIndex((item) => item.targetPath === targetPath);
    if (assetIndex < 0) return Response.json({ error: '대상 URL을 자산 목록에서 찾을 수 없습니다.' }, { status: 404 });
    const asset = ASSETS[assetIndex];
    const isCaptured = targetPath === '/us';
    const candidates = isCaptured ? SELECTED_US_CANDIDATES.map(([query, clusterLabel], index) => ({
      slot: `K${String(index + 1).padStart(2, '0')}`,
      query,
      clusterLabel,
      role: index === 0 ? 'PRIMARY' : index < 8 ? 'SECONDARY' : 'CANDIDATE',
    })) : generateKeywordSlots(REGISTRY[assetIndex]);
    const keywordSlots = candidates.map(({ slot, query, clusterLabel, role }) => ({
      slot, query, clusterLabel, role,
      verification: 'CANDIDATE',
      source: 'taxonomy',
      clicks: null,
      impressions: null,
      ctr: null,
      position: null,
    }));
    return Response.json({
      source: isCaptured ? 'selected_public_snapshot' : 'local_taxonomy_reconstruction',
      sourceMessage: isCaptured
        ? '선택 배포본에서 캡처한 /us 후보 80개의 문구·순서·분류입니다. 정적 후보이며 실시간 검색어·순위가 아닙니다.'
        : 'URL 목록 정보는 선택 배포본과 대조했습니다. 이 URL의 후보 문구는 기존 분류로 재구성했으며 원본 상세와 대조되지 않았습니다. Google 성과가 아닙니다.',
      asset: { ...asset, keywordSlots },
    });
  }
  return Response.json({
    generatedAt: new Date().toISOString(),
    referenceIndexGeneratedAt: REFERENCE_INDEX_GENERATED_AT,
    source: 'reference_aligned_taxonomy',
    sourceMessage: 'URL 목록·구간은 선택 배포본과 대조했습니다. /us 후보만 캡처 원본이며 나머지 후보는 기존 분류 재구성본입니다. 정적 후보를 Google 실시간 성과·순위로 표시하지 않습니다.',
    assets: ASSETS,
    segments: SEGMENTS,
    summary: {
      targetCount: ASSETS.length,
      slotsPerAsset: 80,
      candidateSlotCount: ASSETS.length * 80,
      verifiedQueryCount: null,
      source: 'GYOPO taxonomy candidate mapping',
    },
  });
}
