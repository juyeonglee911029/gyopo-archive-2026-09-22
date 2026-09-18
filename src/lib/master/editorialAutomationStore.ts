import { serviceAccountAccessToken, type AdminFirestoreValue } from '../firebaseAdmin';

// These paths are private under the existing default-deny rules. Only server IAM is used.
export const CONTROL_PATH = 'editorialAutomation/control';
export const jobPath = (id: string) => `${CONTROL_PATH}/jobs/${id}`;
export const receiptPath = (id: string) => `${CONTROL_PATH}/receipts/${id}`;
export const attemptPath = (id: string, attempt: number) => `${jobPath(id)}/attempts/${attempt}`;
export type Versioned<T> = { data: T; version: string };
export type AutomationWrite = { path: string; data: object | null; version: string | null };
export type AutomationCheck = { path: string; version: string };
export interface AutomationStore {
  read<T>(path: string): Promise<Versioned<T> | null>;
  commit(writes: AutomationWrite[], checks?: AutomationCheck[]): Promise<void>;
  receipts<T>(limit: number): Promise<T[]>;
}
export class AutomationConflict extends Error {
  constructor() { super('Automation state changed. Read the latest state before retrying.'); }
}
type Document = { name: string; updateTime: string; fields: Record<string, AdminFirestoreValue> };

function encode(value: unknown): AdminFirestoreValue {
  if (value === null) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number' && Number.isFinite(value)) return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
  if (value && typeof value === 'object') return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)])) } };
  throw new Error('Unsupported automation storage value.');
}
function decode(value: AdminFirestoreValue): unknown {
  if ('nullValue' in value) return null;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('stringValue' in value) return value.stringValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decode);
  return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([key, item]) => [key, decode(item)]));
}
function unpack<T>(document: Document, privateRecord: boolean): Versioned<T> {
  if (!document.updateTime || !document.fields) throw new Error('Missing Firestore version.');
  const data = privateRecord
    ? JSON.parse(String(decode(document.fields.payload)))
    : Object.fromEntries(Object.entries(document.fields).map(([key, value]) => [key, decode(value)]));
  return { data: data as T, version: document.updateTime };
}

export function createEditorialAutomationStore(options: {
  projectId: string; fetcher?: typeof fetch; accessToken?: () => Promise<string>;
}): AutomationStore {
  if (!/^[a-z][a-z0-9-]{4,62}$/.test(options.projectId)) throw new Error('Invalid FIREBASE_PROJECT_ID.');
  const root = `projects/${options.projectId}/databases/(default)/documents`;
  const fetcher = options.fetcher || fetch;
  const token = options.accessToken || (() => serviceAccountAccessToken('https://www.googleapis.com/auth/datastore'));
  // Request-scoped token reuse, never user bearer tokens or client rules exceptions.
  let authentication: Promise<string> | undefined;
  function name(path: string) {
    if (!/^(editorialAutomation\/control(?:\/(?:jobs|receipts)\/[a-z0-9-]+(?:\/attempts\/\d+)?)?|posts\/editorial-auto-[a-f0-9]{64})$/.test(path)) throw new Error('Invalid automation path.');
    return `${root}/${path}`;
  }
  async function request(path: string, init: RequestInit = {}) {
    authentication ||= token();
    const response = await fetcher(`https://firestore.googleapis.com/v1/${path}`, {
      ...init, cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(15_000),
      headers: { authorization: `Bearer ${await authentication}`, 'content-type': 'application/json' },
    });
    if (response.status === 409 || response.status === 412) throw new AutomationConflict();
     if (!response.ok && response.status !== 404) throw new Error(`Automation storage unavailable (HTTP ${response.status}).`);
    return response;
  }
  return {
    async read<T>(path: string) {
      const response = await request(name(path));
      return response.status === 404 ? null : unpack<T>(await response.json() as Document, path.startsWith('editorialAutomation/'));
    },
    async receipts<T>(limit: number) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 24) throw new Error('Invalid receipt limit.');
      const response = await request(`${root}/${CONTROL_PATH}/receipts?pageSize=${limit}`);
      if (!response.ok) throw new Error('Automation receipts unavailable.');
      const payload = await response.json() as { documents?: Document[] };
      return (payload.documents || []).sort((a, b) => b.updateTime.localeCompare(a.updateTime)).slice(0, limit)
        .map((document) => unpack<T>(document, true).data);
    },
    async commit(writes: AutomationWrite[], checks: AutomationCheck[] = []) {
      if (!writes.length || writes.length > 8 || !writes.some((write) => write.path === CONTROL_PATH)
        && !(writes.length === 1 && /\/attempts\/\d+$/.test(writes[0].path) && writes[0].version === null)) throw new Error('A control CAS is required.');
      const operations = writes.map((write) => {
        const documentName = name(write.path);
        if (write.path.startsWith('posts/') && (write.version !== null || !write.data)) throw new Error('Posts are create-only.');
        if (!write.data && !write.version) throw new Error('Versioned deletion required.');
        const currentDocument = write.version ? { updateTime: write.version } : { exists: false };
        if (!write.data) return { delete: documentName, currentDocument };
        const fields = write.path.startsWith('editorialAutomation/')
          ? { payload: { stringValue: JSON.stringify(write.data) }, updatedAt: { timestampValue: (write.data as { updatedAt: string }).updatedAt } }
          : Object.fromEntries(Object.entries(write.data).map(([key, value]) => [key, encode(value)]));
        if (JSON.stringify(fields).length > 800_000) throw new Error('Automation record exceeds storage limit.');
        return { update: { name: documentName, fields }, currentDocument };
      });
      let transaction: string | undefined;
      try {
        // Reconciliation reads participate in a transaction: no blind post update or TOCTOU acceptance.
        if (checks.length) {
          const started = await request(`${root}:beginTransaction`, { method: 'POST', body: JSON.stringify({ options: { readWrite: {} } }) });
          transaction = (await started.json() as { transaction: string }).transaction;
          if (!transaction) throw new Error('Missing Firestore transaction.');
          const read = await request(`${root}:batchGet`, { method: 'POST', body: JSON.stringify({ documents: checks.map((check) => name(check.path)), transaction }) });
          const documents = await read.json() as Array<{ found?: Document }>;
          if (!checks.every((check) => documents.some((row) => row.found?.name === name(check.path) && row.found.updateTime === check.version))) throw new AutomationConflict();
        }
        const response = await request(`${root}:commit`, { method: 'POST', body: JSON.stringify({ writes: operations, ...(transaction ? { transaction } : {}) }) });
        if (!response.ok) throw new Error('Automation commit unavailable.');
      } catch (error) {
        if (transaction) await request(`${root}:rollback`, { method: 'POST', body: JSON.stringify({ transaction }) }).catch(() => {});
        throw error;
      }
    },
  };
}
