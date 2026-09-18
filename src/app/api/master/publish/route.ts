import { requireMasterUser, unauthorizedResponse, type VerifiedUser } from '@/lib/apiSecurity';
import { createDocument, getDocument } from '@/lib/firebase';
import { editorialForStorage } from '@/lib/editorialContent';
import { getContentDetailPath } from '@/lib/contentDetailPath';
import { canonicalEditorialJson, editorialDigest, OPERATOR_BYLINE, validateEditorialArticle } from '@/lib/master/editorialPublishing';

export const runtime = 'edge';

export async function POST(request: Request) {
  let user: VerifiedUser;
  try { user = await requireMasterUser(request); } catch (error) { return unauthorizedResponse(error); }
  let input: Record<string, unknown>;
  let article;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > 300_000) return Response.json({ error: '기사 요청은 최대 300KB입니다.' }, { status: 413 });
    input = JSON.parse(raw);
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some((key) => !['article', 'reviewed', 'workflow'].includes(key))) throw new Error('article, reviewed, workflow 필드만 지원합니다.');
    if (input.reviewed !== true) throw new Error('기사별 원문·사실·사진 권리 검토가 필요합니다.');
    if (!['public-service', 'embassy', 'seo'].includes(String(input.workflow))) throw new Error('올바른 게시 작업 유형을 선택하세요.');
    article = validateEditorialArticle(input.article);
    if (input.workflow === 'seo' && !article.keyword) throw new Error('SEO 게시에는 키워드가 필요합니다.');
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'JSON 형식이 잘못되었습니다.' }, { status: 400 }); }

  try {
    if (input.workflow === 'seo') {
      const response = await fetch(new URL('/api/master/exposure?days=7', request.url), { cache: 'no-store', headers: { authorization: `Bearer ${user.token}` }, signal: AbortSignal.timeout(15_000) });
      const payload = await response.json() as { contracts?: Array<{ primaryKeyword?: string; status?: string }> };
      const ready = response.ok && payload.contracts?.some((contract) => contract.primaryKeyword?.toLowerCase() === article.keyword.toLowerCase() && ['EXPOSURE_READY', 'PUBLISHED', 'MONITORING', 'PROTECTED'].includes(String(contract.status)));
      if (!ready) return Response.json({ error: 'SEO 게시에는 해당 키워드의 EXPOSURE_READY 계약이 필요합니다.' }, { status: 409 });
    }
    // Identity excludes the batch and text so retries cannot create a second version.
    const id = `editorial-${await editorialDigest([user.uid, article.country, article.key])}`;
    const content = {
      type: article.category === 'community' ? 'general' : article.category, sourceCategory: article.category,
      country: article.country, topic: article.topic, keyword: article.keyword,
      title: article.title, summary: article.summary, description: article.summary, body: article.body,
      author: OPERATOR_BYLINE, authorId: user.uid, authorName: OPERATOR_BYLINE,
      editorial: editorialForStorage(article.editorial), seoTitle: article.seoTitle, metaDescription: article.metaDescription, seoTags: article.tags,
      editorialKey: article.key, editorialWorkflow: input.workflow,
      sourceName: article.editorial.sources.map((source) => source.publisher).filter((name, index, all) => all.indexOf(name) === index).join(' · '),
      status: 'published', isPublic: true, reviewedBy: user.uid,
    };
    const digest = await editorialDigest(content);
    const matches = (stored: Record<string, unknown>) => stored.editorialDigest === digest && Object.entries(content).every(([key, value]) => canonicalEditorialJson(stored[key]) === canonicalEditorialJson(value));
    let stored = await getDocument<Record<string, unknown>>('posts', id, user.token);
    let created = false;
    if (!stored) {
      try {
        const now = new Date().toISOString();
        await createDocument('posts', id, { ...content, editorialDigest: digest, createdAt: now, reviewedAt: now, views: 0, likes: 0, comments: 0 }, user.token);
        created = true;
      } catch (error) {
        // A lost response or simultaneous create may already have saved exactly this article.
        stored = await getDocument<Record<string, unknown>>('posts', id, user.token);
        if (!stored) throw error;
      }
      if (!stored) stored = await getDocument<Record<string, unknown>>('posts', id, user.token);
    }
    if (!stored) return Response.json({ error: '저장 결과를 읽어 확인하지 못했습니다. 동일 기사로 재시도하세요.' }, { status: 503 });
    if (!matches(stored)) return Response.json({ error: '같은 국가·key에 다른 내용이 이미 있습니다. 기존 글은 덮어쓰지 않았습니다. 원래 기사 내용으로 재시도하거나 기존 글을 확인하세요.', id }, { status: 409 });
    return Response.json({ id, href: getContentDetailPath('posts', id, content), verified: true, alreadyPublished: !created }, { status: created ? 201 : 200 });
  } catch {
    return Response.json({ error: '게시 또는 저장 확인에 실패했습니다. 편집 내용은 유지됩니다. 로그인·연결·Firestore 권한을 확인한 뒤 같은 기사로 재시도하세요.' }, { status: 503 });
  }
}
