import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowUpRight, Bot, Gamepad2, Headphones, MessageCircle, Video } from 'lucide-react';
import { pageMetadata } from '@/lib/seo';

export const metadata: Metadata = pageMetadata('GYOPO 앱 디렉터리', 'GYOPO의 AI 검색, 랜덤 화상채팅, 테트리스, 음악과 라이브 앱을 한곳에서 시작하세요.', '/apps');

const apps = [
  { href: '/apps/ai-search', label: 'AI 생활 검색', english: 'AI Search', detail: '해외 생활 정보를 질문하고 필요한 다음 행동을 찾습니다.', icon: Bot, tone: 'text-cyan-200 bg-cyan-300/10' },
  { href: '/apps/random-chat', label: '랜덤 화상채팅', english: 'Random Video', detail: '안전 운영 기준을 지키며 다른 교민과 1:1로 연결합니다.', icon: Video, tone: 'text-emerald-200 bg-emerald-300/10' },
  { href: '/games', label: '테트리스 아레나', english: 'Tetris Arena', detail: '설치 없이 방을 만들고 실시간으로 대결합니다.', icon: Gamepad2, tone: 'text-amber-200 bg-amber-300/10' },
  { href: '/music', label: 'Music Video', english: 'Music', detail: 'YouTube 뮤직비디오를 검색하고 즐겨찾기합니다.', icon: Headphones, tone: 'text-rose-200 bg-rose-300/10' },
  { href: '/webrtc', label: '라이브 영상', english: 'Live Video', detail: '친구·교민과 영상으로 대화하고 연결합니다.', icon: MessageCircle, tone: 'text-violet-200 bg-violet-300/10' },
  { href: '/theater', label: 'GYOPO 라이브', english: 'Live Room', detail: '라이브 룸과 방송 콘텐츠를 둘러봅니다.', icon: Video, tone: 'text-sky-200 bg-sky-300/10' },
];

export default function AppsPage() {
  return (
    <div className="category-page mx-auto max-w-7xl px-4 py-8 text-slate-100 sm:px-6 lg:px-8"><header className="category-header"><div className="category-heading"><p className="text-xs font-black uppercase tracking-[.22em] text-violet-300">Tools for connection / 앱</p><h1 className="mt-3 text-4xl font-black tracking-tight text-white sm:text-5xl">필요한 기능을 바로 실행하세요</h1><p className="mt-4 text-sm leading-7 text-slate-300">생활 정보를 찾고, 사람을 만나고, 게임과 음악을 즐기는 GYOPO의 연결 도구입니다.</p></div></header><main className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{apps.map(({ href, label, english, detail, icon: Icon, tone }) => <Link key={href} href={href} className="group rounded-3xl border border-white/10 bg-white/[.045] p-6 transition hover:-translate-y-0.5 hover:border-violet-300/30 hover:bg-white/[.075]"><div className="flex items-start justify-between"><span className={`flex h-11 w-11 items-center justify-center rounded-2xl ${tone}`}><Icon size={20} /></span><ArrowUpRight size={18} className="text-slate-600 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-teal-300" /></div><h2 className="mt-6 text-xl font-black text-white">{label}<span className="ml-2 text-xs font-semibold text-slate-500">{english}</span></h2><p className="mt-2 text-sm leading-6 text-slate-400">{detail}</p></Link>)}</main></div>
  );
}
