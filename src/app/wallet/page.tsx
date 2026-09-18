'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useGlobalStore } from '@/store/useGlobalStore';
import { createDocument, getDocument, getFreshSessionToken, isMasterUser, MASTER_DEPOSIT_ADDRESS, queryDocuments, queryDocumentsWhere, refreshStoredUser, saveProfile, sendUserTransfer, USDT_NETWORK, type WalletLedgerEntry } from '@/lib/firebase';
import { isValidTronAddress, sendUsdtWithTronLink } from '@/lib/tron';
import { Wallet, Copy, History, Send, AlertCircle, Download, LockKeyhole, ShieldCheck, Sparkles } from 'lucide-react';

const configuredDepositAddress = process.env.NEXT_PUBLIC_USDT_DEPOSIT_ADDRESS || MASTER_DEPOSIT_ADDRESS;

type LedgerRow = WalletLedgerEntry & { id: string };

function formatUsdt(value: number, maximumFractionDigits = 6) {
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits });
}

function formatUsd(value: number) {
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function hashPin(pin: string, salt = ''): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${pin}`));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function csvCell(value: unknown): string {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

export default function WalletPage() {
  const { user, setUser, addTransaction, transactions } = useGlobalStore();
  const [activeTab, setActiveTab] = useState<'DEPOSIT' | 'WITHDRAWAL' | 'P2P' | 'ONCHAIN'>('DEPOSIT');
  
  // Forms state
  const [amount, setAmount] = useState('');
  const [targetId, setTargetId] = useState('');
  const [depositAddress, setDepositAddress] = useState(configuredDepositAddress);
  const [userSearch, setUserSearch] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ id: string; name: string; image?: string; country?: string }>>([]);
  const [selectedRecipient, setSelectedRecipient] = useState<{ id: string; name: string; image?: string; country?: string } | null>(null);
  const [searchMessage, setSearchMessage] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [chainBalance, setChainBalance] = useState<number | null>(null);
  const [chainSyncedAt, setChainSyncedAt] = useState<string>('');
  const [chainError, setChainError] = useState('');
  const [chainLoading, setChainLoading] = useState(false);
  const [chainAddress, setChainAddress] = useState('');
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledgerError, setLedgerError] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [requestPin, setRequestPin] = useState('');
  const [onchainTarget, setOnchainTarget] = useState('');
  const [onchainAmount, setOnchainAmount] = useState('');
  const [onchainPin, setOnchainPin] = useState('');
  const [isOnchainSending, setIsOnchainSending] = useState(false);
  const [usdTopupAmount, setUsdTopupAmount] = useState('10');
  const [usdTopupBusy, setUsdTopupBusy] = useState(false);
  const [usdTopupMessage, setUsdTopupMessage] = useState('');
  const [paddleTransactionId, setPaddleTransactionId] = useState('');

  const confirmPaddleTransaction = async (transactionId: string, claimKey: string) => {
    setUsdTopupMessage('카드 결제를 확인하고 USD 잔액에 반영하는 중입니다...');
    try {
      const token = await getFreshSessionToken();
      if (!token) throw new Error('로그인 세션이 만료되었습니다. 로그인 화면에서 Google 계정을 다시 선택해주세요.');
      const response = await fetch('/api/paddle/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ transactionId }),
      });
      const result = await response.json().catch(() => ({})) as { amountUsd?: number; status?: string; error?: string };
      if (!response.ok && response.status !== 202) throw new Error(result.error || '결제 확인에 실패했습니다.');
      if (result.status && result.status !== 'completed') {
        window.sessionStorage.removeItem(claimKey);
        setUsdTopupMessage('결제 확인이 아직 진행 중입니다. 잠시 후 아래 버튼으로 다시 확인하세요.');
        return;
      }
      const refreshed = await refreshStoredUser().catch(() => null);
      if (refreshed) setUser(refreshed);
      setPaddleTransactionId('');
      setUsdTopupMessage(`${formatUsd(Number(result.amountUsd || 0))} USD가 서비스 잔액에 반영되었습니다.`);
      window.history.replaceState({}, '', '/wallet');
    } catch (error) {
      window.sessionStorage.removeItem(claimKey);
      setUsdTopupMessage(error instanceof Error ? `${error.message} 아래 버튼으로 다시 확인하세요.` : '결제 확인에 실패했습니다. 아래 버튼으로 다시 확인하세요.');
    }
  };

  useEffect(() => {
    if (!user) return;
    const params = new URLSearchParams(window.location.search);
    const transactionId = params.get('_ptxn') || params.get('transaction_id') || params.get('transactionId');
    if (!transactionId) return;
    const claimKey = `gyopo-paddle-claim:${transactionId}`;
    setPaddleTransactionId(transactionId);
    if (window.sessionStorage.getItem(claimKey)) return;
    window.sessionStorage.setItem(claimKey, '1');
    void confirmPaddleTransaction(transactionId, claimKey);
  }, [user?.id, setUser]);

  useEffect(() => {
    void getFreshSessionToken().then((token) => {
      if (!token) return null;
      return getDocument<{ depositAddress?: string; network?: string }>('adminSettings', 'wallet', token);
    }).then((settings) => {
        if (!settings) return;
        if (settings?.depositAddress) setDepositAddress(settings.depositAddress);
      });
  }, []);

  useEffect(() => {
    if (!user) return;
    let active = true;
    const address = user.walletAddress?.trim() || (isMasterUser(user) ? MASTER_DEPOSIT_ADDRESS : '');
    setChainAddress(address);
    if (!address) {
      setChainBalance(null);
      setChainError('Wallet 생성 후 실제 TRON 체인 잔고가 표시됩니다.');
      return () => { active = false; };
    }
    const loadChainBalance = async () => {
      setChainLoading(true);
      try {
         const token = await getFreshSessionToken();
         if (!token) throw new Error('로그인 세션이 만료되었습니다. 로그인 화면에서 Google 계정을 다시 선택해주세요.');
         const response = await fetch(`/api/tron/balance?address=${encodeURIComponent(address)}`, { cache: 'no-store', headers: { authorization: `Bearer ${token}` } });
        const result = await response.json() as { balance?: number; syncedAt?: string; error?: string };
        if (!response.ok) throw new Error(result.error || 'TRON 잔고를 읽지 못했습니다.');
        if (active) {
          setChainBalance(typeof result.balance === 'number' ? result.balance : 0);
          setChainSyncedAt(result.syncedAt || new Date().toISOString());
          setChainError('');
        }
      } catch (error) {
        if (active) setChainError(error instanceof Error ? error.message : 'TRON 잔고를 읽지 못했습니다.');
      } finally {
        if (active) setChainLoading(false);
      }
    };
    void loadChainBalance();
    const timer = window.setInterval(() => void loadChainBalance(), 15_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [user?.id, user?.walletAddress]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    const loadLedger = async () => {
      setLedgerLoading(true);
      try {
         const token = await getFreshSessionToken();
         if (!token) throw new Error('로그인 세션이 만료되었습니다. 로그인 화면에서 Google 계정을 다시 선택해주세요.');
         const rows = await queryDocumentsWhere<WalletLedgerEntry>('walletLedger', [{ field: 'userId', op: 'EQUAL', value: user.id }], token, 200);
        if (active) {
          setLedger(rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))));
          setLedgerError('');
        }
      } catch (error) {
        if (active) setLedgerError(error instanceof Error ? error.message : '거래 원장을 불러오지 못했습니다.');
      } finally {
        if (active) setLedgerLoading(false);
      }
    };
    void loadLedger();
    const timer = window.setInterval(() => void loadLedger(), 15_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [user?.id]);

  if (!user) {
    return (
      <div className="container mx-auto px-4 py-20 text-center">
        <h2 className="text-2xl font-bold mb-4">로그인이 필요합니다.</h2>
        <Link href="/login" className="text-blue-600 underline">로그인 페이지로 이동</Link>
      </div>
    );
  }

  const beginUsdTopup = async () => {
    const value = Math.round(Number(usdTopupAmount) * 100) / 100;
    if (!Number.isFinite(value) || value < 0.1 || value > 1_000) {
      setUsdTopupMessage('충전 금액은 0.10 USD 이상 1,000 USD 이하로 입력해주세요.');
      return;
    }
    const token = await getFreshSessionToken();
    if (!token) {
      setUsdTopupMessage('로그인 세션이 만료되었습니다. 다시 로그인해주세요.');
      return;
    }
    setUsdTopupBusy(true);
    setUsdTopupMessage('안전한 카드 결제창을 준비하는 중입니다...');
    try {
      const response = await fetch('/api/paddle/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ amount: value }),
      });
      const result = await response.json().catch(() => ({})) as { checkoutUrl?: string; error?: string };
      if (!response.ok || !result.checkoutUrl) throw new Error(result.error || '카드 결제창을 열지 못했습니다.');
      window.location.assign(result.checkoutUrl);
    } catch (error) {
      setUsdTopupMessage(error instanceof Error ? error.message : '카드 결제창을 열지 못했습니다.');
    } finally {
      setUsdTopupBusy(false);
    }
  };

  const verifyPin = async (value: string) => {
    if (!/^\d{4}$/.test(value)) {
      alert('4자리 숫자 PIN을 입력해주세요.');
      return false;
    }
    if (!user.walletPinHash) {
      alert('먼저 지갑 보안 PIN을 설정해주세요.');
      return false;
    }
    const storedHash = user.walletPinSalt ? await hashPin(value, user.walletPinSalt) : await hashPin(value);
    return storedHash === user.walletPinHash;
  };

  const saveWalletPin = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!/^\d{4}$/.test(newPin) || newPin !== confirmPin) {
      alert('PIN은 서로 같은 4자리 숫자여야 합니다.');
      return;
    }
    try {
      const walletPinSalt = crypto.randomUUID();
      const nextUser = { ...user, walletPinHash: await hashPin(newPin, walletPinSalt), walletPinSalt };
      const token = await getFreshSessionToken();
      if (!token) throw new Error('로그인 세션이 만료되었습니다. 로그인 화면에서 Google 계정을 다시 선택해주세요.');
      await saveProfile(nextUser, token);
      setUser(nextUser);
      setNewPin('');
      setConfirmPin('');
      alert('지갑 보안 PIN을 저장했습니다. 실제 송금은 TronLink 서명이 추가로 필요합니다.');
    } catch (error) {
      alert(error instanceof Error ? error.message : 'PIN을 저장하지 못했습니다.');
    }
  };

  const requestWalletGeneration = () => {
    alert('자동 Wallet 생성은 개인키를 안전하게 보관할 서버가 연결된 뒤 활성화됩니다. 현재는 보안상 주소만 임의로 만들거나 저장하지 않습니다.');
  };

  const handleDeposit = async () => {
    const val = Number(amount);
    if (isNaN(val) || val <= 0) return alert("올바른 금액을 입력하세요.");
    if (!depositAddress.trim()) return alert('관리자가 입금 지갑을 설정하지 않았습니다.');
    const token = await getFreshSessionToken();
    if (!token) return alert('로그인 세션이 만료되었습니다. 다시 로그인해주세요.');
    try {
      await createDocument('depositRequests', crypto.randomUUID(), {
        userId: user.id,
        amount: val,
         network: USDT_NETWORK,
        depositAddress: depositAddress.trim(),
        status: 'PENDING',
        createdAt: new Date(),
      }, token);
      addTransaction({ type: 'DEPOSIT', amount: val, status: 'PENDING', details: 'USDT 입금 확인 대기' });
      alert(`[시스템] ${val} USDT 입금 신청이 접수되었습니다. 실제 입금 확인 후 잔고에 반영됩니다.`);
    } catch {
      alert('입금 신청을 저장하지 못했습니다. 잠시 후 다시 시도해주세요.');
      return;
    }
    setAmount('');
  };

  const handleWithdrawal = async () => {
    const val = Number(amount);
    if (isNaN(val) || val <= 0) return alert("올바른 금액을 입력하세요.");
    if (user.usdtBalance < val + 9) return alert(`잔고가 부족합니다. (수수료 9 USDT 포함 ${val + 9} USDT 필요)`);
    const token = await getFreshSessionToken();
    if (!token || !targetId.trim()) return alert('출금 주소를 입력하세요.');
    if (!(await verifyPin(requestPin))) return alert('PIN이 올바르지 않습니다.');
     await createDocument('withdrawalRequests', crypto.randomUUID(), { userId: user.id, amount: val, fee: 9, targetAddress: targetId.trim(), network: USDT_NETWORK, status: 'PENDING', createdAt: new Date() }, token);
     addTransaction({ type: 'WITHDRAWAL', amount: val, status: 'PENDING', details: `승인 대기 · ${targetId.trim()}` });
     alert(`[시스템] ${val} USDT 출금 신청이 접수되었습니다. 운영자 승인 후 처리됩니다.`);
     setAmount('');
     setTargetId('');
     setRequestPin('');
  };

  const searchUsers = async () => {
    const token = await getFreshSessionToken();
    const value = userSearch.trim().toLocaleLowerCase('ko-KR');
    if (!token) return setSearchMessage('로그인 세션이 만료되었습니다.');
    if (!value) {
      setSearchResults([]);
      setSearchMessage('검색할 회원 이름을 입력해주세요.');
      return;
    }
    setIsSearching(true);
    setSearchMessage('회원 명단을 검색하는 중...');
    try {
      const rows = await queryDocuments<{ name: string; image?: string; country?: string }>('publicProfiles', 'isPublic', true, token);
      const results = rows
        .filter((row) => row.id !== user.id)
        .filter((row) => (row.name || '').toLocaleLowerCase('ko-KR').includes(value))
        .sort((a, b) => a.name.localeCompare(b.name, 'ko-KR'))
        .slice(0, 20);
      setSearchResults(results);
      setSearchMessage(results.length ? `${results.length}명의 회원을 찾았습니다.` : '검색어와 일치하는 등록 회원이 없습니다.');
    } catch (error) {
      setSearchResults([]);
      setSearchMessage(error instanceof Error ? `회원 검색 실패: ${error.message.slice(0, 120)}` : '회원 검색에 실패했습니다.');
    } finally {
      setIsSearching(false);
    }
  };

  const handleP2P = async () => {
    const val = Number(amount);
    if (isNaN(val) || val <= 0) return alert("올바른 금액을 입력하세요.");
    if (!targetId) return alert("받는 사람을 선택하세요.");
    if (user.usdtBalance < val + 9) return alert(`잔고가 부족합니다. (수수료 9 USDT 포함 ${val + 9} USDT 필요)`);

    const token = await getFreshSessionToken();
    if (!token) return alert('로그인 세션이 만료되었습니다.');
    if (!(await verifyPin(requestPin))) return alert('PIN이 올바르지 않습니다.');
    setIsSending(true);
    try {
      await sendUserTransfer(user.id, targetId, val, 9, token, { kind: 'P2P', memo: `회원 간 즉시 송금 · ${selectedRecipient?.name || targetId}` });
      setUser({ ...user, usdtBalance: user.usdtBalance - val - 9 });
      addTransaction({ type: 'P2P_SEND', amount: val, status: 'COMPLETED', details: `회원 간 즉시 송금 완료 · ${selectedRecipient?.name || targetId}` });
      alert(`[완료] ${selectedRecipient?.name || '회원'}에게 ${val} USDT를 즉시 보냈습니다. 운영자 승인 없이 회원 권한으로 처리되었습니다.`);
      setAmount('');
      setTargetId('');
      setUserSearch('');
      setSelectedRecipient(null);
       setSearchResults([]);
       setSearchMessage('');
       setRequestPin('');
    } catch (error) {
      alert(error instanceof Error ? `송금 실패: ${error.message.slice(0, 160)}` : '송금에 실패했습니다. 다시 시도해주세요.');
    } finally {
      setIsSending(false);
    }
  };

  const handleOnchainSend = async () => {
    const val = Number(onchainAmount);
    if (!user.walletAddress) return alert('먼저 TronLink 지갑을 연결하고 프로필에 저장해주세요.');
    if (!isValidTronAddress(onchainTarget)) return alert('받는 지갑 주소가 올바르지 않습니다.');
    if (!Number.isFinite(val) || val <= 0) return alert('송금 금액이 올바르지 않습니다.');
    if (!(await verifyPin(onchainPin))) return alert('PIN이 올바르지 않습니다.');
    setIsOnchainSending(true);
    try {
      const sent = await sendUsdtWithTronLink(onchainTarget.trim(), val, user.walletAddress);
      addTransaction({ type: 'WITHDRAWAL', amount: val, status: 'PENDING', details: `TRON 송금 제출 · ${sent.txHash}` });
      setOnchainAmount('');
      setOnchainTarget('');
      setOnchainPin('');
      alert(`송금 서명이 완료되었습니다.\n트랜잭션: ${sent.txHash}`);
    } catch (error) {
      alert(error instanceof Error ? error.message : '실제 USDT 송금에 실패했습니다.');
    } finally {
      setIsOnchainSending(false);
    }
  };

  const exportLedger = () => {
    const rows: Array<{ createdAt: string | Date; type: string; direction: string; amount: number; fee?: number; status: string; network?: string; txHash?: string; fromAddress?: string; toAddress?: string; memo?: string }> = ledger.length ? ledger : transactions.map((item) => ({ userId: user.id, type: item.type, direction: item.type === 'DEPOSIT' ? 'IN' : 'OUT', amount: item.amount, status: item.status, memo: item.details, createdAt: item.date, id: item.id }));
    const header = ['일시', '유형', '방향', '금액', '수수료', '상태', '네트워크', 'TXID', '보내는 주소', '받는 주소', '메모'];
    const body = rows.map((row) => [row.createdAt, row.type, row.direction, row.amount, row.fee || 0, row.status, row.network || '', row.txHash || '', row.fromAddress || '', row.toAddress || '', row.memo || ''].map(csvCell).join(','));
    const blob = new Blob([`\ufeff${[header.map(csvCell).join(','), ...body].join('\n')}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `gyopo-wallet-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const serviceRows = ledger.filter((row) => row.network === 'Paddle' || row.memo?.includes('서비스'));

  return (
    <div className="category-page wallet-page mx-auto w-full max-w-5xl px-4 py-8 text-slate-100 sm:px-6">
      <header className="category-header category-header-workspace mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="category-heading"><p className="text-xs font-black uppercase tracking-[.2em] text-cyan-300">Service balance</p><h1 className="mt-1 flex items-center gap-3 text-3xl font-black"><Wallet size={28} className="text-cyan-300" /> 서비스 잔액</h1><p className="mt-2 text-sm text-slate-400">결제와 서비스 이용에 사용하는 잔액을 한 곳에서 관리합니다.</p></div>
        <Link href="/wallet/history" className="inline-flex items-center gap-1.5 border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-xs font-black text-cyan-100 hover:bg-cyan-300/20"><History size={14} /> 거래 내역</Link>
      </header>

      <section className="wallet-service-card mb-6 grid gap-6 p-6 sm:p-8 md:grid-cols-[1fr_auto] md:items-center">
        <div><p className="text-xs font-bold uppercase tracking-[.18em] text-slate-400">현재 잔액</p><strong className="mt-2 block text-5xl font-black tracking-tight text-cyan-200">${formatUsd(Number(user.usdBalance || 0))}</strong><p className="mt-3 max-w-xl text-xs leading-5 text-slate-400">이 잔액은 GYOPO 내부 서비스 결제에 사용할 수 있습니다. 모든 결제와 충전 기록은 거래 내역에서 확인할 수 있습니다.</p></div>
        <div className="flex items-center gap-2 text-xs font-bold text-emerald-200"><LockKeyhole size={16} /> 안전한 서비스 잔액</div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,.9fr)_minmax(0,1.1fr)]">
        <section className="wallet-service-panel p-5 sm:p-6">
          <div className="flex items-center gap-2 text-sm font-black text-white"><Wallet size={18} className="text-cyan-300" /> 잔액 충전</div>
          <p className="mt-2 text-xs leading-5 text-slate-400">카드 결제가 완료되면 승인된 금액만 서비스 잔액에 반영됩니다.</p>
          <div className="mt-4 flex flex-wrap gap-2">{[1, 5, 10, 25].map((value) => <button type="button" key={value} onClick={() => setUsdTopupAmount(String(value))} className="border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-xs font-black text-cyan-100 hover:bg-cyan-300/20">${value}</button>)}</div>
          <div className="mt-3 flex gap-2"><input type="number" min="0.1" max="1000" step="0.01" value={usdTopupAmount} onChange={(event) => setUsdTopupAmount(event.target.value)} className="min-w-0 flex-1 border border-white/10 bg-white/[.06] px-3 py-3 text-sm font-black text-white outline-none focus:border-cyan-300/50" placeholder="10.00" /><button type="button" onClick={() => void beginUsdTopup()} disabled={usdTopupBusy} className="bg-cyan-300 px-4 py-3 text-xs font-black text-slate-950 hover:bg-cyan-200 disabled:opacity-50">{usdTopupBusy ? '준비 중...' : '카드로 충전'}</button></div>
          <p className="mt-2 text-[11px] text-slate-500">최소 $0.10 · 안전한 카드 결제</p>
           {usdTopupMessage && <div className="mt-3 border border-cyan-300/20 bg-cyan-300/10 p-3 text-xs font-bold text-cyan-100"><p>{usdTopupMessage}</p>{paddleTransactionId && <button type="button" onClick={() => void confirmPaddleTransaction(paddleTransactionId, `gyopo-paddle-claim:${paddleTransactionId}`)} className="mt-2 border border-cyan-200/40 px-2 py-1.5 text-[11px] font-black text-cyan-50">결제 확인 다시 시도</button>}</div>}
        </section>

        <section className="wallet-service-panel overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-white/10 p-5 sm:p-6"><div><h2 className="flex items-center gap-2 text-lg font-black"><History size={18} className="text-cyan-300" /> 최근 이용 내역</h2><p className="mt-1 text-xs text-slate-500">서비스 잔액과 관련된 최근 기록입니다.</p></div><button type="button" onClick={exportLedger} disabled={!serviceRows.length} className="inline-flex items-center gap-1.5 border border-white/10 px-2.5 py-2 text-xs font-black text-slate-300 disabled:opacity-40"><Download size={13} /> CSV</button></div>
          {ledgerError && <p className="m-4 border border-amber-300/20 bg-amber-300/10 p-3 text-xs font-bold text-amber-100">{ledgerError}</p>}
          {ledgerLoading && !ledger.length ? <div className="min-h-20" aria-busy="true" /> : !serviceRows.length ? <div className="p-12 text-center text-sm text-slate-500">아직 서비스 이용 기록이 없습니다.</div> : <div>{serviceRows.slice(0, 8).map((row) => <article key={row.id} className="flex items-center justify-between gap-3 border-b border-white/10 px-5 py-4 last:border-0"><div className="min-w-0"><p className="truncate text-sm font-bold text-white">{row.memo || '서비스 이용'}</p><p className="mt-1 text-[11px] text-slate-500">{String(row.createdAt)} · {row.status}</p></div><strong className={`whitespace-nowrap text-sm ${row.direction === 'IN' ? 'text-emerald-300' : 'text-rose-300'}`}>{row.direction === 'IN' ? '+' : '-'}${formatUsd(Number(row.amount || 0))}</strong></article>)}</div>}
          <div className="border-t border-white/10 p-4"><Link href="/wallet/history" className="text-xs font-black text-cyan-200 hover:text-white">전체 거래 내역 보기 →</Link></div>
        </section>
      </div>
    </div>
  );
}
