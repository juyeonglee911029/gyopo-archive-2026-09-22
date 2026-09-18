import { countryForRegion, regionalPostHref } from './regionRoutes';
import { publicArticleCategory } from './publicArticle';

export function getContentDetailPath(collection: string, id: string, record: { country: string; type?: unknown; sourceCategory?: unknown }): string {
  const country = countryForRegion(record.country);
  const category = publicArticleCategory(collection, record);
  if (!country || !category) throw new Error('게시글의 국가 또는 카테고리 경로를 확인할 수 없습니다.');
  return regionalPostHref(country, category, id);
}
