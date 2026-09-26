'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useGlobalStore } from '@/store/useGlobalStore';
import { applyAttack, createGame, drawGame, launch, stepGame, WIDTH, HEIGHT, STEP, type Mode } from '@/lib/brickBreaker';
import { connectPeer, createRoom, joinMatchmakingQueue, joinRoom, leaveMatchmakingQueue, newSeed, normalizeCode, readQueue, readResults, readRoom, ROUND_MS, saveResult, snapshot, snapshotGame, SNAPSHOT_MS, updateRoom, validCode, type Room, type Result } from '@/lib/brickBreakerRoom';
import styles from './brickbreaker.module.css';
import { useEffectEvent } from '@/lib/useeffectevent';

export default function BrickBreaker() {
  const canvas = useRef<HTMLCanvasElement>(null), opponentCanvas = useRef<HTMLCanvasElement>(null);
  const game = useRef(createGame('classic')), opponent = useRef<ReturnType<typeof createGame> | null>(null);
  const keys = useRef(new Set<string>()), transport = useRef<ReturnType<typeof connectPeer> | null>(null);
  const activeRound = useRef(''), sequence = useRef(0), receivedSequence = useRef(-1), lastSend = useRef(0), receivedAttacks = useRef(0);
  const roomRef = useRef<Room | null>(null), refreshRef = useRef<() => Promise<void>>(async () => {});
  const user = useGlobalStore(s => s.user);
  const [room, setRoom] = useState<Room | null>(null), [typedCode, setCode] = useState<string | null>(null);
  const inviteCode = useSyncExternalStore(callback => { window.addEventListener('hashchange', callback); return () => window.removeEventListener('hashchange', callback); }, () => normalizeCode(window.location.hash.slice(1)), () => '');
  const code = typedCode ?? inviteCode;
  const [mode, setMode] = useState<Mode>('classic'), [slowFactor, setSlowFactor] = useState(.68), [link, setLink] = useState('');
  const [connection, setConnection] = useState('offline'), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [matchmaking, setMatchmaking] = useState<'idle' | 'searching' | 'matched'>('idle');
  const [camera, setCamera] = useState(false), [chat, setChat] = useState('');
  const [messages, setMessages] = useState<{ mine: boolean; text: string }[]>([]);
  const [results, setResults] = useState<Result[]>([]), [history, setHistory] = useState<Result[]>([]);
  const [hud, setHud] = useState({ score: 0, lives: 3, status: 'ready', left: 60, opponentScore: 0, remaining: 180, countdown: 0, level: 1, attacks: 0, message: '' });
  const [saved, setSaved] = useState(''), [best, setBest] = useState(0);
  const bestRef = useRef(0), lastChat = useRef(0), saving = useRef(false);
  const host = !!room && user?.id === room.host;
  const peerId = room ? host ? room.guest : room.host : '';
  const ready = room ? host ? room.hostReady : room.guestReady : false;
  const playing = room?.status === 'playing';
  const roomId = room?.id, uid = user?.id;
  const terminal = hud.status === 'won' || hud.status === 'lost';

  function adoptRoom(next: Room) {
    roomRef.current = next;
    setRoom(next);
    setResults([]);
    setHistory([]);
    setMessages([]);
    setCamera(false);
    const url = new URL(window.location.href);
    url.hash = next.id;
    historyReplace(url);
    setLink(url.toString());
    setMatchmaking('matched');
  }

  async function run(action: () => Promise<void>) {
    setBusy(true); setError('');
    try { await action(); } catch (cause) {
      const message = cause instanceof Error ? cause.message : '';
      setError(message.includes('PERMISSION_DENIED') || message.includes('Missing or insufficient permissions')
        ? '방 생성 권한이 아직 운영 Firestore 규칙에 반영되지 않았습니다. 규칙 배포 후 다시 시도해주세요.'
        : '요청 실패: 로그인, 방 상태 또는 새 보안 규칙 배포를 확인해주세요.');
    }
    finally { setBusy(false); }
  }
  async function change(data: Partial<Room>) {
    if (!room) return;
    const next = await updateRoom(room, data); if (next) { roomRef.current = next; setRoom(next); }
    transport.current?.send({ type: 'sync' });
  }
  function restart(nextMode = mode, nextSlowFactor = slowFactor) { if (roomRef.current) return; game.current = createGame(nextMode, 1, nextSlowFactor); keys.current.clear(); canvas.current?.focus(); }
  function togglePause() {
    if (roomRef.current) return;
    const g = game.current; if (g.status === 'playing') g.status = 'paused'; else if (g.status === 'paused') g.status = 'playing';
    canvas.current?.focus();
  }
  function action() {
    if (roomRef.current) return;
    const g = game.current;
    if (g.status === 'lost' || g.status === 'won') restart(); else if (g.status === 'paused') g.status = 'playing'; else launch(g);
    canvas.current?.focus();
  }
  async function enter(create: boolean) {
    if (!user) return;
    const next = create ? await createRoom(user.id, mode) : await joinRoom(code, user.id);
    adoptRoom(next);
  }
  function historyReplace(url: URL) { window.history.replaceState(null, '', url); }
  async function startMatchmaking() {
    if (!user) return;
    setMatchmaking('searching');
    setError('');
    try {
      const result = await joinMatchmakingQueue({ id: user.id, name: user.name, image: user.image, country: user.country }, mode);
      if (result) adoptRoom(result.room);
    } catch (cause) {
      setMatchmaking('idle');
      throw cause;
    }
  }
  async function cancelMatchmaking() {
    if (!user) return;
    await leaveMatchmakingQueue(user.id);
    setMatchmaking('idle');
  }
  useEffect(() => { try { bestRef.current = Number(localStorage.getItem('gyopo-brick-best-v1')) || 0; } catch { /* Optional local best. */ } }, []);
  useEffect(() => { roomRef.current = room; }, [room]);
  useEffect(() => {
    if (matchmaking !== 'searching' || !user || room) return;
    let stopped = false;
    const poll = async () => {
      const queued = await readQueue(user.id).catch(() => null);
      if (stopped || !queued?.roomCode || queued.status !== 'matched') return;
      const next = await joinRoom(queued.roomCode, user.id).catch(() => null);
      if (!stopped && next) {
        adoptRoom(next);
        await leaveMatchmakingQueue(user.id);
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 2_500);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [matchmaking, room, user?.id]);
  useEffect(() => {
    if (!room || !user || !room.guest || room.status === 'closed') return;
     receivedSequence.current = -1; receivedAttacks.current = 0; opponent.current = null;
    const peer = connectPeer(room, user.id, packet => {
      const current = roomRef.current;
      if (packet.type === 'snapshot' && current?.status === 'playing' && packet.round === current.round && packet.seq > receivedSequence.current) {
         receivedSequence.current = packet.seq;
         const previousAttacks = receivedAttacks.current;
         receivedAttacks.current = packet.attackTotal;
         if (packet.attackTotal > previousAttacks) applyAttack(game.current, packet.attackTotal - previousAttacks);
         opponent.current = snapshotGame(packet, current);
      }
      if (packet.type === 'chat') setMessages(m => [...m.slice(-79), { mine: false, text: packet.text }]);
      if (packet.type === 'sync') void refreshRef.current();
    }, setConnection);
    transport.current = peer;
    return () => { peer.close(); transport.current = null; };
    // A fresh round gets fresh immutable signaling documents, never reuses stale SDP.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.id, room?.round, room?.guest, user?.id, room?.status === 'closed']);

  useEffect(() => {
    if (!roomId || !uid) return;
    let stopped = false, timer: ReturnType<typeof setTimeout>, inFlight = false, lastRead = 0;
    async function refresh() {
      if (stopped || inFlight || document.hidden || Date.now() - lastRead < 1500) return;
      inFlight = true; lastRead = Date.now();
      try {
        const next = await readRoom(roomId!);
        if (stopped) return;
        if (!next) throw new Error('Room missing');
        roomRef.current = next; setRoom(next);
        if (next.aborted) setHistory(old => old.filter(r => r.round !== next.round));
        const g = game.current;
        if (next.status === 'finished' || (next.status === 'playing' && ['won', 'lost'].includes(g.status))) {
          const scores = await readResults(next);
          if (stopped) return;
          setResults(scores);
          if (scores.length === 2 && !next.aborted) {
            setHistory(old => [...old.filter(r => r.round !== next.round), ...scores]);
            if (next.status === 'playing' && uid === next.host) { const done = await updateRoom(next, { status: 'finished' }); if (!stopped && done) { roomRef.current = done; setRoom(done); } }
          }
        }
      } catch { if (!stopped) setError('방 동기화 실패. 연결이 끊긴 경기는 순위에 포함하지 않습니다.'); }
      finally { inFlight = false; }
    }
    refreshRef.current = refresh;
    const loop = async () => { await refresh(); const current = roomRef.current; if (!stopped && current?.status !== 'closed' && current && Date.now() < current.createdAt + 3600000) timer = setTimeout(loop, current.status === 'playing' ? 10_000 : 3000); };
    void loop();
    return () => { stopped = true; clearTimeout(timer); refreshRef.current = async () => {}; };
  }, [roomId, uid]);

  useEffect(() => {
    if (!room || !user || room.status === 'closed') return;
    if (['disconnected', 'unavailable'].includes(connection) && room.status === 'playing') {
      void updateRoom(room, { status: 'finished', aborted: true }).then(next => { if (next) { roomRef.current = next; setRoom(next); } }).catch(() => setError('연결 중단. 이 경기는 무효입니다. 연결 복구 후 방을 나가주세요.'));
    }
  }, [connection, room, user]);
  useEffect(() => useGlobalStore.subscribe((current, previous) => { if (current.user?.id !== previous.user?.id) { transport.current?.close(); setRoom(null); roomRef.current = null; setCamera(false); setMessages([]); setHistory([]); setResults([]); setConnection('offline'); } }), []);
  useEffect(() => {
    if (!room || !user || room.status !== 'playing' || !terminal || room.aborted || saving.current || saved === `${room.id}_${room.round}` || activeRound.current !== `${room.id}_${room.round}` || !['won', 'lost'].includes(game.current.status)) return;
    saving.current = true;
    const key = `${room.id}_${room.round}`;
    void saveResult(room, user.id, game.current.score).then(() => { setSaved(key); transport.current?.send({ type: 'sync' }); void refreshRef.current(); })
      .catch(() => setError('연습 점수 저장 실패. 점수 저장 재시도를 눌러주세요.'))
      .finally(() => { saving.current = false; });
  }, [room, user, terminal, saved]);

  const tick = useEffectEvent((now: number) => {
    const r = roomRef.current, g = game.current;
    if (r?.status === 'playing') {
      const key = `${r.id}_${r.round}`;
       if (activeRound.current !== key) { activeRound.current = key; receivedAttacks.current = 0; game.current = createGame(r.mode, r.seed, slowFactor); sequence.current = 0; lastSend.current = 0; }
      if (Date.now() >= r.startAt && connection === 'connected') {
        if (game.current.status === 'ready') launch(game.current);
        if (Date.now() >= r.startAt + ROUND_MS && game.current.status === 'playing') game.current.status = 'lost';
      }
      if (now - lastSend.current >= SNAPSHOT_MS && Date.now() >= r.startAt) { transport.current?.send(snapshot(game.current, r.round, sequence.current++)); lastSend.current = now; }
    }
    if (!r && g.score > bestRef.current) { bestRef.current = g.score; try { localStorage.setItem('gyopo-brick-best-v1', String(g.score)); } catch { /* Optional local best. */ } }
    setBest(bestRef.current);
    const current = game.current;
     setHud({ score: current.score, lives: current.lives, status: current.status, left: current.bricks.filter(b => b.hp).length, opponentScore: opponent.current?.score || 0,
       remaining: r ? Math.max(0, Math.ceil((r.startAt + ROUND_MS - Date.now()) / 1000)) : 180, countdown: r?.status === 'playing' ? Math.max(0, Math.ceil((r.startAt - Date.now()) / 1000)) : 0, level: current.level, attacks: current.attackTotal, message: current.message });
  });
  useEffect(() => {
    const node = canvas.current, other = opponentCanvas.current;
    const ctx = node?.getContext('2d'), remote = other?.getContext('2d');
    if (!node || !ctx || !other || !remote) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    for (const [n, c] of [[node, ctx], [other, remote]] as const) { n.width = WIDTH * ratio; n.height = HEIGHT * ratio; c.scale(ratio, ratio); }
    let raf = 0, last = 0, accumulator = 0, lastHud = 0;
    const frame = (now: number) => {
      accumulator = Math.min(accumulator + Math.min((now - (last || now)) / 1000, 0.05), 0.05); last = now;
      if (now - lastHud >= 80) { tick(now); lastHud = now; }
      const r = roomRef.current;
      const allowed = !r || (r.status === 'playing' && Date.now() >= r.startAt && Date.now() < r.startAt + ROUND_MS);
      while (accumulator >= STEP) {
        const g = game.current;
        if (allowed && !document.hidden) {
          if (keys.current.has('ArrowLeft') || keys.current.has('a')) g.target -= 640 * STEP;
          if (keys.current.has('ArrowRight') || keys.current.has('d')) g.target += 640 * STEP;
          g.target = Math.max(0, Math.min(WIDTH, g.target)); stepGame(g);
        }
        accumulator -= STEP;
      }
      drawGame(ctx, game.current, true);
      if (opponent.current) drawGame(remote, opponent.current, true); else remote.clearRect(0, 0, WIDTH, HEIGHT);
      raf = requestAnimationFrame(frame);
    };
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select, button, a, [contenteditable="true"]')) return;
      if (['ArrowLeft', 'ArrowRight', 'a', 'd', ' ', 'p', 'Escape'].includes(e.key)) {
        e.preventDefault(); keys.current.add(e.key);
        if (!e.repeat && !roomRef.current) { if (e.key === ' ' && game.current.status === 'ready') launch(game.current); else if ([' ', 'p', 'Escape'].includes(e.key)) togglePause(); }
      }
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.key);
    const blur = () => { keys.current.clear(); if (!roomRef.current && game.current.status === 'playing') game.current.status = 'paused'; };
    const visibility = () => { blur(); last = 0; accumulator = 0; };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', blur); document.addEventListener('visibilitychange', visibility);
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange', visibility); };
  }, []);

  const sorted = [...results].sort((a, b) => b.score - a.score);
  const wins = (uid: string) => history.filter(r => r.actor === uid && history.some(other => other.round === r.round && other.actor !== uid && other.score < r.score)).length;
   return <main className={`brick-breaker-shell ${styles.shell}${hud.status === 'playing' ? ` ${styles.playing}` : ''}`}>
    <header className={styles.header}><div><small>GYOPO ARCADE / PRIVATE DUEL</small><h1>배드볼 <span>벽돌깨기</span></h1></div><strong>{room ? `ROUND ${room.round} / 2 PLAYERS` : 'FREE PRACTICE'}</strong></header>
    <section className={styles.lobby} aria-label="비공개 대전 방">
       {!room ? <><select aria-label="게임 모드" value={mode} disabled={matchmaking === 'searching'} onChange={e => { const m = e.target.value as Mode; setMode(m); restart(m); }}><option value="classic">클래식</option><option value="items">아이템 강화</option></select><select aria-label="감속 강도" value={slowFactor} disabled={mode !== 'items' || matchmaking === 'searching'} onChange={e => { const value = Number(e.target.value); setSlowFactor(value); restart(mode, value); }}><option value=".78">감속 20%</option><option value=".68">감속 32%</option><option value=".55">감속 45%</option></select>
        {user ? <><Link href="/users">친구 추가</Link><button disabled={busy || matchmaking === 'searching'} onClick={() => void run(() => enter(true))}>무료 2인 방 만들기</button><button disabled={busy || matchmaking === 'searching'} onClick={() => void run(startMatchmaking)}>{matchmaking === 'searching' ? '상대를 찾는 중...' : '자동 매칭'}</button>{matchmaking === 'searching' && <button disabled={busy} onClick={() => void run(cancelMatchmaking)}>매칭 취소</button>}<input aria-label="초대 코드" placeholder="24자리 초대 코드" maxLength={24} value={code} onChange={e => setCode(normalizeCode(e.target.value))} /><button disabled={busy || matchmaking === 'searching' || !validCode(code)} onClick={() => void run(() => enter(false))}>입장</button></> : <Link href="/login">로그인 후 무료 2인 대전</Link>}
      </> : <><span>{host ? 'HOST' : 'GUEST'} / {room.guest ? '2 / 2' : '1 / 2'} / {connection}</span><input aria-label="초대 링크" readOnly value={link} onFocus={e => e.target.select()} /><button onClick={() => void navigator.clipboard.writeText(link).catch(() => setError('초대 링크를 선택해 복사해주세요.'))}>링크 복사</button>
        {room.status === 'waiting' && <><button disabled={busy || connection !== 'connected'} onClick={() => void run(() => change(host ? { hostReady: !ready } : { guestReady: !ready }))}>{ready ? '준비 취소' : '준비'}</button><span>호스트 {room.hostReady ? '준비' : '대기'} / 게스트 {room.guestReady ? '준비' : '대기'}</span>
          {host && <><select aria-label="대전 모드" value={room.mode} disabled={room.hostReady || room.guestReady} onChange={e => void run(() => change({ mode: e.target.value as Mode }))}><option value="classic">노 아이템</option><option value="items">아이템</option></select><button disabled={busy || connection !== 'connected' || !room.hostReady || !room.guestReady} onClick={() => void run(() => change({ status: 'playing', startAt: Date.now() + 8000 }))}>대전 시작</button></>}
         <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('gyopo-friends-open'))}>친구창 열기</button>
       </>}
        {room.status === 'finished' && host && <button disabled={busy || room.round >= 20} onClick={() => void run(async () => { await change({ status: 'waiting', round: room.round + 1, seed: newSeed(), startAt: 0, hostReady: false, guestReady: false, aborted: false }); setResults([]); setCamera(false); })}>리매치 · 다시 준비</button>}
        <button disabled={busy} onClick={() => void run(async () => { if (room.status !== 'closed') await change({ status: 'closed', aborted: true }); await leaveMatchmakingQueue(user?.id || ''); transport.current?.close(); roomRef.current = null; setRoom(null); setMatchmaking('idle'); setCamera(false); setConnection('offline'); opponent.current = null; activeRound.current = ''; game.current = createGame(mode); window.history.replaceState(null, '', window.location.pathname); })}>방 나가기</button>
      </>}
    </section>
    {error && <p role="alert" className={styles.error}>{error} {terminal && playing && <button onClick={() => { setSaved('retry'); setError(''); }}>점수 저장 재시도</button>}</p>}
    {room?.aborted && <p className={styles.error}>연결 중단 / 취소된 무효 경기. 승리와 순위에 포함하지 않습니다.</p>}
    {['unavailable', 'disconnected'].includes(connection) && <p className={styles.error}>직접 연결 불가. 유료 TURN 중계는 사용하지 않습니다. 다른 네트워크 또는 새 방에서 다시 연결해주세요.</p>}
    <div className={styles.grid}>
       <section id="badball-own" className={styles.panel} data-game-panel="own" aria-label="내 게임"><div className={styles.bar}><b>01 / YOUR BOARD</b><strong>{String(hud.score).padStart(5, '0')}</strong><span>LV {hud.level} · {hud.lives} LIFE</span></div><div className={styles.stage}>
        <canvas ref={canvas} tabIndex={0} className={styles.canvas} aria-label="내 벽돌깨기. 방향키, 마우스, 터치로 이동" onPointerMove={e => { const r = e.currentTarget.getBoundingClientRect(); game.current.target = (e.clientX - r.left) / r.width * WIDTH; }} onPointerDown={e => { e.currentTarget.focus(); e.currentTarget.setPointerCapture(e.pointerId); const r = e.currentTarget.getBoundingClientRect(); game.current.target = (e.clientX - r.left) / r.width * WIDTH; if (!room) launch(game.current); }} />
         {!room && hud.status !== 'playing' && <div className={styles.overlay}><strong>{hud.status === 'ready' ? 'YOUR NEXT SHOT' : hud.status.toUpperCase()}</strong><button onClick={action}>{hud.status === 'ready' ? '공 발사' : hud.status === 'paused' ? '계속하기' : '다시 도전'}</button></div>}
         {room && (!playing || hud.countdown > 0 || terminal) && <div className={styles.overlay}><strong>{hud.countdown > 0 ? hud.countdown : room.status === 'waiting' ? 'BOTH PLAYERS READY?' : terminal ? 'ROUND FINISHED' : room.status.toUpperCase()}</strong></div>}
         {hud.message && <div className={styles.liveMessage} aria-live="polite">{hud.message}</div>}
       </div><div className={styles.bar}><span>{playing ? `${hud.remaining}s` : `BEST ${best}`} / {hud.left} BRICKS · {hud.attacks} ATTACKS</span><button disabled={!!room} onClick={togglePause}>일시 정지</button><button disabled={!!room} onClick={() => restart()}>다시 시작</button></div></section>
      <section id="badball-opponent" className={styles.panel} data-game-panel="opponent" aria-label="상대 실제 게임"><div className={styles.bar}><b>02 / OPPONENT</b><strong>{String(hud.opponentScore).padStart(5, '0')}</strong><span>P2P</span></div><div className={styles.stage}><canvas ref={opponentCanvas} className={styles.canvas} aria-label="상대가 전송한 실제 게임 보드" />{!opponent.current && <div className={styles.overlay}><strong>WAITING FOR PLAYER</strong><p>가짜 상대나 자동 플레이 없음</p></div>}</div><div className={styles.bar}>실제 수신 스냅샷 / 최대 10Hz / DB 보드 쓰기 0회</div></section>
      <section className={styles.panel} data-game-panel="camera" aria-label="카메라"><div className={styles.bar}><b>03 / CAMERA</b><span>MIC BLOCKED</span><button disabled={!peerId || !ready || room?.status === 'closed'} onClick={() => setCamera(!camera)}>{camera ? '카메라 끄기' : '영상 준비 · 카메라 켜기'}</button></div>
        {camera && peerId && room && ready && room.status !== 'closed' ? <iframe className={styles.camera} title="대전 카메라 · 마이크 차단" src={`/webrtc?friend=${encodeURIComponent(peerId)}&auto=1&compact=1&callKind=game&videoOnly=1&gameRoom=${encodeURIComponent(`brick_${room.id}`)}`} allow="camera 'self'; autoplay 'self'; microphone 'none'; display-capture 'none'" /> : <div className={styles.empty}><strong>CAMERA IS OPTIONAL</strong><p>각자 준비 후 직접 켜야 카메라를 요청합니다.<br />마이크와 화면 공유는 차단됩니다.</p></div>}
      </section>
      <section className={styles.panel} data-game-panel="chat" aria-label="대전 채팅"><div className={styles.bar}><b>04 / ROOM CHAT</b><span>PRIVATE / NO STORAGE</span></div><div className={styles.messages} role="log" aria-live="polite">{messages.length ? messages.map((m, i) => <p key={i}><b>{m.mine ? '나' : '상대'}</b> {m.text}</p>) : <p>연결된 상대와만 대화합니다. 최근 80개, 저장되지 않습니다.</p>}</div><form className={styles.chatForm} onSubmit={e => { e.preventDefault(); const text = chat.trim(); if (!text || Date.now() - lastChat.current < 500) return; if (transport.current?.send({ type: 'chat', text })) { lastChat.current = Date.now(); setMessages(m => [...m.slice(-79), { mine: true, text }]); setChat(''); } }}><input aria-label="채팅 메시지" value={chat} maxLength={280} onChange={e => setChat(e.target.value)} disabled={connection !== 'connected' || room?.status === 'closed'} placeholder="메시지 · 최대 280자" /><button disabled={connection !== 'connected' || !chat.trim()}>전송</button></form></section>
    </div>
    <p className={styles.notice}>동일 시드 · 동일 모드 · 180초 점수 대결. 대전은 자동 발사, 일시 정지 없음. 탭을 숨겨도 제한 시간은 흐릅니다. {room?.seed ? `SEED ${room.seed}` : ''}</p>
    <section className={styles.ranking}><div><h2>자가 신고 연습 순위</h2><p>이 방의 실제 제출 점수만 표시. 서버가 플레이를 검증하지 않으므로 공식 순위가 아닙니다.</p>{room && <p>이번 세션 라운드 승수: 나 {wins(user?.id || '')} : {wins(peerId)} 상대</p>}{!room?.aborted && sorted.map((r, i) => <p key={r.id}><b>{i && r.score === sorted[0].score ? 1 : i + 1}위</b> {r.actor === user?.id ? '나' : '상대'} / {r.score}점</p>)}{!results.length && <p>아직 제출된 결과가 없습니다.</p>}</div><div><button disabled aria-describedby="brick-money">실제 금액 베팅 · 비활성</button><p id="brick-money">검증된 서버 판정·정산이 없어 실제 금액 베팅은 사용할 수 없습니다. 포인트 발행, 지갑 차감, 상금 지급 없음.</p></div></section>
    <p className={styles.notice}>무료 플레이 / 별도 유료 서비스 없음. Firestore 무료 할당량 초과 비용은 운영자 정책에 따릅니다. 직접 연결은 일부 방화벽에서 불가합니다. 방은 1시간, 최대 20라운드입니다.</p>
  </main>;
}
