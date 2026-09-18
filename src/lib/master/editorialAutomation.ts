import { editorialForStorage } from '../editorialContent';
import { getContentDetailPath } from '../contentDetailPath';
import { getCountryRoute } from '../regionRoutes';
import { canonicalEditorialJson, editorialDigest, OPERATOR_BYLINE, validateEditorialArticle, type EditorialArticle } from './editorialPublishing';
import { AutomationConflict, CONTROL_PATH, attemptPath, jobPath, receiptPath, type AutomationStore, type AutomationWrite } from './editorialAutomationStore';
import type { EditorialDiscoveryMode } from './editorialCandidates';

export const AUTOMATION_LIMITS = { activeJobs: 24, receipts: 24, generationsPerTopic: 3, retries: 3, leaseMs: 240_000, generationMs: 150_000 } as const;
export const AUTOMATION_POLICY = 'source-grounded-auto-v1; schema + provider eligibility; not human reviewed';
export const AUTOMATION_REVIEWER = 'GYOPO automatic editorial agent';
export type AutomationConfig = { country: string; discoveryMode?: EditorialDiscoveryMode; enabled: boolean; autoPublish: boolean; intervalMinutes: number; maxDailyArticles: number; maxDailyGenerations: number };
export type AutomationControl = AutomationConfig & {
  ownerUid: string; activeIds: string[]; generation: number; lease: { id: string; generation: number; expiresAt: string } | null;
  day: string; calls: number; publications: number; inputTokens: number; outputTokens: number; webSearchCalls: number;
  lastTick: string | null; nextRunAt: string | null; lastError: string | null; schedulerHeartbeat: string | null; marketCursor: number; updatedAt: string;
};
export type AutomationStatus = 'queued' | 'generating' | 'review' | 'publishing' | 'published_unverified' | 'verified' | 'failed' | 'cancelled';
export type KeywordCandidate = { country: string; keyword: string; source: string };
export type GeneratedEditorial = {
  draft: EditorialArticle; researchMode: string; model: string;
  usage: { inputTokens: number; outputTokens: number; webSearchCalls: number }; responseIds: string[];
  autoPublishEligible: boolean; issues: string[];
};
export type AutomationJob = KeywordCandidate & {
  id: string; status: AutomationStatus; error: string | null; href: string | null; draft: EditorialArticle | null;
  generationAttempts: number; publicationAttempts: number; verificationAttempts: number; paidAmbiguous: boolean;
  generationResult: Omit<GeneratedEditorial, 'draft'> | null; updatedAt: string; createdAt: string;
};
type AttemptReceipt = { result: GeneratedEditorial; updatedAt: string };
type ControlSnapshot = { data: AutomationControl; version: string | null };
export type AutomationDependencies = {
  store: AutomationStore; uid: string; now?: () => number;
  generate: (input: { country: string; keyword: string }) => Promise<GeneratedEditorial>;
  market: (country: string, mode: EditorialDiscoveryMode) => Promise<KeywordCandidate[]>;
  verify?: (job: AutomationJob) => Promise<void>;
};
export class AutomationInputError extends Error { readonly status = 400; }
export function normalizeAutomationCountry(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z]{2}$/i.test(value) || getCountryRoute(value)?.isoAlpha2 !== value.toUpperCase()) throw new AutomationInputError('country must be a supported ISO two-letter code.');
  return value.toUpperCase();
}
export function normalizeAutomationKeyword(value: unknown): string {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) throw new AutomationInputError('Invalid keyword.');
  const normalized = value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
  if (!normalized || [...normalized].length > 160) throw new AutomationInputError('keyword must contain 1..160 characters.');
  return normalized;
}
export async function automationTopicId(country: string, keyword: string) {
  return editorialDigest([normalizeAutomationCountry(country), normalizeAutomationKeyword(keyword)]);
}
function fields(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !allowed.includes(key))) throw new AutomationInputError('Invalid or unsupported fields.');
  return value as Record<string, unknown>;
}
export function parseAutomationConfig(value: unknown): AutomationConfig {
  const row = fields(value, ['country', 'discoveryMode', 'enabled', 'autoPublish', 'intervalMinutes', 'maxDailyArticles', 'maxDailyGenerations']);
  if (row.discoveryMode !== undefined && !['trends', 'ideas', 'official-topics'].includes(String(row.discoveryMode))) throw new AutomationInputError('Invalid discoveryMode.');
  if (typeof row.enabled !== 'boolean' || typeof row.autoPublish !== 'boolean') throw new AutomationInputError('enabled and autoPublish must be explicit booleans.');
  for (const key of ['intervalMinutes', 'maxDailyArticles', 'maxDailyGenerations']) {
    if (!Number.isSafeInteger(row[key]) || Number(row[key]) < (key === 'intervalMinutes' ? 5 : 1)
      || Number(row[key]) > (key === 'intervalMinutes' ? 1440 : 24)) throw new AutomationInputError('intervalMinutes: 5..1440; daily article/generation limits: 1..24.');
  }
  return { country: normalizeAutomationCountry(row.country), discoveryMode: (row.discoveryMode || 'trends') as EditorialDiscoveryMode, enabled: row.enabled, autoPublish: row.autoPublish,
    intervalMinutes: row.intervalMinutes as number, maxDailyArticles: row.maxDailyArticles as number, maxDailyGenerations: row.maxDailyGenerations as number };
}
export function parseAutomationAction(value: unknown) {
  const row = fields(value, ['action', 'country', 'discoveryMode', 'enabled', 'autoPublish', 'intervalMinutes', 'maxDailyArticles', 'maxDailyGenerations', 'keyword', 'source', 'retry', 'id']);
  const { action, ...input } = row;
  if (action === 'configure') return { action, config: parseAutomationConfig(input) } as const;
  if (action === 'pause' || action === 'tick') { fields(input, []); return { action } as const; }
  if (action === 'cancel') {
    fields(input, ['id']);
    if (typeof input.id !== 'string' || !/^[a-f0-9]{64}$/.test(input.id)) throw new AutomationInputError('Invalid automation job id.');
    return { action, id: input.id } as const;
  }
  if (action !== 'enqueue') throw new AutomationInputError('Choose configure, pause, enqueue, cancel or tick.');
  fields(input, ['country', 'keyword', 'source', 'retry']);
  if (typeof input.source !== 'string' || !['manual', 'trends', 'ideas', 'google-trends', 'google-ads', 'official-topics'].includes(input.source)
    || input.retry !== undefined && typeof input.retry !== 'boolean') throw new AutomationInputError('Invalid source or retry flag.');
  return { action, candidate: { country: normalizeAutomationCountry(input.country), keyword: normalizeAutomationKeyword(input.keyword), source: input.source }, retry: input.retry === true } as const;
}
export function defaultAutomationControl(uid: string, now: number): AutomationControl {
  return { ownerUid: uid, country: 'KR', discoveryMode: 'trends', enabled: false, autoPublish: false, intervalMinutes: 15, maxDailyArticles: 1, maxDailyGenerations: 1,
    activeIds: [], generation: 0, lease: null, day: new Date(now).toISOString().slice(0, 10), calls: 0, publications: 0,
    inputTokens: 0, outputTokens: 0, webSearchCalls: 0, lastTick: null, nextRunAt: null, lastError: null, schedulerHeartbeat: null, marketCursor: 0, updatedAt: new Date(now).toISOString() };
}
export function automationSetup(control: AutomationControl, environment: Record<string, string | undefined>, now = Date.now()): string[] {
  const missing = ['FIREBASE_SERVICE_ACCOUNT_JSON', 'EDITORIAL_AUTOMATION_UID', 'OPENAI_API_KEY'].filter((name) => !environment[name]?.trim());
  const secret = environment.EDITORIAL_AUTOMATION_SECRET;
  if (!secret || secret.length < 32 || secret.length > 256) missing.push('EDITORIAL_AUTOMATION_SECRET');
  const heartbeatAge = now - Date.parse(control.schedulerHeartbeat || '');
  if (!Number.isFinite(heartbeatAge) || heartbeatAge < 0 || heartbeatAge > 15 * 60_000) missing.push('EDITORIAL_AUTOMATION_SCHEDULER_HEARTBEAT');
  return missing;
}

export function createEditorialAutomation(deps: AutomationDependencies) {
  const { store } = deps;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(deps.uid)) throw new Error('EDITORIAL_AUTOMATION_UID is required.');
  const now = deps.now || Date.now;
  const iso = () => new Date(now()).toISOString();
  async function control(): Promise<ControlSnapshot> {
    const snapshot = await store.read<AutomationControl>(CONTROL_PATH);
    if (!snapshot) return { data: defaultAutomationControl(deps.uid, now()), version: null };
    const c = snapshot.data;
    parseAutomationConfig(Object.fromEntries(['country', 'discoveryMode', 'enabled', 'autoPublish', 'intervalMinutes', 'maxDailyArticles', 'maxDailyGenerations'].map((key) => [key, c[key as keyof AutomationControl]])));
    if (c.ownerUid !== deps.uid || !Array.isArray(c.activeIds) || c.activeIds.length > AUTOMATION_LIMITS.activeJobs
      || new Set(c.activeIds).size !== c.activeIds.length || c.activeIds.some((id) => !/^[a-f0-9]{64}$/.test(id))
      || ![c.generation, c.calls, c.publications, c.inputTokens, c.outputTokens, c.webSearchCalls, c.marketCursor].every((n) => Number.isSafeInteger(n) && n >= 0)) throw new Error('Invalid automation control.');
    return snapshot;
  }
  function rollDay(c: AutomationControl) {
    const day = iso().slice(0, 10);
    if (day > c.day) Object.assign(c, { day, calls: 0, publications: 0, inputTokens: 0, outputTokens: 0, webSearchCalls: 0 });
  }
  function writeControl(snapshot: ControlSnapshot): AutomationWrite {
    snapshot.data.updatedAt = iso();
    return { path: CONTROL_PATH, version: snapshot.version, data: snapshot.data };
  }
  async function mutate(operation: (snapshot: ControlSnapshot) => Promise<AutomationWrite[] | null>) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const snapshot = await control();
      const writes = await operation(snapshot);
      if (!writes) return;
      try { await store.commit([writeControl(snapshot), ...writes]); return; }
      catch (error) { if (!(error instanceof AutomationConflict) || attempt === 4) throw error; }
    }
  }
  async function envelope() {
    const c = (await control()).data;
    const [active, archived] = await Promise.all([
      Promise.all(c.activeIds.map((id) => store.read<AutomationJob>(jobPath(id)))), store.receipts<AutomationJob>(AUTOMATION_LIMITS.receipts),
    ]);
    const jobs = new Map(archived.map((job) => [job.id, job]));
    active.forEach((job) => { if (job) jobs.set(job.data.id, job.data); });
    return { control: c, jobs: [...jobs.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), setup: [] as string[] };
  }
  async function configure(config: AutomationConfig) {
    const valid = parseAutomationConfig(config);
    await mutate(async (snapshot) => { Object.assign(snapshot.data, valid); return []; });
  }
  async function pause() {
    // Keep the lease for safe draft persistence, but revoke publication via the control CAS.
    await mutate(async (snapshot) => { snapshot.data.enabled = false; return []; });
  }
  async function cancel(id: string) {
    const parsed = parseAutomationAction({ action: 'cancel', id });
    if (parsed.action !== 'cancel') throw new AutomationInputError('Invalid cancellation.');
    await mutate(async (snapshot) => {
      if (!snapshot.data.activeIds.includes(parsed.id)) return null;
      const active = await store.read<AutomationJob>(jobPath(parsed.id));
      if (!active) {
        snapshot.data.activeIds = snapshot.data.activeIds.filter((item) => item !== parsed.id);
        return [];
      }
      if (active.data.href || active.data.status === 'published_unverified' || active.data.status === 'verified') {
        throw new AutomationInputError('이미 공개된 작업은 취소할 수 없습니다. 공개 확인을 계속하거나 별도 비공개 처리를 선택하세요.');
      }
      const cancelled = { ...active.data, status: 'cancelled' as const,
        error: '운영자가 작업을 취소했습니다. 생성이 이미 시작된 경우 과금 여부는 제공자 청구 내역에서 확인하세요.', updatedAt: iso() };
      snapshot.data.activeIds = snapshot.data.activeIds.filter((item) => item !== parsed.id);
      const archived = await store.read<AutomationJob>(receiptPath(parsed.id));
      return [{ path: jobPath(parsed.id), version: active.version, data: null },
        { path: receiptPath(parsed.id), version: archived?.version || null, data: cancelled }];
    });
  }
  async function enqueue(candidate: KeywordCandidate, retry = false) {
    const parsed = parseAutomationAction({ action: 'enqueue', ...candidate, retry });
    if (parsed.action !== 'enqueue') throw new AutomationInputError('Invalid enqueue.');
    const id = await automationTopicId(parsed.candidate.country, parsed.candidate.keyword);
    await mutate(async (snapshot) => {
      const c = snapshot.data;
      const active = await store.read<AutomationJob>(jobPath(id));
      if (active) return null;
      const archived = await store.read<AutomationJob>(receiptPath(id));
      if (archived && (!retry || archived.data.status === 'verified')) return null;
      if (c.activeIds.length >= AUTOMATION_LIMITS.activeJobs) throw new AutomationInputError('Active queue is full (24).');
      const job: AutomationJob = archived ? { ...archived.data } : { ...parsed.candidate, id, status: 'queued', error: null, href: null, draft: null,
        generationAttempts: 0, publicationAttempts: 0, verificationAttempts: 0, paidAmbiguous: false, generationResult: null, createdAt: iso(), updatedAt: iso() };
      if (job.draft && !job.generationResult?.autoPublishEligible) throw new AutomationInputError('This saved draft requires manual review; retry cannot bypass eligibility.');
      if (!job.draft && job.generationAttempts >= AUTOMATION_LIMITS.generationsPerTopic) throw new AutomationInputError('Topic generation lifetime limit (3) reached.');
      job.status = job.href ? 'published_unverified' : job.draft ? 'publishing' : 'queued';
      job.error = null; job.publicationAttempts = 0; job.verificationAttempts = 0; job.updatedAt = iso();
      c.activeIds.push(id);
      return [{ path: jobPath(id), version: null, data: job }];
    });
    return id;
  }

  async function tick(scheduler = false) {
    let lease: NonNullable<AutomationControl['lease']> | null = null;
    let reason = 'paused';
    await mutate(async (snapshot) => {
      const c = snapshot.data;
      lease = null; c.lastTick = iso();
      if (scheduler) c.schedulerHeartbeat = iso();
      rollDay(c);
      if (!c.enabled) { reason = 'paused'; return []; }
      if (c.lease && Date.parse(c.lease.expiresAt) > now()) { reason = 'busy'; return []; }
      if (c.nextRunAt && Date.parse(c.nextRunAt) > now()) { reason = 'not-due'; return []; }
      c.generation += 1;
      lease = { id: crypto.randomUUID(), generation: c.generation, expiresAt: new Date(now() + AUTOMATION_LIMITS.leaseMs).toISOString() };
      c.lease = lease; c.nextRunAt = new Date(now() + c.intervalMinutes * 60_000).toISOString();
      reason = 'acquired'; return [];
    });
    if (!lease) return { status: reason };
    const held = lease as NonNullable<AutomationControl['lease']>;
    const owns = (c: AutomationControl) => c.generation === held.generation && c.lease?.id === held.id
      && c.lease.generation === held.generation && Date.parse(c.lease.expiresAt) > now();
    async function save(job: AutomationJob, edit?: (c: AutomationControl, job: AutomationJob) => void) {
      let saved: AutomationJob | undefined;
      await mutate(async (snapshot) => {
        const c = snapshot.data;
        if (!owns(c)) throw new AutomationConflict();
        rollDay(c);
        const current = await store.read<AutomationJob>(jobPath(job.id));
        if (!current || current.data.generationAttempts !== job.generationAttempts) throw new AutomationConflict();
        // Retry from the unchanged job; expose edits only after the CAS succeeds.
        const next = structuredClone(job);
        edit?.(c, next); next.updatedAt = iso(); c.lastError = next.error;
        saved = next;
        if (['failed', 'review', 'verified'].includes(next.status)) {
          const archived = await store.read<AutomationJob>(receiptPath(job.id));
          c.activeIds = c.activeIds.filter((id) => id !== job.id);
          return [{ path: jobPath(job.id), version: current.version, data: null }, { path: receiptPath(job.id), version: archived?.version || null, data: next }];
        }
        return [{ path: jobPath(job.id), version: current.version, data: next }];
      });
      if (saved) Object.assign(job, saved);
    }
    async function adopt(job: AutomationJob, generated: GeneratedEditorial) {
      job.draft = generated.draft;
      const { draft: _draft, ...metadata } = generated;
      job.generationResult = metadata; job.paidAmbiguous = false;
      let valid = false;
      try {
        const draft = validateEditorialArticle(generated.draft);
        valid = getCountryRoute(draft.country)?.isoAlpha2 === job.country && normalizeAutomationKeyword(draft.keyword) === job.keyword;
        if (valid) job.draft = draft;
      } catch { /* Invalid drafts are retained for review, never passed to publication. */ }
      await save(job, (c, saved) => {
        const eligible = valid && generated.autoPublishEligible === true && Array.isArray(generated.issues) && generated.issues.length === 0;
        const usage = generated.usage;
        const validUsage = usage && [usage.inputTokens, usage.outputTokens, usage.webSearchCalls].every((n) => Number.isSafeInteger(n) && n >= 0);
        saved.status = eligible && validUsage && c.enabled && c.autoPublish ? 'publishing' : 'review';
        saved.error = saved.status === 'review' ? !valid ? 'Draft validation or topic identity failed; manual review required.'
          : !eligible || !validUsage ? 'Automatic publication blocked by generation policy; inspect saved issues.' : 'Automation paused or autoPublish disabled; draft retained for review.' : null;
        if (validUsage) { c.inputTokens += usage.inputTokens; c.outputTokens += usage.outputTokens; c.webSearchCalls += usage.webSearchCalls; }
      });
    }
    let job: AutomationJob | undefined;
    try {
      let snapshot = await control();
      const active = await Promise.all(snapshot.data.activeIds.map((id) => store.read<AutomationJob>(jobPath(id))));
      if (active.some((item) => !item)) throw new Error('Active job is missing.');
      const priority: AutomationStatus[] = ['published_unverified', 'publishing', 'generating', 'queued'];
      job = active.map((item) => item!.data).sort((a, b) => priority.indexOf(a.status) - priority.indexOf(b.status))[0];
      if (!job) {
        const candidates = (await deps.market(snapshot.data.country, snapshot.data.discoveryMode || 'trends')).slice(0, 100);
        let chosen: KeywordCandidate | undefined;
        const start = snapshot.data.marketCursor;
        let scanned = 0;
        for (; scanned < Math.min(24, candidates.length); scanned++) {
          const candidate = candidates[(start + scanned) % candidates.length];
          const parsed = parseAutomationAction({ action: 'enqueue', ...candidate });
          if (parsed.action !== 'enqueue') continue;
          const id = await automationTopicId(parsed.candidate.country, parsed.candidate.keyword);
          if (!await store.read<AutomationJob>(receiptPath(id)) && !await store.read<AutomationJob>(jobPath(id))) { chosen = parsed.candidate; scanned++; break; }
        }
        await mutate(async (state) => { if (!owns(state.data) || !state.data.enabled) throw new AutomationConflict(); state.data.marketCursor = candidates.length ? (start + scanned) % candidates.length : 0; state.data.lastError = null; return []; });
        if (chosen) { await enqueue(chosen); return { status: 'enqueued' }; }
        return { status: 'no-work', sourceCount: candidates.length };
      }
      if (job.status === 'generating' || job.status === 'queued' && job.generationAttempts > 0) {
        const saved = await store.read<AttemptReceipt>(attemptPath(job.id, job.generationAttempts));
        if (saved) { await adopt(job, saved.data.result); return { status: 'draft-recovered', jobId: job.id }; }
        if (job.status === 'generating') {
          job.status = 'failed'; job.paidAmbiguous = true;
          job.error = 'Generation was interrupted; billing is ambiguous. Explicit enqueue retry:true is required; no automatic regeneration.';
          await save(job); return { status: 'failed', jobId: job.id };
        }
      }
      if (job.status === 'queued') {
        let reserved = false;
        await save(job, (c, saved) => {
          reserved = false;
          if (!c.enabled) throw new AutomationConflict();
          if (c.calls >= c.maxDailyGenerations || c.autoPublish && c.publications >= c.maxDailyArticles) { reason = 'daily-cap'; return; }
          if (saved.generationAttempts >= AUTOMATION_LIMITS.generationsPerTopic) throw new AutomationInputError('Topic generation limit reached.');
          saved.status = 'generating'; saved.generationAttempts++; saved.paidAmbiguous = true;
          c.calls++; reserved = true;
        });
        if (!reserved) return { status: reason, jobId: job.id };
        // Reservation must be acknowledged and still fenced immediately before the paid call.
        snapshot = await control();
        if (!owns(snapshot.data) || !snapshot.data.enabled) return { status: 'paused-before-generation', jobId: job.id };
        const reservedJob = job;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const work = deps.generate({ country: job.country, keyword: job.keyword }).then(async (result) => {
            // Immutable attempt receipt survives pause/lease expiry, but never authorizes publication.
            const path = attemptPath(reservedJob.id, reservedJob.generationAttempts);
            try { await store.commit([{ path, version: null, data: { result, updatedAt: iso() } }]); }
            catch (error) { const existing = await store.read<AttemptReceipt>(path); if (!existing || canonicalEditorialJson(existing.data.result) !== canonicalEditorialJson(result)) throw error; }
            return result;
          });
          const generated = await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Generation timeout.')), AUTOMATION_LIMITS.generationMs); })]);
          await adopt(job, generated);
          return { status: job.status, jobId: job.id };
        } catch (error) {
           if (error instanceof AutomationConflict) throw error;
           job.status = 'failed'; job.paidAmbiguous = true;
           const code = error && typeof error === 'object' && 'code' in error && typeof (error as { code?: unknown }).code === 'string' && /^[A-Z_]+$/.test((error as { code: string }).code)
             ? ` (${(error as { code: string }).code})` : '';
           job.error = `Generation or durable result acknowledgement failed${code}; billing may have occurred. Explicit enqueue retry:true required.`;
           await save(job); return { status: 'failed', jobId: job.id };
        } finally { if (timer) clearTimeout(timer); }
      }
      if (job.status === 'publishing') {
        if (!job.draft || job.generationResult?.autoPublishEligible !== true || job.generationResult.issues.length) {
          job.status = 'review'; job.error = 'Saved draft is not eligible for automatic publication.'; await save(job); return { status: 'review', jobId: job.id };
        }
        const draft = validateEditorialArticle(job.draft);
        if (getCountryRoute(draft.country)?.isoAlpha2 !== job.country || normalizeAutomationKeyword(draft.keyword) !== job.keyword) throw new Error('Draft topic mismatch.');
        snapshot = await control();
        if (!snapshot.data.enabled || !snapshot.data.autoPublish) { job.status = 'review'; job.error = 'Publication paused; draft retained.'; await save(job); return { status: 'review', jobId: job.id }; }
        if (job.publicationAttempts >= AUTOMATION_LIMITS.retries) { job.status = 'failed'; job.error = 'Publication retries exhausted; explicit retry required.'; await save(job); return { status: 'failed', jobId: job.id }; }
        const post = await automationPost(job, deps.uid);
        const path = `posts/${post.id}`;
        const stored = await store.read<Record<string, unknown>>(path);
        if (stored && !matchesAutomationPost(stored.data, post.content)) {
          job.status = 'failed'; job.error = 'Stable article ID contains different content. No post was overwritten.'; await save(job); return { status: 'failed', jobId: job.id };
        }
        let reserved = false;
        await save(job, (c, saved) => {
          reserved = false;
          if (!c.enabled || !c.autoPublish) throw new AutomationConflict();
          if (!stored && c.publications >= c.maxDailyArticles) { reason = 'daily-cap'; return; }
          saved.publicationAttempts++; reserved = true;
        });
        if (!reserved) return { status: reason, jobId: job.id };
        // Control pause/caps/fence and job transition share the very same commit as post creation.
        snapshot = await control(); rollDay(snapshot.data);
        const c = snapshot.data;
        if (!owns(c) || !c.enabled || !c.autoPublish) throw new AutomationConflict();
        if (!stored && c.publications >= c.maxDailyArticles) return { status: 'daily-cap', jobId: job.id };
        const current = await store.read<AutomationJob>(jobPath(job.id));
        if (!current) throw new AutomationConflict();
        job.status = 'published_unverified'; job.href = post.href; job.error = null; job.updatedAt = iso();
        if (!stored) c.publications++;
        c.lastError = null;
        await store.commit([writeControl(snapshot), { path: jobPath(job.id), data: job, version: current.version },
          ...(!stored ? [{ path, version: null, data: { ...post.content, createdAt: iso(), reviewedAt: iso(), views: 0, likes: 0, comments: 0 } }] : [])],
        stored ? [{ path, version: stored.version }] : []);
        return { status: 'published_unverified', jobId: job.id };
      }
      if (job.status === 'published_unverified') {
        if (job.verificationAttempts >= AUTOMATION_LIMITS.retries) { job.status = 'failed'; job.error = 'Public verification retries exhausted; explicit retry required (no regeneration).'; await save(job); return { status: 'failed', jobId: job.id }; }
        await save(job, (_c, saved) => { saved.verificationAttempts++; });
        try {
          const post = await automationPost(job, deps.uid);
          const stored = await store.read<Record<string, unknown>>(`posts/${post.id}`);
          if (!stored || !matchesAutomationPost(stored.data, post.content)) throw new Error('Stored post mismatch.');
          await (deps.verify || verifyAutomationPublicRead)(job);
          job.status = 'verified'; job.error = null;
        } catch {
          job.error = 'Public title/body read verification failed. Saved draft retained; no regeneration.';
          if (job.verificationAttempts >= AUTOMATION_LIMITS.retries) job.status = 'failed';
        }
        await save(job); return { status: job.status, jobId: job.id };
      }
      throw new Error('Unexpected active job status.');
    } catch (error) {
      const message = error instanceof AutomationConflict ? 'State changed or lease expired; stale runner stopped.' : 'Automation step failed; inspect the job and connection. No automatic paid retry.';
      await mutate(async (snapshot) => {
        if (!owns(snapshot.data)) return null;
        snapshot.data.lastError = message;
        if (!job) return [];
        const current = await store.read<AutomationJob>(jobPath(job.id));
        if (!current) return [];
        current.data.error = message; current.data.updatedAt = iso();
        return [{ path: jobPath(job.id), data: current.data, version: current.version }];
      }).catch(() => {});
      return { status: error instanceof AutomationConflict ? 'stopped' : 'error', ...(job ? { jobId: job.id } : {}), error: message };
    } finally {
      await mutate(async (snapshot) => { if (!owns(snapshot.data)) return null; snapshot.data.lease = null; return []; }).catch(() => {});
    }
  }
  return { envelope, configure, pause, cancel, enqueue, tick };
}

export async function automationPost(job: AutomationJob, uid: string) {
  const article = validateEditorialArticle(job.draft);
  const id = `editorial-auto-${job.id}`;
  const content = {
    type: article.category === 'community' ? 'general' : article.category, sourceCategory: article.category,
    country: article.country, topic: article.topic, keyword: article.keyword,
    title: article.title, summary: article.summary, description: article.summary, body: article.body,
    author: OPERATOR_BYLINE, authorId: uid, authorName: OPERATOR_BYLINE,
    editorial: editorialForStorage(article.editorial), seoTitle: article.seoTitle, metaDescription: article.metaDescription, seoTags: article.tags,
    editorialKey: job.id, editorialWorkflow: 'public-service',
    sourceName: [...new Set(article.editorial.sources.map((source) => source.publisher))].join(' \u00b7 '),
    status: 'published', isPublic: true, reviewedBy: AUTOMATION_REVIEWER, automationPolicy: AUTOMATION_POLICY,
    automationTopicId: job.id, automationModel: job.generationResult?.model || 'unknown',
  };
  return { id, href: getContentDetailPath('posts', id, content), content: { ...content, editorialDigest: await editorialDigest(content) } };
}
export function matchesAutomationPost(stored: Record<string, unknown>, projected: Record<string, unknown>) {
  return !stored.deleted && !stored.expiresAt && !stored.sourceSnapshot
    && Object.entries(projected).every(([key, value]) => canonicalEditorialJson(stored[key]) === canonicalEditorialJson(value));
}

// HTTP GET only: the public SSR route has no server view increment. No JS, PostActions or view endpoint is executed.
export async function verifyAutomationPublicRead(job: AutomationJob, fetcher: typeof fetch = fetch): Promise<void> {
  if (!job.draft || !job.href || !/^\/[a-z]{2}\/[a-z-]+\/editorial-auto-[a-f0-9]{64}$/.test(job.href)) throw new Error('Invalid public verification path.');
  const response = await fetcher(`https://gyopo.kr${job.href}`, { cache: 'no-store', redirect: 'manual',
    headers: { accept: 'text/html', 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok || !response.headers.get('content-type')?.includes('text/html') || !response.body) throw new Error('Public article is unavailable.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let html = ''; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 2_000_000) throw new Error('Public response exceeds verification limit.');
      html += decoder.decode(value, { stream: true });
    }
    html += decoder.decode();
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  // Require the real SSR article elements, not metadata, JSON-LD, RSC payloads or a 200 error shell.
  const cleaned = html.replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  const element = cleaned.match(/<article\b[^>]*class=["'][^"']*\bpublic-article\b[^"']*["'][^>]*>([\s\S]*?)<\/article>/i);
  const article = element?.[1] || '';
  const tags = element?.[0].match(/<[^>]*>/g) || [];
  if (tags.some((tag) => /\shidden(?:\s|=|\/?>)|\saria-hidden\s*=\s*["']?true(?:["'\s>])|display\s*:\s*none|visibility\s*:\s*hidden/i.test(tag))) throw new Error('Public article is hidden.');
  const title = article.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const body = article.match(/<div\b[^>]*class=["'][^"']*\bwhitespace-pre-wrap\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1];
  const text = (value: string) => value.replace(/<[^>]*>/g, '').replace(/&(?:amp|lt|gt|quot|apos|#x[0-9a-f]+|#\d+);/gi, (entity) => {
    const named: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
    if (named[entity]) return named[entity];
    const point = entity.startsWith('&#x') ? parseInt(entity.slice(3, -1), 16) : parseInt(entity.slice(2, -1), 10);
    return point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
  }).replace(/\s+/g, ' ').trim();
  if (title === undefined || body === undefined || text(title) !== job.draft.title.replace(/\s+/g, ' ').trim()
    || text(body) !== job.draft.body.replace(/\s+/g, ' ').trim()) throw new Error('Public title/body was not rendered exactly.');
}
