'use client';

import { type FormEvent, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from 'react';
import { GripHorizontal, Minus, Send, Sparkles, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { getFreshSessionToken } from '@/lib/firebase';
import { useGlobalStore } from '@/store/useGlobalStore';

type AssistantSearchMatch = { id: string; href: string; title: string; snippet: string; category: string; region: string; city?: string };
type Message = { role: 'user' | 'assistant'; content: string; matches?: AssistantSearchMatch[] };
type DockPosition = { left: number; top: number };

const POSITION_KEY = 'gyopo-assistant-dock-position';
const INITIAL_MESSAGE: Message = { role: 'assistant', content: '안녕하세요. GYOPO AI입니다. 국가별 생활정보부터 일반적인 질문까지 도와드릴게요.' };

function parseMatches(value: unknown): AssistantSearchMatch[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const match = item as Record<string, unknown>;
    if (typeof match.id !== 'string' || typeof match.href !== 'string' || !match.href.startsWith('/') || typeof match.title !== 'string' || typeof match.snippet !== 'string' || typeof match.category !== 'string' || typeof match.region !== 'string') return [];
    return [{ id: match.id, href: match.href, title: match.title, snippet: match.snippet, category: match.category, region: match.region, city: typeof match.city === 'string' ? match.city : undefined }];
  }).slice(0, 5);
}

export default function AssistantDock() {
  const pathname = usePathname();
  const isSearchPage = pathname === '/assistant' || pathname === '/apps/ai-search' || pathname === '/search';
  const panelRef = useRef<HTMLElement>(null);
  const dragRef = useRef<{ offsetX: number; offsetY: number; width: number; height: number } | null>(null);
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [position, setPosition] = useState<DockPosition | null>(null);
  const [messages, setMessages] = useState<Message[]>([INITIAL_MESSAGE]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const selectedCountry = useGlobalStore((state) => state.selectedCountry);

  const askQuestion = useCallback(async (question: string) => {
    const trimmed = question.trim();
    if (!trimmed || loading) return;
    const next = [...messages, { role: 'user' as const, content: trimmed }];
    setMessages(next);
    setInput('');
    setLoading(true);
    try {
      const token = await getFreshSessionToken();
      if (!token) {
        setMessages((current) => [...current, { role: 'assistant', content: 'AI 답변을 받으려면 먼저 로그인해주세요.' }]);
        return;
      }
      const response = await fetch('/api/assistant', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ messages: next, region: selectedCountry }) });
      const data = await response.json() as { answer?: string; error?: string; matches?: unknown };
      const matches = parseMatches(data.matches);
      setMessages((current) => [...current, { role: 'assistant', content: data.answer || data.error || '답변을 가져오지 못했습니다.', matches }]);
    } catch {
      setMessages((current) => [...current, { role: 'assistant', content: 'AI 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.' }]);
    } finally {
      setLoading(false);
    }
  }, [loading, messages, selectedCountry]);

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(POSITION_KEY) || 'null') as DockPosition | null;
      if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) setPosition(saved);
    } catch {
      setPosition(null);
    }
  }, []);

  useEffect(() => {
    if (isSearchPage) {
      setOpen(false);
      setMinimized(false);
    }
  }, [isSearchPage]);

  useEffect(() => {
    if (isSearchPage) return;
    const openAssistant = () => {
      setOpen((value) => !value);
      setMinimized(false);
    };
    const openAssistantWithQuery = (event: Event) => {
      const query = (event as CustomEvent<{ query?: string }>).detail?.query?.trim();
      setOpen(true);
      setMinimized(false);
       if (query) {
         setInput(query);
         void askQuestion(query);
       }
    };
    window.addEventListener('gyopo-assistant-open', openAssistant);
    window.addEventListener('gyopo-assistant-query', openAssistantWithQuery);
    return () => {
      window.removeEventListener('gyopo-assistant-open', openAssistant);
      window.removeEventListener('gyopo-assistant-query', openAssistantWithQuery);
    };
  }, [isSearchPage, askQuestion]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const closeOnOutsideClick = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || (target as HTMLElement).closest('.assistant-dock-tab')) return;
      setOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      document.removeEventListener('pointerdown', closeOnOutsideClick);
    };
  }, [open]);

  const positionStyle = position ? { left: position.left, top: position.top } : undefined;

  const startDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest('button, input, textarea')) return;
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    dragRef.current = { offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top, width: rect.width, height: rect.height };
    setPosition({ left: rect.left, top: rect.top });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    setPosition({
      left: Math.max(8, Math.min(window.innerWidth - drag.width - 8, event.clientX - drag.offsetX)),
      top: Math.max(72, Math.min(window.innerHeight - drag.height - 8, event.clientY - drag.offsetY)),
    });
  };

  const stopDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (drag) {
      const nextPosition = {
        left: Math.max(8, Math.min(window.innerWidth - drag.width - 8, event.clientX - drag.offsetX)),
        top: Math.max(72, Math.min(window.innerHeight - drag.height - 8, event.clientY - drag.offsetY)),
      };
      setPosition(nextPosition);
      window.localStorage.setItem(POSITION_KEY, JSON.stringify(nextPosition));
    }
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const ask = (event: FormEvent) => {
    event.preventDefault();
    void askQuestion(input);
  };

  if (!open || isSearchPage) return null;

  if (minimized) {
    return <button type="button" className="assistant-dock-tab" style={positionStyle} onClick={() => setMinimized(false)} aria-label="GYOPO AI 다시 열기"><Sparkles size={14} /><span>AI</span></button>;
  }

  return (
    <aside ref={panelRef} className="assistant-dock" style={positionStyle} aria-label="GYOPO AI">
      <header className="assistant-dock-header" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={stopDrag} onPointerCancel={stopDrag}>
        <div className="assistant-dock-title"><span className="assistant-dock-mark"><Sparkles size={14} /></span><span>GYOPO AI</span><GripHorizontal size={15} className="assistant-dock-grip" /></div>
        <div className="assistant-dock-actions"><button type="button" onClick={() => setMinimized(true)} aria-label="AI 최소화"><Minus size={15} /></button><button type="button" onClick={() => setOpen(false)} aria-label="AI 닫기"><X size={15} /></button></div>
      </header>
      <div className="assistant-dock-messages">
         {messages.map((message, index) => <div key={`${message.role}-${index}`} className={`assistant-dock-message ${message.role === 'user' ? 'assistant-dock-message-user' : ''}`}><p>{message.content}</p>{message.matches && message.matches.length > 0 && <div className="mt-3 grid gap-2 border-t border-white/10 pt-3"><p className="text-[10px] font-black uppercase tracking-[.14em] text-cyan-200">GYOPO 내부 검색 결과</p>{message.matches.map((match) => <Link key={`${match.id}-${match.href}`} href={match.href} className="block rounded-lg bg-slate-950/25 px-2.5 py-2 text-left ring-1 ring-white/10 transition hover:bg-teal-300/10"><b className="block truncate text-[11px] text-slate-100">{match.title}</b><small className="mt-1 block line-clamp-2 text-[10px] leading-4 text-slate-500">{match.category} · {match.region}{match.city ? ` · ${match.city}` : ''} · {match.snippet}</small></Link>)}</div>}</div>)}
        {loading && <div className="assistant-dock-loading"><span /> <span /> <span /></div>}
      </div>
      <form onSubmit={ask} className="assistant-dock-form"><input value={input} onChange={(event) => setInput(event.target.value)} disabled={loading} placeholder="무엇이든 질문하세요" aria-label="AI 질문" /><button type="submit" disabled={loading || !input.trim()} aria-label="AI 질문 보내기"><Send size={15} /></button></form>
    </aside>
  );
}
