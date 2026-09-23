'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  BriefcaseBusiness,
  Building2,
  Check,
  Compass,
  ExternalLink,
  History,
  LoaderCircle,
  LogIn,
  MessageCircle,
  Search,
  Send,
  Sparkles,
  TriangleAlert,
} from 'lucide-react';
import { getSessionToken } from '@/lib/firebase';
import { useGlobalStore } from '@/store/useGlobalStore';
import { useEffectEvent } from '@/lib/useeffectevent';

type AssistantSearchMatch = { id: string; href: string; title: string; snippet: string; category: string; region: string; city?: string };
type Message = { id: string; role: 'user' | 'assistant'; content: string; matches?: AssistantSearchMatch[] };
type NoticeKind = 'auth' | 'provider' | 'error';
type Notice = { kind: NoticeKind; title: string; detail: string };
type AssistantResponse = { answer?: unknown; error?: unknown; matches?: unknown };

const HISTORY_KEY = 'gyopo-assistant-history';
const STORAGE_EVENT = 'gyopo-assistant-storage';
let historyFallback: string | null = null;

function subscribeBrowserState(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === HISTORY_KEY || event.key === null) historyFallback = null;
    onChange();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener('focus', onChange);
  window.addEventListener(STORAGE_EVENT, onChange);
  const unsubscribe = useGlobalStore.subscribe(onChange);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener('focus', onChange);
    window.removeEventListener(STORAGE_EVENT, onChange);
    unsubscribe();
  };
}

function getSessionSnapshot() {
  return getSessionToken() || '';
}

function getHistorySnapshot() {
  if (historyFallback !== null) return historyFallback;
  try {
    return window.localStorage.getItem(HISTORY_KEY) || '[]';
  } catch {
    return '[]';
  }
}

function parseHistory(value: string): string[] {
  try {
    const saved: unknown = JSON.parse(value);
    return Array.isArray(saved) ? saved.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, 6) : [];
  } catch {
    return [];
  }
}

const SUGGESTIONS = [
  { label: '해외 생활 가이드', prompt: '처음 해외에 정착할 때 꼭 확인해야 할 생활 준비를 단계별로 알려줘.', icon: Compass },
  { label: '일자리 찾기', prompt: '해외에서 한인 일자리를 찾을 때 확인할 점과 GYOPO에서 찾아볼 곳을 알려줘.', icon: BriefcaseBusiness },
  { label: '지역 정보 비교', prompt: '내게 맞는 해외 거주 지역을 비교할 때 어떤 기준으로 살펴보면 좋을까?', icon: Building2 },
  { label: '오늘의 질문', prompt: '최근 해외 생활을 시작한 사람에게 도움이 되는 현실적인 팁 5가지를 알려줘.', icon: BookOpen },
] as const;

const PORTAL_LINKS = [
  { href: '/regions', label: '지역 둘러보기', detail: '국가·도시별 정보', icon: Compass },
  { href: '/jobs', label: '구인구직', detail: '글로벌 일자리', icon: BriefcaseBusiness },
  { href: '/directory', label: '업소록', detail: '한인 업체 찾기', icon: Building2 },
  { href: '/community', label: '커뮤니티', detail: '교민 이야기', icon: MessageCircle },
] as const;

function makeMessageId(role: Message['role']): string {
  return `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function responseText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseMatches(value: unknown): AssistantSearchMatch[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const match = item as Record<string, unknown>;
    if (typeof match.id !== 'string' || typeof match.href !== 'string' || !match.href.startsWith('/') || typeof match.title !== 'string' || typeof match.snippet !== 'string' || typeof match.category !== 'string' || typeof match.region !== 'string') return [];
    return [{ id: match.id, href: match.href, title: match.title, snippet: match.snippet, category: match.category, region: match.region, city: typeof match.city === 'string' ? match.city : undefined }];
  }).slice(0, 5);
}

function SearchMatches({ matches }: { matches: AssistantSearchMatch[] }) {
  if (!matches.length) return null;
  return (
    <section className="mt-4 border-t border-white/10 pt-4" aria-label="GYOPO 내부 검색 결과">
      <div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-[.16em] text-cyan-200"><BookOpen size={12} /> GYOPO 내부 검색 결과</div>
      <div className="grid gap-2">
        {matches.map((match) => (
          <Link key={`${match.id}-${match.href}`} href={match.href} className="group block rounded-xl bg-slate-950/35 px-3 py-2.5 ring-1 ring-white/10 transition hover:bg-teal-300/[.08] hover:ring-teal-200/30">
            <div className="flex items-start gap-2"><span className="min-w-0 flex-1 text-xs font-black text-slate-100 group-hover:text-teal-100">{match.title}</span><ExternalLink size={13} className="mt-0.5 shrink-0 text-slate-600 group-hover:text-teal-200" /></div>
            <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-slate-500">{match.category} · {match.region}{match.city ? ` · ${match.city}` : ''} · {match.snippet}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}

function UrlQuestion({ loading, onQuestion }: { loading: boolean; onQuestion: (question: string) => void }) {
  const urlQuery = useSearchParams().get('q')?.trim() || '';
  const queryHandledRef = useRef('');
  const submitUrlQuestion = useEffectEvent(onQuestion);
  useEffect(() => {
    if (!urlQuery) {
      queryHandledRef.current = '';
      return;
    }
    if (loading || queryHandledRef.current === urlQuery) return;
    queryHandledRef.current = urlQuery;
    submitUrlQuestion(urlQuery);
  }, [loading, urlQuery]);
  return null;
}

function AssistantExperience() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const sessionToken = useSyncExternalStore(subscribeBrowserState, getSessionSnapshot, () => null);
  const history = useSyncExternalStore(subscribeBrowserState, getHistorySnapshot, () => '[]');
  const recentQueries = parseHistory(history);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [rejectedToken, setRejectedToken] = useState<string | null>(null);
  const [lastQuestion, setLastQuestion] = useState('');
  const selectedCountry = useGlobalStore((state) => state.selectedCountry);
  const authState = sessionToken === null ? 'checking' : sessionToken && sessionToken !== rejectedToken ? 'signed-in' : 'signed-out';

  const rememberQuestion = (question: string) => {
    const next = JSON.stringify([question, ...parseHistory(getHistorySnapshot()).filter((item) => item !== question)].slice(0, 6));
    try {
      window.localStorage.setItem(HISTORY_KEY, next);
      historyFallback = null;
    } catch {
      // Keep recent questions usable even when storage is blocked or full.
      historyFallback = next;
    }
    window.dispatchEvent(new Event(STORAGE_EVENT));
  };

  const askQuestion = async (question: string) => {
    const trimmed = question.trim();
    if (!trimmed || loading) return;

    const token = getSessionToken();
    window.dispatchEvent(new Event(STORAGE_EVENT));
    if (!token) {
      setNotice({
        kind: 'auth',
        title: '로그인이 필요합니다.',
        detail: 'GYOPO AI는 인증된 회원에게만 답변을 제공합니다. 로그인한 뒤 다시 질문해주세요.',
      });
      return;
    }

    setRejectedToken(null);
    setNotice(null);
    setLastQuestion(trimmed);
    const userMessage: Message = { id: makeMessageId('user'), role: 'user', content: trimmed };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput('');
    setLoading(true);

    try {
      const response = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
         body: JSON.stringify({ messages: nextMessages.map(({ role, content }) => ({ role, content })), region: selectedCountry }),
       });
       const data = await response.json().catch(() => ({})) as AssistantResponse;
       const serverError = responseText(data.error);
       const matches = parseMatches(data.matches);

       if (!response.ok) {
         if (matches.length) setMessages((current) => [...current, { id: makeMessageId('assistant'), role: 'assistant', content: 'GYOPO 내부에서 관련 글을 먼저 찾았습니다.', matches }]);
         if (response.status === 401) {
          setRejectedToken(token);
          setNotice({ kind: 'auth', title: '로그인 세션을 확인해주세요.', detail: serverError || '로그인 후 다시 시도해주세요.' });
        } else if (response.status === 503) {
          setNotice({ kind: 'provider', title: 'AI 답변 서비스를 준비 중입니다.', detail: serverError || '현재 연결된 AI 제공자가 없습니다. 잠시 후 다시 시도해주세요.' });
        } else if (response.status === 429) {
          setNotice({ kind: 'error', title: '잠시 쉬었다가 다시 시도해주세요.', detail: serverError || '요청이 잠시 제한되었습니다.' });
        } else {
          setNotice({ kind: 'error', title: '답변을 불러오지 못했습니다.', detail: serverError || '잠시 후 같은 질문을 다시 시도해주세요.' });
        }
        return;
      }

      const answer = responseText(data.answer);
      if (!answer) {
        setNotice({ kind: 'error', title: '답변을 받지 못했습니다.', detail: 'AI 제공자가 빈 답변을 보냈습니다. 잠시 후 다시 시도해주세요.' });
        return;
      }
       setMessages((current) => [...current, { id: makeMessageId('assistant'), role: 'assistant', content: answer, matches }]);
      rememberQuestion(trimmed);
    } catch {
      setNotice({
        kind: 'error',
        title: 'AI 서비스에 연결하지 못했습니다.',
        detail: '네트워크 상태를 확인하고 다시 시도해주세요.',
      });
    } finally {
      setLoading(false);
    }
  };

  const submitQuestion = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void askQuestion(input);
  };

  const clearConversation = () => {
    if (loading) return;
    setMessages([]);
    setNotice(null);
    setInput('');
    setLastQuestion('');
  };

  const statusLabel = authState === 'signed-in' ? '로그인됨' : authState === 'checking' ? '확인 중' : '로그인 필요';

  return (
    <div className="category-page assistant-page relative min-h-[calc(100dvh-4rem)] overflow-hidden bg-[radial-gradient(circle_at_75%_0%,rgba(45,212,191,.14),transparent_28%),radial-gradient(circle_at_10%_40%,rgba(56,189,248,.1),transparent_30%)] text-slate-100">
      <div className="category-shell relative mx-auto flex min-h-[calc(100dvh-4rem)] max-w-[1440px] flex-col px-4 pb-10 pt-5 sm:px-6 lg:px-10">
        <header className="category-header" aria-label="AI 검색 헤더">
          <div className="category-heading">
              <p className="font-display text-[10px] font-black uppercase tracking-[.25em] text-cyan-300">ASK · FIND · MOVE</p>
              <h1 className="mt-3 text-3xl font-black leading-tight tracking-[-.04em] text-white">필요한 답을,<br /><span className="text-teal-200">다음 행동까지.</span></h1>
              <p className="mt-4 text-sm leading-6 text-slate-400">지역 생활정보부터 학습, 여행, 업무까지 한국어로 질문해보세요. 답변이 필요한 만큼 충분히 설명해드립니다.</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-2 text-[10px] font-black ${authState === 'signed-in' ? 'bg-emerald-300/10 text-emerald-200' : 'bg-white/[.06] text-slate-400'}`}><span className={`h-1.5 w-1.5 ${authState === 'signed-in' ? 'bg-emerald-300' : 'bg-slate-500'}`} />{statusLabel}</span>
            <Link href="/" className="inline-flex items-center gap-1.5 px-2.5 py-2 text-xs font-black text-slate-300 transition hover:bg-white/[.07] hover:text-white"><ArrowLeft size={14} /> 포털 홈</Link>
          </div>
        </header>

        <div className="assistant-workspace grid flex-1 gap-8 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-12">
          <aside className="flex flex-col" aria-label="GYOPO AI 안내와 포털 이동">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center bg-gradient-to-br from-teal-300 to-cyan-300 text-slate-950 shadow-[0_0_28px_rgba(45,212,191,.25)]" aria-hidden="true"><Sparkles size={19} /></span>
              <div>
                <p className="font-display text-[10px] font-black uppercase tracking-[.25em] text-teal-200">GYOPO SMART SEARCH</p>
                <p className="mt-1 text-xs text-slate-400">교민 생활과 일반 질문을 위한 AI 도우미</p>
              </div>
            </div>

            <nav className="mt-8" aria-label="포털 바로가기">
              <p className="mb-3 text-[10px] font-black uppercase tracking-[.2em] text-slate-500">Portal areas</p>
              <div className="grid gap-1">
                {PORTAL_LINKS.map(({ href, label, detail, icon: Icon }) => (
                  <Link key={href} href={href} className="group flex items-center gap-3 px-2 py-2.5 transition hover:bg-white/[.06]">
                    <span className="grid h-8 w-8 shrink-0 place-items-center bg-white/[.06] text-slate-400 transition group-hover:bg-teal-300/10 group-hover:text-teal-200"><Icon size={15} /></span>
                    <span className="min-w-0 flex-1"><b className="block text-xs font-black text-slate-200">{label}</b><small className="mt-0.5 block text-[10px] text-slate-500">{detail}</small></span>
                    <ArrowRight size={13} className="text-slate-600 transition group-hover:translate-x-0.5 group-hover:text-teal-200" />
                  </Link>
                ))}
              </div>
            </nav>

            <section className="mt-8 pt-6 ring-1 ring-white/10 ring-inset" aria-labelledby="recent-questions-heading">
              <div className="flex items-center gap-2 px-2"><History size={14} className="text-cyan-200" /><h2 id="recent-questions-heading" className="text-[10px] font-black uppercase tracking-[.2em] text-slate-400">최근 질문</h2></div>
              {recentQueries.length > 0 ? (
                <ul className="mt-3 grid gap-1">
                  {recentQueries.map((query) => <li key={query}><button type="button" onClick={() => setInput(query)} className="flex w-full items-start gap-2 px-2 py-2 text-left text-xs leading-5 text-slate-500 transition hover:bg-white/[.05] hover:text-slate-200"><ClockIcon /><span className="line-clamp-2">{query}</span></button></li>)}
                </ul>
              ) : <p className="mt-3 px-2 text-xs leading-5 text-slate-600">질문을 보내면 최근 질문이 여기에 표시됩니다.</p>}
            </section>
          </aside>

          <main className="flex min-w-0 flex-col" aria-labelledby="assistant-heading">
            {messages.length === 0 ? (
              <section className="flex flex-1 flex-col justify-center py-4 lg:min-h-[32rem]" aria-labelledby="assistant-heading">
                <div className="max-w-3xl">
                  <span className="inline-flex items-center gap-2 bg-teal-300/10 px-3 py-2 text-[10px] font-black uppercase tracking-[.18em] text-teal-200"><Sparkles size={13} /> AI 생활 검색</span>
                  <h2 id="assistant-heading" className="mt-5 max-w-2xl text-4xl font-black leading-[1.05] tracking-[-.06em] text-white sm:text-6xl">무엇을 도와드릴까요?</h2>
                  <p className="mt-5 max-w-xl text-sm leading-7 text-slate-400 sm:text-base">질문을 한 문장으로 적어보세요. GYOPO AI가 핵심 답변과 현실적인 다음 단계를 함께 정리합니다.</p>
                </div>
                <div className="mt-10 grid max-w-4xl gap-2 sm:grid-cols-2" aria-label="추천 질문">
                  {SUGGESTIONS.map(({ label, prompt, icon: Icon }) => <button key={label} type="button" onClick={() => { setInput(prompt); void askQuestion(prompt); }} className="group flex min-w-0 items-center gap-3 bg-white/[.045] px-4 py-4 text-left ring-1 ring-white/10 transition hover:bg-teal-300/[.08] hover:ring-teal-200/30"><span className="grid h-9 w-9 shrink-0 place-items-center bg-white/[.07] text-teal-200 group-hover:bg-teal-300/10"><Icon size={17} /></span><span className="min-w-0 flex-1"><b className="block text-sm font-black text-slate-200">{label}</b><small className="mt-1 block truncate text-xs text-slate-500">{prompt}</small></span><ArrowRight size={15} className="shrink-0 text-slate-600 transition group-hover:translate-x-1 group-hover:text-teal-200" /></button>)}
                </div>
              </section>
            ) : (
              <section className="flex min-h-[32rem] flex-1 flex-col" aria-labelledby="assistant-heading">
                <div className="flex items-end justify-between gap-3 pb-4 ring-1 ring-white/10 ring-inset">
                  <div><p className="font-display text-[10px] font-black uppercase tracking-[.2em] text-cyan-300">Conversation</p><h2 id="assistant-heading" className="mt-1 text-2xl font-black tracking-tight text-white">대화 기록</h2></div>
                  <button type="button" onClick={clearConversation} disabled={loading} className="px-2 py-2 text-xs font-bold text-slate-500 transition hover:bg-white/[.06] hover:text-white disabled:cursor-not-allowed disabled:opacity-40">새 질문</button>
                </div>
                <ol className="min-h-0 flex-1 space-y-5 overflow-y-auto py-6" aria-label="GYOPO AI 대화 기록" aria-live="polite">
                   {messages.map((message) => <li key={message.id} className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}><div className={`max-w-[min(760px,92%)] ${message.role === 'user' ? 'bg-teal-300 px-4 py-3 text-slate-950' : 'bg-white/[.06] px-4 py-3 text-slate-200 ring-1 ring-white/10'}`}><div className={`mb-1 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[.14em] ${message.role === 'user' ? 'text-slate-700' : 'text-teal-200'}`}><span>{message.role === 'user' ? '나' : 'GYOPO AI'}</span>{message.role === 'assistant' && <Check size={12} />}</div><p className="whitespace-pre-wrap text-sm leading-7">{message.content}</p>{message.matches && <SearchMatches matches={message.matches} />}</div></li>)}
                  {loading && <li className="flex items-center gap-3" aria-label="GYOPO AI가 답변을 작성하는 중"><span className="grid h-8 w-8 place-items-center bg-teal-300/10 text-teal-200"><Sparkles size={14} /></span><div className="flex items-center gap-2 bg-white/[.06] px-4 py-3 text-xs text-slate-400 ring-1 ring-white/10"><LoaderCircle size={14} className="animate-spin text-teal-200" />답변을 정리하고 있습니다...</div></li>}
                </ol>
              </section>
            )}

            {notice && <div className={`mt-5 flex items-start gap-3 px-4 py-4 text-sm ring-1 ${notice.kind === 'auth' ? 'bg-cyan-300/[.08] text-cyan-50 ring-cyan-200/20' : notice.kind === 'provider' ? 'bg-amber-300/[.08] text-amber-50 ring-amber-200/20' : 'bg-rose-300/[.08] text-rose-50 ring-rose-200/20'}`} role="alert"><span className="mt-0.5 shrink-0">{notice.kind === 'auth' ? <LogIn size={17} /> : <TriangleAlert size={17} />}</span><div className="min-w-0 flex-1"><p className="font-black">{notice.title}</p><p className="mt-1 text-xs leading-5 opacity-80">{notice.detail}</p><div className="mt-3 flex flex-wrap gap-3">{notice.kind === 'auth' && <Link href="/login" className="inline-flex items-center gap-1.5 text-xs font-black underline underline-offset-4">로그인하러 가기 <ExternalLink size={12} /></Link>}{notice.kind === 'provider' && <Link href="/help" className="inline-flex items-center gap-1.5 text-xs font-black underline underline-offset-4">도움말 보기 <ExternalLink size={12} /></Link>}{notice.kind === 'error' && lastQuestion && <button type="button" onClick={() => void askQuestion(lastQuestion)} className="text-xs font-black underline underline-offset-4">다시 시도</button>}</div></div></div>}

            <form onSubmit={submitQuestion} className="mt-5 flex items-end gap-2 bg-slate-950/55 p-2 ring-1 ring-teal-200/20 shadow-[0_18px_60px_rgba(2,8,23,.3)]" aria-label="GYOPO AI 질문 보내기" aria-busy={loading}>
              <label htmlFor="assistant-question" className="sr-only">GYOPO AI에게 질문하기</label>
              <Search size={19} className="mb-3 ml-2 shrink-0 text-teal-200" aria-hidden="true" />
              <textarea id="assistant-question" value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} disabled={loading} maxLength={4000} rows={1} placeholder="무엇이든 한국어로 질문하세요" className="min-h-12 min-w-0 flex-1 resize-none bg-transparent px-1 py-3 text-sm text-white outline-none placeholder:text-slate-500 disabled:opacity-60" />
              <button type="submit" disabled={loading || !input.trim()} className="inline-flex h-12 shrink-0 items-center gap-2 bg-teal-300 px-4 text-xs font-black text-slate-950 transition hover:bg-teal-200 disabled:cursor-not-allowed disabled:opacity-35" aria-label={loading ? '답변을 기다리는 중' : '질문 보내기'}>{loading ? <LoaderCircle size={16} className="animate-spin" /> : <Send size={16} />}<span className="hidden sm:inline">보내기</span></button>
            </form>
            <p className="mt-3 text-center text-[10px] leading-5 text-slate-600">AI 답변은 참고용 정보입니다. 법률·의료·금융처럼 중요한 결정은 공식 기관이나 전문가의 확인이 필요합니다.</p>
          </main>
        </div>
        <Suspense fallback={null}><UrlQuestion loading={loading} onQuestion={(question) => { setInput(question); void askQuestion(question); }} /></Suspense>
      </div>
    </div>
  );
}

export default function AssistantPage() {
  return <AssistantExperience />;
}

function ClockIcon() {
  return <span className="mt-1 h-1.5 w-1.5 shrink-0 bg-slate-600" aria-hidden="true" />;
}
