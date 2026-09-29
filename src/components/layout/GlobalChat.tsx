'use client';

import { useEffect, useRef, useState } from 'react';
import { ImagePlus, MessageCircle, Send, X } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { createDocument, deleteExpiredChatMessages, getSessionToken, queryDocumentsWhere } from '@/lib/firebase';
import { useGlobalStore } from '@/store/useGlobalStore';

type ChatMessage = {
  id: string;
  authorId: string;
  user: string;
  country?: string;
  text: string;
  imageData?: string;
  createdAt: string;
  expiresAt?: string | Date;
};

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

export default function GlobalChat() {
  const { user } = useGlobalStore();
  const language = useGlobalStore((state) => state.language);
  const pathname = usePathname();
  const isCallRoute = pathname === '/webrtc' || pathname === '/apps/random-chat';
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [imageData, setImageData] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const desktopEndRef = useRef<HTMLDivElement>(null);
  const mobileEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    desktopEndRef.current?.scrollIntoView({ block: 'end' });
    mobileEndRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  useEffect(() => {
    let active = true;
    let lastCleanupAt = 0;
    const load = async () => {
      const token = getSessionToken();
      if (token && Date.now() - lastCleanupAt > 30_000) {
        lastCleanupAt = Date.now();
        await deleteExpiredChatMessages(token).catch(() => undefined);
      }
      await Promise.all([
        queryDocumentsWhere<Omit<ChatMessage, 'id'>>('chatMessages', [{ field: 'expiresAt', op: 'GREATER_THAN', value: new Date() }], token, 100)
          .then((nextMessages) => {
            if (!active) return;
            setMessages(nextMessages.filter((message) => message.authorId).filter((message) => !message.expiresAt || new Date(message.expiresAt).getTime() > Date.now()).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()).slice(-100));
          })
          .catch(() => undefined),
      ]);
    };
    void load();
    const interval = window.setInterval(load, 1500);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [user?.id]);

  useEffect(() => {
    if (isCallRoute) {
      setMobileOpen(false);
      return;
    }
    const openChat = () => {
      if (window.matchMedia('(max-width: 1023px)').matches) setMobileOpen(true);
    };
    window.addEventListener('gyopo-open-global-chat', openChat);
    return () => window.removeEventListener('gyopo-open-global-chat', openChat);
  }, [isCallRoute]);

  if (isCallRoute) return null;

  const handleImageSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const scale = Math.min(1, 960 / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
        setImageData(canvas.toDataURL('image/jpeg', .78));
      };
      image.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  };

  const handleSend = async (event: React.FormEvent) => {
    event.preventDefault();
    if ((!input.trim() && !imageData) || !user) return;
    const token = getSessionToken();
    if (!token) return;
    const message = {
      authorId: user.id,
      user: user.name,
      country: 'Global',
      text: input.trim(),
      imageData: imageData || undefined,
      createdAt: new Date().toISOString(),
       expiresAt: new Date(Date.now() + 60 * 1000),
    };
    try {
      const id = crypto.randomUUID();
      await createDocument('chatMessages', id, message, token);
      setMessages((current) => [...current, { ...message, id }].slice(-100));
      setInput('');
      setImageData('');
    } catch {
      window.alert('메시지를 보내지 못했습니다. 다시 시도해주세요.');
    }
  };

  return (
    <>
       <aside id="global-lounge" aria-label={language === 'ko' ? '실시간 라운지' : 'Live Lounge'} className="global-lounge fixed bottom-4 right-4 top-24 z-[240] hidden w-[20rem] flex-col overflow-hidden border border-cyan-200/15 bg-[#0a1120]/46 shadow-[0_24px_90px_rgba(0,0,0,.35)] backdrop-blur-xl lg:flex">
           <div className="global-lounge-header border-b border-white/8 bg-[#0d1628]/45 p-4">
             <div className="global-lounge-heading"><div className="flex items-center gap-2 font-black text-white"><MessageCircle size={17} className="text-teal-300" /> {language === 'ko' ? '실시간 라운지' : 'Live Lounge'}</div><p className="mt-1 text-[11px] text-slate-500">{language === 'ko' ? '지역에 관계없이 연결된 교민들' : 'Connect with the global Korean community'}</p></div>
            </div>

           <div className="global-lounge-messages flex-1 space-y-2 overflow-y-auto p-3">
            {messages.length === 0 && <div className="lounge-empty-mark" aria-hidden="true"><MessageCircle size={18} /></div>}
           {messages.map((message) => (
              <div key={message.id} className={`global-chat-message-bubble text-[13px] leading-5 ${message.authorId === user?.id ? 'global-chat-own' : 'global-chat-other'}`} title={message.country || 'Global'}>
                <div className="global-chat-line">
                  <span className="global-chat-author">{message.user || '교민'}:</span>
                  {message.text && <span className="global-chat-text">{message.text}</span>}
                  <time className="global-chat-time" dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>
                </div>
                {message.imageData && <a href={message.imageData} target="_blank" rel="noreferrer" className="mt-1 block overflow-hidden"><img src={message.imageData} alt="채팅 첨부 이미지" loading="lazy" className="max-h-64 w-full object-contain" /></a>}
              </div>
            ))}
           <div ref={desktopEndRef} />
      </div>

          <div className="global-lounge-composer border-t border-white/8 bg-[#0d1628]/45 p-3">
         {user ? (
           <form onSubmit={handleSend} className="space-y-2">
             {imageData && <div className="relative w-fit overflow-hidden rounded-lg border border-white/10"><img src={imageData} alt="첨부 미리보기" className="h-16 w-24 object-cover" /><button type="button" onClick={() => setImageData('')} aria-label="사진 첨부 취소" className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-black/70 text-white"><X size={11} /></button></div>}
             <div className="relative flex gap-2">
              <input
                type="text"
                value={input}
               onChange={(event) => setInput(event.target.value)}
                placeholder={language === 'ko' ? '메시지를 입력하세요...' : 'Write a message...'}
                 className="min-w-0 flex-1 border border-white/10 bg-white/5 py-2 pl-3 pr-3 text-sm text-white outline-none transition-all placeholder:text-slate-600 focus:border-teal-300/50 focus:ring-2 focus:ring-teal-300/20"
              />
              <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageSelect} className="hidden" />
              <button type="button" onClick={() => fileInputRef.current?.click()} aria-label="사진 첨부" title="사진 첨부" className="grid h-9 w-9 shrink-0 place-items-center border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"><ImagePlus size={16} /></button>
              <button type="submit" aria-label="메시지 보내기" className="flex h-9 w-9 shrink-0 items-center justify-center bg-teal-300 text-slate-950 transition-colors hover:bg-teal-200">
                <Send size={14} />
              </button>
             </div>
           </form>
        ) : (
             <div className="border border-white/8 bg-white/5 p-3 text-center text-sm font-medium text-slate-500">{language === 'ko' ? '로그인 후 채팅에 참여하세요.' : 'Log in to join the chat.'}</div>
         )}
       </div>
     </aside>
        <div className="global-mobile-lounge fixed bottom-3 left-3 right-3 z-40 lg:hidden">
          {mobileOpen && <div id="global-mobile-lounge-panel" role="region" aria-label={language === 'ko' ? '실시간 라운지' : 'Live Lounge'} className="global-mobile-lounge-panel mb-2 overflow-hidden border border-white/10 bg-white/10 shadow-2xl backdrop-blur-xl dark:border-white/10 dark:bg-[#10182b]/48">
          <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
            <span className="text-xs font-black text-white">{language === 'ko' ? '실시간 라운지' : 'Live Lounge'}</span>
            <button type="button" onClick={() => setMobileOpen(false)} aria-label={language === 'ko' ? '라운지 닫기' : 'Close lounge'} className="grid h-8 w-8 place-items-center text-slate-300 hover:bg-white/10"><X size={15} /></button>
          </div>
          <div className="flex max-h-56 flex-col gap-2 overflow-y-auto p-3">
            {messages.length === 0 && <div className="lounge-empty-mark" aria-hidden="true"><MessageCircle size={16} /></div>}
              {messages.slice(-8).map((message) => <div key={message.id} className={`global-chat-message-bubble p-2 text-xs ${message.authorId === user?.id ? 'global-chat-own' : 'global-chat-other'}`} title={message.country || 'Global'}><div className="global-chat-line"><span className="global-chat-author">{message.user || '교민'}:</span>{message.text && <span className="global-chat-text">{message.text}</span>}<time className="global-chat-time" dateTime={message.createdAt}>{formatTime(message.createdAt)}</time></div>{message.imageData && <img src={message.imageData} alt="채팅 첨부 이미지" loading="lazy" className="mt-2 max-h-40 w-full object-contain" />}</div>)}
             <div ref={mobileEndRef} />
         </div>
         {user ? <form onSubmit={handleSend} className="flex gap-2 border-t border-slate-200 p-2 dark:border-white/10"><input value={input} onChange={(event) => setInput(event.target.value)} placeholder="라운지에 메시지..." className="min-w-0 flex-1 border border-slate-200 bg-slate-50 px-3 py-2 text-xs outline-none dark:border-white/10 dark:bg-black/20" /><button type="button" onClick={() => fileInputRef.current?.click()} aria-label="사진 첨부" className="grid h-8 w-8 shrink-0 place-items-center bg-slate-800 text-white"><ImagePlus size={14} /></button><button className="bg-blue-600 px-3 text-xs font-black text-white">전송</button></form> : <p className="border-t border-slate-200 p-3 text-center text-xs text-slate-500 dark:border-white/10">로그인 후 채팅에 참여하세요.</p>}
        </div>}
     </div>
    </>
  );
}
