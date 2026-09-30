'use client';

import { useEffect, useState } from 'react';
import { Download, Smartphone } from 'lucide-react';

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

export default function PwaInstallButton() {
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [showInstructions, setShowInstructions] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches
      || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
    setIsInstalled(standalone);
    setIsIos(/iphone|ipad|ipod/i.test(navigator.userAgent) && !standalone);

    const onInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const onInstalled = () => {
      setIsInstalled(true);
      setInstallPrompt(null);
      setShowInstructions(false);
    };

    window.addEventListener('beforeinstallprompt', onInstallPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onInstallPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const install = async () => {
    if (!installPrompt) {
      setShowInstructions((shown) => !shown);
      return;
    }
    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === 'accepted') setIsInstalled(true);
    } catch {
      setShowInstructions(true);
    } finally {
      setInstallPrompt(null);
    }
  };

  return <section className="mt-7 rounded-3xl border border-cyan-200/15 bg-cyan-200/[.045] p-5 sm:flex sm:items-center sm:justify-between sm:gap-5">
    <div className="flex items-start gap-3">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-cyan-200/10 text-cyan-100"><Smartphone size={20} aria-hidden="true" /></span>
      <div>
        <p className="text-xs font-black uppercase tracking-[.2em] text-cyan-200">GYOPO App</p>
        <h2 className="mt-1 text-lg font-black text-white">홈 화면에서 앱처럼 사용</h2>
        <p className="mt-1 max-w-xl text-sm leading-6 text-slate-400">설치하면 별도 창과 아이콘으로 열립니다. 네트워크가 끊기면 공개 홈 화면의 마지막 사본만 표시합니다.</p>
      </div>
    </div>
    <button type="button" onClick={() => void install()} disabled={isInstalled} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-100/20 bg-cyan-100/10 px-4 py-3 text-sm font-black text-cyan-50 transition hover:bg-cyan-100/15 disabled:cursor-default disabled:opacity-60 sm:mt-0 sm:w-auto">
      <Download size={16} aria-hidden="true" />{isInstalled ? '이미 설치됨' : installPrompt ? 'GYOPO 설치' : '설치 방법'}
    </button>
    {showInstructions && <div className="mt-4 basis-full rounded-2xl border border-white/10 bg-slate-950/40 p-4 text-sm leading-6 text-slate-300 sm:mt-4">
      {isIos
        ? <p><strong className="text-white">iPhone/iPad:</strong> Safari의 공유 버튼을 누른 다음 <strong className="text-white">홈 화면에 추가</strong>를 선택하세요.</p>
        : <p><strong className="text-white">Android/데스크톱:</strong> Chrome 주소 표시줄의 설치 아이콘 또는 브라우저 메뉴에서 <strong className="text-white">GYOPO 설치</strong>를 선택하세요.</p>}
    </div>}
  </section>;
}
