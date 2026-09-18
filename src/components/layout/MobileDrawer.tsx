'use client';

import Link from 'next/link';
import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { usePathname } from 'next/navigation';
import { LogIn, LogOut, MessageCircle, UserRound, WalletCards, X } from 'lucide-react';
import { isMasterUser, signOut } from '@/lib/firebase';
import { useGlobalStore } from '@/store/useGlobalStore';
import GlobalSidebar from './GlobalSidebar';
import { TranslateMenu } from './Header.legacy';

export default function MobileDrawer({ id, open, onOpenChange }: { id: string; open: boolean; onOpenChange: Dispatch<SetStateAction<boolean>> }) {
  const pathname = usePathname();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const user = useGlobalStore((state) => state.user);
  const setUser = useGlobalStore((state) => state.setUser);
  const close = () => onOpenChange(false);

  useEffect(() => { onOpenChange(false); }, [pathname, onOpenChange]);

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1024px)');
    const closeOnDesktop = () => { if (desktop.matches) onOpenChange(false); };
    desktop.addEventListener('change', closeOnDesktop);
    return () => desktop.removeEventListener('change', closeOnDesktop);
  }, [onOpenChange]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const previousOverscroll = document.body.style.overscrollBehavior;
    document.body.style.overflow = 'hidden';
    document.body.style.overscrollBehavior = 'none';
    if (!dialog.open) dialog.showModal();
    dialog.querySelector<HTMLButtonElement>('[data-drawer-close]')?.focus();
    return () => {
      if (dialog.open) dialog.close();
      document.body.style.overflow = previousOverflow;
      document.body.style.overscrollBehavior = previousOverscroll;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open]);

  return <dialog id={id} ref={dialogRef} hidden={!open} className="mobile-drawer" aria-label="GYOPO 전체 메뉴" onCancel={close} onClose={close} onClick={(event) => {
    if (event.target === event.currentTarget) close();
  }}>
    <button type="button" tabIndex={-1} className="drawer-backdrop" aria-label="메뉴 닫기" onClick={close} />
    <div className="mobile-drawer-panel" onTouchStart={(event) => {
      touchStart.current = null;
      if (event.touches.length !== 1 || (event.target instanceof Element && event.target.closest('input, select, textarea'))) return;
      touchStart.current = { x: event.touches[0].clientX, y: event.touches[0].clientY };
    }} onTouchEnd={(event) => {
      const start = touchStart.current;
      touchStart.current = null;
      const touch = event.changedTouches[0];
      if (!start || !touch) return;
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      if (dx < -64 && Math.abs(dy) < Math.abs(dx) * 0.65) close();
    }} onTouchCancel={() => { touchStart.current = null; }}>
      <div className="mobile-drawer-header"><Link href="/" onClick={close}>GYOPO</Link><button type="button" data-drawer-close aria-label="메뉴 닫기" onClick={close}><X size={22} aria-hidden="true" /></button></div>
      <section className="mobile-drawer-account" aria-label="내 계정">
        {user ? <>
          <div className="mobile-drawer-profile"><img src={user.image} alt="" width={36} height={36} /><span>{user.name || 'GYOPO 회원'}</span></div>
          <Link href="/users" onClick={close}><UserRound size={18} aria-hidden="true" />MY / 회원</Link>
          <Link href="/wallet" onClick={close}><WalletCards size={18} aria-hidden="true" />서비스 잔액</Link>
          <button type="button" onClick={() => { close(); window.dispatchEvent(new Event('gyopo-profile-edit')); }}><UserRound size={18} aria-hidden="true" />프로필 편집</button>
          {isMasterUser(user) && <Link href="/master" onClick={close}>MASTER</Link>}
          <button type="button" onClick={() => { signOut(); setUser(null); close(); }}><LogOut size={18} aria-hidden="true" />로그아웃</button>
        </> : <Link href="/login" onClick={close}><LogIn size={18} aria-hidden="true" />로그인</Link>}
        <button type="button" onClick={() => { close(); window.dispatchEvent(new Event('gyopo-friends-open')); }}><MessageCircle size={18} aria-hidden="true" />친구 채팅·통화</button>
        <TranslateMenu />
      </section>
      <GlobalSidebar onNavigate={close} />
    </div>
  </dialog>;
}
