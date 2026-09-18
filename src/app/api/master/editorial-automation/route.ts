import { requireMasterUser, unauthorizedResponse, FIREBASE_PROJECT_ID } from '@/lib/apiSecurity';
import { AutomationConflict, createEditorialAutomationStore } from '@/lib/master/editorialAutomationStore';
import { AutomationInputError, automationSetup, createEditorialAutomation, defaultAutomationControl, parseAutomationAction } from '@/lib/master/editorialAutomation';
import { loadEditorialCandidates } from '@/lib/master/editorialCandidates';
import { generateOpenAIEditorial } from '@/lib/master/openaiEditorial';

export const runtime = 'edge';

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'cache-control': 'no-store, private', 'pragma': 'no-cache' } });

async function schedulerAuthentication(request: Request) {
  const supplied = request.headers.get('x-editorial-automation-secret');
  if (supplied === null) return false;
  const expected = process.env.EDITORIAL_AUTOMATION_SECRET;
  if (!expected || expected.length < 32 || expected.length > 256 || supplied.length > 256) throw new Error('Invalid scheduler authentication.');
  // WebCrypto performs the MAC comparison, not a short-circuit string equality or JavaScript loop.
  const bytes = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', bytes.encode(expected), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  const signature = await crypto.subtle.sign('HMAC', key, bytes.encode(expected));
  if (!await crypto.subtle.verify('HMAC', key, signature, bytes.encode(supplied))) throw new Error('Invalid scheduler authentication.');
  return true;
}

function automation() {
  const uid = process.env.EDITORIAL_AUTOMATION_UID || '';
  if (!uid || !process.env.FIREBASE_SERVICE_ACCOUNT_JSON) return null;
  return createEditorialAutomation({
    uid, store: createEditorialAutomationStore({ projectId: process.env.FIREBASE_PROJECT_ID || FIREBASE_PROJECT_ID }),
    generate: generateOpenAIEditorial,
    market: async (country, mode) => {
      const feed = await loadEditorialCandidates(country, mode);
      return feed.rows.map(({ country, keyword, source }) => ({ country, keyword, source }));
    },
  });
}
async function envelope(runner: ReturnType<typeof automation>) {
  const result = runner ? await runner.envelope() : { control: defaultAutomationControl(process.env.EDITORIAL_AUTOMATION_UID || '', Date.now()), jobs: [], setup: [] as string[] };
  result.setup = automationSetup(result.control, process.env);
  return result;
}

export async function GET(request: Request) {
  try { await requireMasterUser(request); } catch (error) { return unauthorizedResponse(error); }
  if (new URL(request.url).search) return json({ error: 'Query parameters are not supported; never send secrets in URLs.' }, 400);
  try { return json(await envelope(automation())); }
  catch { return json({ error: 'Automation storage unavailable. No state was changed.' }, 503); }
}

export async function POST(request: Request) {
  let scheduler = false;
  try {
    scheduler = await schedulerAuthentication(request);
    if (!scheduler) await requireMasterUser(request);
  } catch (error) { return unauthorizedResponse(error); }
  if (new URL(request.url).search) return json({ error: 'Query parameters are not supported; never send secrets in URLs.' }, 400);
  let action: ReturnType<typeof parseAutomationAction>;
  try {
    if (Number(request.headers.get('content-length')) > 4096) return json({ error: 'Request exceeds 4KB.' }, 413);
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > 4096) return json({ error: 'Request exceeds 4KB.' }, 413);
    action = parseAutomationAction(JSON.parse(raw));
    if (scheduler && action.action !== 'tick') return json({ error: 'Scheduler authentication permits tick only.' }, 403);
  } catch (error) { return json({ error: error instanceof AutomationInputError ? error.message : 'Invalid JSON request.' }, 400); }
  try {
    const runner = automation();
    if (!runner) return json({ ...await envelope(null), error: 'Server IAM storage and fixed EDITORIAL_AUTOMATION_UID must be configured.' }, 503);
    if (action.action === 'configure') await runner.configure(action.config);
    if (action.action === 'pause') await runner.pause();
    if (action.action === 'cancel') await runner.cancel(action.id);
    if (action.action === 'enqueue') await runner.enqueue(action.candidate, action.retry);
    const result = action.action === 'tick' ? await runner.tick(scheduler) : undefined;
    return json({ ...await envelope(runner), ...(result ? { result } : {}) });
  } catch (error) {
    return json({ error: error instanceof AutomationInputError || error instanceof AutomationConflict ? error.message : 'Automation storage unavailable; read state before retrying. Never retry an ambiguous paid generation automatically.' },
      error instanceof AutomationInputError ? 400 : error instanceof AutomationConflict ? 409 : 503);
  }
}
