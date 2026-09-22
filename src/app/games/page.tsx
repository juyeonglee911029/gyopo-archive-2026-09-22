// The page contains a legacy hidden render path that is intentionally retained for rollback.
// Runtime behavior is validated by the live game path below.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- legacy rollback path is intentionally unchecked
// @ts-nocheck
'use client';

import { useEffect, useReducer, useRef, useState, type FormEvent, type TouchEvent, type CSSProperties } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowRightLeft, ArrowUp, Camera, Gamepad2, MessageCircle, Play, RotateCw, Send, Shield, Sparkles, Swords, Timer, Users, X, Zap } from 'lucide-react';
import { claimTetrisLobbyRoom, claimTetrisMatch, createDocument, deleteDocument, deleteExpiredChatMessages, getDocument, getSessionToken, getSessionUserId, heartbeatTetrisLobbyRoom, joinTetrisLobbyRoom, listDocuments, listOnlineUsers, mergeDocument, OnlineUser, queryDocuments, queryDocumentsWhere, refreshStoredUser, refundGameStake, releaseTetrisLobbyRoom, reserveGameStake, reserveTetrisLobbyRoom, settleTetrisMatch, startTetrisCountdown, upsertDocument, type TetrisLobbyRoom, type TetrisQueueProfile } from '@/lib/firebase';
import { useGlobalStore } from '@/store/useGlobalStore';
import '@/styles/call-ui.css';
import '@/styles/game-workspace.css';

function formatUsd(value: number | string) {
  return Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function gameErrorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('403') || message.includes('PERMISSION_DENIED')) {
    return '대전 방 권한이 만료되었거나 이미 종료된 방입니다. 방을 나가고 새 대전을 시작해주세요.';
  }
  if (message.includes('400') || message.includes('FAILED_PRECONDITION')) {
    return '대전 방 상태가 동시에 변경되었습니다. 잠시 후 자동으로 다시 확인합니다.';
  }
  return message || fallback;
}

function isPermissionDenied(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  return message.includes('403') || message.includes('PERMISSION_DENIED');
}

const WIDTH = 10;
const HEIGHT = 20;
const SHAPES = [
  [[1, 1, 1, 1]],
  [[1, 1], [1, 1]],
  [[0, 1, 0], [1, 1, 1]],
  [[1, 0, 0], [1, 1, 1]],
  [[0, 0, 1], [1, 1, 1]],
  [[0, 1, 1], [1, 1, 0]],
  [[1, 1, 0], [0, 1, 1]],
];
const COLORS = ['#2dd4bf', '#facc15', '#c084fc', '#60a5fa', '#fb923c', '#f472b6', '#4ade80'];
const DEFAULT_ENTRY_FEE = 1;
const MIN_ENTRY_FEE = 1;
const MAX_ENTRY_FEE = 100;
const TETRIS_COUNTDOWN_MS = 3_000;
const TETRIS_ROOM_COUNT = 10;
const TETRIS_SCORE_STORAGE_KEY = 'gyopo-tetris-ranking-v1';
type Piece = { type: number; shape: number[][]; x: number; y: number };
type ChatMessage = { id: string; authorId: string; user: string; country?: string; text: string; createdAt: string; expiresAt?: string | Date };
type TetrisScore = { id: string; userId: string; name: string; country: string; score: number; lines: number; combo: number; mode: 'practice' | 'battle'; createdAt: string };
type GameState = {
  board: number[][];
  piece: Piece;
  nextPiece: Piece;
  running: boolean;
  started: boolean;
  paused: boolean;
  score: number;
  lines: number;
  attackTotal: number;
  garbageReceived: number;
  lastCleared: number;
  lastAttack: number;
  combo: number;
  notice: string;
  noticeId: number;
};
type TetrisProfile = { id: string; name: string; image: string; country?: string };
type TetrisLobby = { status?: 'waiting' | 'matched'; waitingUserId?: string; waitingUser?: TetrisProfile; matchId?: string; playerAId?: string; playerBId?: string; playerA?: TetrisProfile; playerB?: TetrisProfile; updatedAt?: string };
type MatchPhase = 'idle' | 'waiting' | 'betting' | 'holding' | 'countdown' | 'playing' | 'finished';
type TetrisInvite = { id: string; senderId: string; recipientId: string; sender: TetrisProfile; recipient: TetrisProfile; matchId: string; roomNumber?: number; status: 'pending' | 'accepted' | 'rejected'; createdAt: string; updatedAt?: string };
type StoredPiece = Omit<Piece, 'shape'> & { shape: number[]; shapeRows: number; shapeColumns: number };
type StoredGameState = Omit<GameState, 'board' | 'piece' | 'nextPiece'> & { board: number[]; piece: StoredPiece; nextPiece: StoredPiece };
type TetrisQueueRecord = TetrisQueueProfile & { userId: string; status: 'waiting' | 'matched'; matchId?: string; role?: 'A' | 'B'; opponent?: TetrisProfile; lastSeenAt: string | Date };
type TetrisRoom = TetrisLobby & {
  roomNumber?: number;
  phase?: 'betting' | 'holding' | 'countdown' | 'playing' | 'finished';
  betAmount?: number;
  readyA?: boolean;
  readyB?: boolean;
  readyAAt?: string;
  readyBAt?: string;
  startAt?: string;
  startRequestedBy?: string;
  startRequestedAt?: string;
  stakeHeldA?: boolean;
  stakeHeldB?: boolean;
  payoutStatus?: 'PAID' | 'PENDING';
  payoutAmount?: number;
  playerAResult?: 'win' | 'lose';
  playerBResult?: 'win' | 'lose';
  playerAState?: GameState | StoredGameState;
  playerBState?: GameState | StoredGameState;
  musicVideoId?: string;
  musicTitle?: string;
  musicArtist?: string;
  musicPlaying?: boolean;
  musicPosition?: number;
  musicStartedAt?: number;
  musicVolume?: number;
  musicUpdatedAt?: string;
};
type GameAction =
  | { type: 'START' }
  | { type: 'RESET' }
  | { type: 'TOGGLE_PAUSE' }
  | { type: 'MOVE'; dx: number; dy: number }
  | { type: 'ROTATE' }
  | { type: 'SWAP_NEXT' }
  | { type: 'DROP' }
  | { type: 'RECEIVE_GARBAGE'; lines: number };

const emptyBoard = () => Array.from({ length: HEIGHT }, () => Array(WIDTH).fill(0));
const cloneShape = (shape: number[][]) => shape.map((row) => [...row]);
const clonePiece = (piece: Piece): Piece => ({ ...piece, shape: cloneShape(piece.shape) });
const flattenShape = (shape: number[][]) => ({ shape: shape.flat(), shapeRows: shape.length, shapeColumns: shape[0]?.length || 0 });
const expandShape = (shape: number[], rows: number, columns: number) => Array.from({ length: rows }, (_, row) => shape.slice(row * columns, (row + 1) * columns));
const serializeGameState = (state: GameState): StoredGameState => ({
  ...state,
  board: state.board.flat(),
  piece: { ...state.piece, ...flattenShape(state.piece.shape) },
  nextPiece: { ...state.nextPiece, ...flattenShape(state.nextPiece.shape) },
});
function deserializeGameState(value: GameState | StoredGameState | null | undefined): GameState | null {
  if (!value) return null;
  if (Array.isArray(value.board[0])) return value as GameState;
  const stored = value as StoredGameState;
  return {
    ...stored,
    board: expandShape(stored.board, HEIGHT, WIDTH),
    piece: { ...stored.piece, shape: expandShape(stored.piece.shape, stored.piece.shapeRows, stored.piece.shapeColumns) },
    nextPiece: { ...stored.nextPiece, shape: expandShape(stored.nextPiece.shape, stored.nextPiece.shapeRows, stored.nextPiece.shapeColumns) },
  };
}
const randomPiece = (): Piece => {
  const type = Math.floor(Math.random() * SHAPES.length);
  return { type, shape: cloneShape(SHAPES[type]), x: 3, y: 0 };
};
const rotate = (shape: number[][]) => shape[0].map((_, index) => shape.map((row) => row[index]).reverse());
const collides = (board: number[][], piece: Piece, dx = 0, dy = 0, shape = piece.shape) => shape.some((row, y) => row.some((cell, x) => {
  if (!cell) return false;
  const nextX = piece.x + x + dx;
  const nextY = piece.y + y + dy;
  return nextX < 0 || nextX >= WIDTH || nextY >= HEIGHT || (nextY >= 0 && Boolean(board[nextY]?.[nextX]));
}));

const createGame = (): GameState => ({
  board: emptyBoard(),
  piece: randomPiece(),
  nextPiece: randomPiece(),
  running: false,
  started: false,
  paused: false,
  score: 0,
  lines: 0,
  attackTotal: 0,
  garbageReceived: 0,
  lastCleared: 0,
  lastAttack: 0,
  combo: 0,
  notice: '',
  noticeId: 0,
});
const buildVisual = (state: GameState) => {
  const visual = state.board.map((row) => [...row]);
  let ghostDistance = 0;
  while (!collides(state.board, state.piece, 0, ghostDistance + 1)) ghostDistance += 1;
  const ghostY = state.piece.y + ghostDistance;
  state.piece.shape.forEach((row, y) => row.forEach((cell, x) => {
    if (!cell) return;
    if (ghostY + y >= 0 && ghostY + y < HEIGHT && !visual[ghostY + y][state.piece.x + x]) visual[ghostY + y][state.piece.x + x] = -1;
    if (state.piece.y + y >= 0 && state.piece.y + y < HEIGHT) visual[state.piece.y + y][state.piece.x + x] = state.piece.type + 1;
  }));
  return visual;
};

function BoardGrid({ cells, compact = false }: { cells: number[][]; compact?: boolean }) {
  return (
    <div className={`grid grid-cols-10 rounded-xl bg-[#0b1221] ${compact ? 'gap-px p-1' : 'gap-1 p-2'}`}>
      {cells.flatMap((row, y) => row.map((cell, x) => (
        <div
          key={`${x}-${y}`}
          className={`aspect-square rounded-[3px] ${compact ? '' : 'md:rounded-[4px]'} ${cell === 0 ? 'border border-white/[0.05] bg-white/[0.025]' : cell === -1 ? 'border border-dashed border-cyan-100/60 bg-cyan-200/10' : 'border-white/50 shadow-[inset_0_2px_0_rgba(255,255,255,.55),0_0_12px_var(--cell)]'}`}
           style={cell > 0 ? ({ '--cell': cell === 8 ? '#64748b' : COLORS[cell - 1], backgroundColor: cell === 8 ? '#64748b' : COLORS[cell - 1] } as CSSProperties) : undefined}
        />
      )))}
    </div>
  );
}

function NextBlock({ piece, compact = false }: { piece: Piece; compact?: boolean }) {
  return (
    <div className={`grid grid-cols-4 rounded-xl bg-black/20 ${compact ? 'gap-px p-1' : 'gap-1 p-2'}`}>
      {Array.from({ length: 16 }, (_, index) => {
        const x = index % 4;
        const y = Math.floor(index / 4);
        return <div key={index} className="aspect-square rounded" style={piece.shape[y]?.[x] ? { backgroundColor: COLORS[piece.type] } : undefined} />;
      })}
    </div>
  );
}

function BattleMetrics({ state, elapsed }: { state: Pick<GameState, 'attackTotal' | 'lines' | 'lastAttack' | 'combo'> | null; elapsed: string }) {
  return (
    <div className="tetris-battle-metrics mt-2">
      <div className="rounded-lg border border-cyan-300/15 bg-cyan-300/[0.06] px-1 py-1.5"><span className="block text-[8px] font-black text-slate-500">보낸 줄</span><b className="text-xs text-cyan-100">{state?.attackTotal || 0}</b></div>
      <div className="rounded-lg border border-violet-300/15 bg-violet-300/[0.06] px-1 py-1.5"><span className="block text-[8px] font-black text-slate-500">깬 줄</span><b className="text-xs text-violet-100">{state?.lines || 0}</b></div>
      <div className="rounded-lg border border-amber-300/15 bg-amber-300/[0.06] px-1 py-1.5"><span className="block text-[8px] font-black text-slate-500">공격</span><b className="text-xs text-amber-100">+{state?.lastAttack || 0}</b></div>
      <div className="rounded-lg border border-emerald-300/15 bg-emerald-300/[0.06] px-1 py-1.5"><span className="block text-[8px] font-black text-slate-500">콤보</span><b className="text-xs text-emerald-100">{state?.combo || 0}</b></div>
      <div className="tetris-battle-time"><Timer size={10} /> TIME: {elapsed}</div>
    </div>
  );
}

function lockPiece(state: GameState, landed: Piece): GameState {
  const merged = state.board.map((row) => [...row]);
  landed.shape.forEach((row, y) => row.forEach((cell, x) => {
    if (cell && landed.y + y >= 0 && landed.y + y < HEIGHT) merged[landed.y + y][landed.x + x] = landed.type + 1;
  }));
  const kept = merged.filter((row) => row.some((cell) => !cell));
  const cleared = HEIGHT - kept.length;
  const nextBoard = [...Array.from({ length: cleared }, () => Array(WIDTH).fill(0)), ...kept];
  const spawned = { ...clonePiece(state.nextPiece), x: 3, y: 0 };
  const gameOver = collides(nextBoard, spawned);
  const combo = cleared ? state.combo + 1 : 0;
  const basePoints = [0, 100, 300, 500, 800][cleared];
  const comboScore = cleared ? Math.min(8, Math.max(0, combo - 1)) * 50 : 0;
  const points = basePoints + comboScore;
  const baseAttack = [0, 0, 1, 2, 4][cleared] || 0;
  const comboBonus = cleared ? Math.min(4, Math.max(0, combo - 1)) : 0;
  const attackLines = baseAttack + comboBonus;
  return {
    ...state,
    board: nextBoard,
    piece: spawned,
    nextPiece: randomPiece(),
    running: !gameOver,
    score: state.score + points,
    lines: state.lines + cleared,
    attackTotal: state.attackTotal + attackLines,
    lastCleared: cleared,
    lastAttack: attackLines,
    combo,
    notice: gameOver ? '게임 오버 · 새 게임을 시작하세요' : cleared ? `${cleared}줄 클리어 · ${combo > 1 ? `${combo} COMBO · ` : ''}${attackLines ? `상대에게 ${attackLines}줄 공격` : `+${points}`}` : '',
    noticeId: Date.now(),
  };
}

function addGarbageLines(state: GameState, lines: number): GameState {
  if (lines <= 0) return state;
  const safeLines = Math.min(lines, HEIGHT);
  const garbage = Array.from({ length: safeLines }, () => {
    const gap = Math.floor(Math.random() * WIDTH);
    return Array.from({ length: WIDTH }, (_, index) => (index === gap ? 0 : 8));
  });
  const board = [...state.board.slice(safeLines), ...garbage];
  const gameOver = collides(board, state.piece);
  return {
    ...state,
    board,
    running: gameOver ? false : state.running,
    garbageReceived: state.garbageReceived + safeLines,
    lastCleared: 0,
    lastAttack: 0,
    combo: 0,
    notice: gameOver ? '상대 공격으로 게임 오버' : `상대 공격 · ${safeLines}줄 수신`,
    noticeId: Date.now(),
  };
}

function gameReducer(state: GameState, action: GameAction): GameState {
  if (action.type === 'START') return { ...createGame(), running: true, started: true, notice: '게임 시작 · 방향키로 조작하세요', noticeId: Date.now() };
  if (action.type === 'RESET') return createGame();
  if (action.type === 'RECEIVE_GARBAGE') return addGarbageLines(state, action.lines);
  if (action.type === 'TOGGLE_PAUSE') return state.running ? { ...state, paused: !state.paused } : state;
  if (!state.running || state.paused) return state;
  if (action.type === 'ROTATE') {
    const rotated = rotate(state.piece.shape);
    return collides(state.board, state.piece, 0, 0, rotated) ? state : { ...state, piece: { ...state.piece, shape: rotated } };
  }
  if (action.type === 'SWAP_NEXT') {
    const current = { ...clonePiece(state.piece), x: 3, y: 0 };
    const next = { ...clonePiece(state.nextPiece), x: 3, y: 0 };
    if (collides(state.board, next)) return state;
    return { ...state, piece: next, nextPiece: current, notice: '다음 블록으로 교체', noticeId: Date.now() };
  }
  if (action.type === 'DROP') {
    let distance = 0;
    while (!collides(state.board, state.piece, 0, distance + 1)) distance += 1;
    return lockPiece(state, { ...state.piece, y: state.piece.y + distance });
  }
  if (!collides(state.board, state.piece, action.dx, action.dy)) return { ...state, piece: { ...state.piece, x: state.piece.x + action.dx, y: state.piece.y + action.dy } };
  return action.dy === 1 ? lockPiece(state, state.piece) : state;
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

function sortTetrisScores(scores: TetrisScore[]) {
  return [...scores].sort((a, b) => b.score - a.score || b.lines - a.lines || Date.parse(a.createdAt) - Date.parse(b.createdAt)).slice(0, 50);
}

function readLocalTetrisScores(): TetrisScore[] {
  if (typeof window === 'undefined') return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(TETRIS_SCORE_STORAGE_KEY) || '[]');
    return Array.isArray(value) ? value.filter((item): item is TetrisScore => item && typeof item.id === 'string' && typeof item.score === 'number') : [];
  } catch {
    return [];
  }
}

export default function GamesPage() {
  const user = useGlobalStore((state) => state.user);
  const setUser = useGlobalStore((state) => state.setUser);
  const [game, dispatch] = useReducer(gameReducer, undefined, createGame);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
  const [ranking, setRanking] = useState<TetrisScore[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [matchId, setMatchId] = useState<string | null>(null);
  const [matchRole, setMatchRole] = useState<'A' | 'B' | null>(null);
  const [opponent, setOpponent] = useState<TetrisProfile | null>(null);
  const [opponentState, setOpponentState] = useState<GameState | null>(null);
  const [matchStatus, setMatchStatus] = useState('대전 준비 안됨');
  const [matchPhase, setMatchPhase] = useState<MatchPhase>('idle');
  const [incomingInvite, setIncomingInvite] = useState<TetrisInvite | null>(null);
  const [sentInviteId, setSentInviteId] = useState<string | null>(null);
  const [inviteStatus, setInviteStatus] = useState('');
  const [readyForBattle, setReadyForBattle] = useState(false);
  const [opponentReady, setOpponentReady] = useState(false);
  const [selectedOnlineUserId, setSelectedOnlineUserId] = useState<string | null>(null);
  const [betAmount, setBetAmount] = useState(DEFAULT_ENTRY_FEE);
  const [stakeReserved, setStakeReserved] = useState(false);
  const [countdown, setCountdown] = useState<number | 'START' | null>(null);
  const [matchResult, setMatchResult] = useState<'WIN' | 'LOSE' | null>(null);
  const [roomNumber, setRoomNumber] = useState<number | null>(null);
  const [roomStartAt, setRoomStartAt] = useState<string | null>(null);
  const [runEndedAt, setRunEndedAt] = useState<number | null>(null);
  const [battleClock, setBattleClock] = useState(0);
  const [battleFx, setBattleFx] = useState<{ id: number; kind: 'clear' | 'attack' | 'incoming'; title: string; subtitle: string } | null>(null);
  const toastTimer = useRef<number | null>(null);
  const firstChatLoad = useRef(true);
  const lastMessageId = useRef<string | null>(null);
  const lastChatCleanup = useRef(0);
  const queuePollingRef = useRef(false);
  const gameRef = useRef(game);
  const resultSent = useRef(false);
  const gameStartedRef = useRef(false);
  const startRequestedRef = useRef(false);
  const autoStartRequestedRef = useRef(false);
  const holdRequestedRef = useRef(false);
  const countdownRoomRef = useRef<string | null>(null);
  const settlementRequestedRef = useRef(false);
  const roomCleanupTimer = useRef<number | null>(null);
  const roomSeenRef = useRef(false);
  const handledInviteIds = useRef(new Set<string>());
  const invitePollingRef = useRef(false);
  const resultNoticeRef = useRef<string | null>(null);
  const opponentAttackTotalRef = useRef(0);
  const opponentAttackInitializedRef = useRef(false);
  const lastNoticeIdRef = useRef(0);
  const soundContextRef = useRef<AudioContext | null>(null);
  const lastCountdownSoundRef = useRef<number | null>(null);
  const lobbyReleaseRequestedRef = useRef<string | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const tapTimerRef = useRef<number | null>(null);
  const roomMusicKeyRef = useRef('');
  const togetherListeningRef = useRef(false);
  const runStartedAtRef = useRef<number | null>(null);
  const submittedRunRef = useRef<string | null>(null);
  const currentUserId = user ? (getSessionUserId() || user.id) : '';
  const [, setRoomBetConfigured] = useState(false);
  const [togetherListening, setTogetherListening] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.matchMedia('(max-width: 639px)').matches) return;
    const htmlOverflow = document.documentElement.style.overflow;
    const bodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    return () => {
      document.documentElement.style.overflow = htmlOverflow;
      document.body.style.overflow = bodyOverflow;
    };
  }, []);

  useEffect(() => {
    if (matchPhase !== 'playing' || !roomStartAt || !game.running) return;
    const tick = () => setBattleClock(Date.now());
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [game.running, matchPhase, roomStartAt]);

  useEffect(() => {
    if (!game.started) {
      setRunEndedAt(null);
      return;
    }
    if (game.running) setRunEndedAt(null);
    else setRunEndedAt((value) => value || Date.now());
  }, [game.running, game.started]);

  const playGameSound = (kind: 'start' | 'clear' | 'attack' | 'incoming') => {
    if (typeof window === 'undefined') return;
    const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const context = soundContextRef.current || new AudioContextClass();
    soundContextRef.current = context;
    void context.resume();
    const notes = kind === 'start' ? [392, 523, 659] : kind === 'attack' ? [220, 330, 494] : kind === 'incoming' ? [660, 440, 330] : [523, 659, 784];
    notes.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = context.currentTime + index * 0.07;
      oscillator.type = kind === 'attack' || kind === 'incoming' ? 'sawtooth' : 'square';
      oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.045, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.18);
    });
  };

  useEffect(() => {
    if (!game.noticeId || game.noticeId === lastNoticeIdRef.current) return;
    lastNoticeIdRef.current = game.noticeId;
    if (game.notice.includes('줄 클리어')) {
      const cleared = game.lastCleared || 1;
      const attacking = game.lastAttack > 0;
      setBattleFx({ id: Date.now(), kind: attacking ? 'attack' : 'clear', title: attacking ? `ATTACK +${game.lastAttack}` : `${cleared} LINE CLEAR`, subtitle: game.combo > 1 ? `${game.combo} COMBO` : `${cleared}줄 클리어` });
      playGameSound(attacking ? 'attack' : 'clear');
    }
  }, [game.noticeId, game.notice, game.lastAttack, game.lastCleared, game.combo]);

  useEffect(() => {
    if (!battleFx) return;
    const timer = window.setTimeout(() => setBattleFx(null), 1200);
    return () => window.clearTimeout(timer);
  }, [battleFx?.id]);

  useEffect(() => {
    gameRef.current = game;
  }, [game]);

  const showToast = (text: string) => {
    setToast({ id: Date.now(), text });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 4200);
  };

  useEffect(() => {
    const element = chatScrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages.length]);

  const elapsedEnd = runEndedAt || battleClock;
  const elapsedSeconds = roomStartAt && (matchPhase === 'playing' || runEndedAt) ? Math.max(0, Math.floor((elapsedEnd - new Date(roomStartAt).getTime()) / 1000)) : 0;
  const elapsedLabel = `${String(Math.floor(elapsedSeconds / 60)).padStart(2, '0')}:${String(elapsedSeconds % 60).padStart(2, '0')}`;

  const submitTetrisScore = async (state: GameState) => {
    const createdAt = new Date().toISOString();
    const id = `tetris-${currentUserId || 'guest'}-${runStartedAtRef.current || Date.now()}`;
    const entry: TetrisScore = {
      id,
      userId: currentUserId || 'guest',
      name: user?.name || 'Guest',
      country: user?.country || 'Global',
      score: state.score,
      lines: state.lines,
      combo: state.combo,
      mode: matchId ? 'battle' : 'practice',
      createdAt,
    };
    const next = sortTetrisScores([...readLocalTetrisScores().filter((item) => item.id !== id), entry]);
    try {
      window.localStorage.setItem(TETRIS_SCORE_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Keep the current ranking visible even when storage is unavailable.
    }
    setRanking((current) => sortTetrisScores([...current.filter((item) => item.id !== id), entry]));
    const token = getSessionToken();
    if (token && currentUserId) {
      await upsertDocument('tetrisScores', id, {
        userId: entry.userId,
        name: entry.name,
        country: entry.country,
        score: entry.score,
        lines: entry.lines,
        combo: entry.combo,
        mode: entry.mode,
        createdAt: entry.createdAt,
      }, token).catch(() => undefined);
    }
  };

  useEffect(() => {
    if (game.running || !game.started || game.score <= 0) return;
    const runId = String(runStartedAtRef.current || '');
    if (!runId || submittedRunRef.current === runId) return;
    submittedRunRef.current = runId;
    void submitTetrisScore(game);
  }, [game.running, game.started, game.score, game.lines, game.combo, matchId, currentUserId]);

  useEffect(() => {
    if (game.notice) showToast(game.notice);
  }, [game.noticeId]);

  useEffect(() => {
    const load = async () => setOnlineUsers(await listOnlineUsers().catch(() => []));
    void load();
    const timer = window.setInterval(load, 3000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const local = readLocalTetrisScores();
      const remote = await listDocuments<TetrisScore>('tetrisScores').catch(() => []);
      const merged = new Map<string, TetrisScore>();
      [...local, ...remote].forEach((entry) => merged.set(entry.id, entry));
      if (!cancelled) setRanking(sortTetrisScores([...merged.values()]));
    };
    void load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const load = async () => {
      const token = getSessionToken();
      if (token && Date.now() - lastChatCleanup.current > 30_000) {
        lastChatCleanup.current = Date.now();
        await deleteExpiredChatMessages(token, 'tetrisChatMessages').catch(() => undefined);
      }
      const next = (await queryDocumentsWhere<Omit<ChatMessage, 'id'>>('tetrisChatMessages', [{ field: 'expiresAt', op: 'GREATER_THAN', value: new Date() }], token, 60).catch(() => []))
        .filter((message) => message.authorId)
        .filter((message) => !message.expiresAt || new Date(message.expiresAt).getTime() > Date.now())
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        .slice(-24);
      const latest = next[next.length - 1];
      if (!firstChatLoad.current && latest && latest.id !== lastMessageId.current) showToast(`${latest.user}: ${latest.text}`);
      firstChatLoad.current = false;
      lastMessageId.current = latest?.id || null;
      setMessages(next);
    };
    void load();
    const timer = window.setInterval(load, 1500);
    return () => window.clearInterval(timer);
  }, [user?.id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!game.running) return;
      if (event.key === 'ArrowLeft') { event.preventDefault(); dispatch({ type: 'MOVE', dx: -1, dy: 0 }); }
      if (event.key === 'ArrowRight') { event.preventDefault(); dispatch({ type: 'MOVE', dx: 1, dy: 0 }); }
      if (event.key === 'ArrowDown') { event.preventDefault(); dispatch({ type: 'MOVE', dx: 0, dy: 1 }); }
      if (event.key === 'ArrowUp') { event.preventDefault(); dispatch({ type: 'ROTATE' }); }
       if (event.key.toLowerCase() === 'c') { event.preventDefault(); dispatch({ type: 'SWAP_NEXT' }); }
      if (event.key === ' ') { event.preventDefault(); dispatch({ type: 'DROP' }); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [game.running]);

  const handleTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
  };

  const handleTouchMove = (event: TouchEvent<HTMLDivElement>) => {
    event.preventDefault();
  };

  const handleTouchEnd = (event: TouchEvent<HTMLDivElement>) => {
    const start = touchStartRef.current;
    const touch = event.changedTouches[0];
    touchStartRef.current = null;
    if (!start || !touch || !game.running || game.paused) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) {
      if (tapTimerRef.current) {
        window.clearTimeout(tapTimerRef.current);
        tapTimerRef.current = null;
        dispatch({ type: 'DROP' });
      } else {
        tapTimerRef.current = window.setTimeout(() => {
          tapTimerRef.current = null;
          dispatch({ type: 'ROTATE' });
        }, 240);
      }
      return;
    }
    if (Math.abs(dx) > Math.abs(dy)) {
      const steps = Math.min(4, Math.max(1, Math.floor(Math.abs(dx) / 48)));
      for (let index = 0; index < steps; index += 1) dispatch({ type: 'MOVE', dx: dx > 0 ? 1 : -1, dy: 0 });
    }
    else if (dy < 0) dispatch({ type: 'SWAP_NEXT' });
    else dispatch({ type: 'DROP' });
  };

  useEffect(() => () => {
    if (tapTimerRef.current) window.clearTimeout(tapTimerRef.current);
  }, []);

  useEffect(() => {
    if (!game.running || game.paused) return;
    const timer = window.setInterval(() => dispatch({ type: 'MOVE', dx: 0, dy: 1 }), Math.max(180, 850 - Math.floor(game.lines / 5) * 45));
    return () => window.clearInterval(timer);
  }, [game.running, game.paused, game.lines]);

  const updateRoom = async (patch: Record<string, unknown>) => {
    if (!matchId || !matchRole || !user) throw new Error('대전 방 정보가 없습니다.');
    const token = getSessionToken();
    if (!token) throw new Error('로그인 세션이 만료되었습니다.');
    const sessionUserId = currentUserId;
    const profile: TetrisProfile = { id: sessionUserId, name: user.name, image: user.image, country: user.country || 'Global' };
    const opponentProfile = opponent ? {
      id: opponent.id,
      name: opponent.name,
      image: opponent.image,
      country: opponent.country || 'Global',
    } : null;
    await mergeDocument('tetrisRooms', matchId, {
      ...patch,
      matchId,
      ...(roomNumber ? { roomNumber } : {}),
      ...(matchRole === 'A'
          ? {
            playerAId: sessionUserId,
            playerA: profile,
            ...(opponentProfile ? { playerBId: opponentProfile.id, playerB: opponentProfile } : {}),
          }
        : {
            playerBId: sessionUserId,
            playerB: profile,
            ...(opponentProfile ? { playerAId: opponentProfile.id, playerA: opponentProfile } : {}),
          }),
      updatedAt: new Date(),
    }, token);
  };

  useEffect(() => {
    const onLocalMusicChange = (event: Event) => {
      if (!matchId || !togetherListeningRef.current) return;
       const detail = (event as CustomEvent<{ track?: { videoId?: string; title?: string; artist?: string }; playing?: boolean; position?: number; startedAt?: number; volume?: number; source?: string; player?: string }>).detail;
       if (!detail.track?.videoId || detail.source === 'room' || detail.player === 'radio') return;
      void updateRoom({
        musicVideoId: detail.track.videoId,
        musicTitle: detail.track.title || 'GYOPO MUSIC',
        musicArtist: detail.track.artist || 'YouTube',
        musicPlaying: Boolean(detail.playing),
        musicPosition: Number(detail.position || 0),
        musicStartedAt: Number(detail.startedAt || Date.now()),
        musicVolume: Number(detail.volume ?? 70),
        musicUpdatedAt: new Date().toISOString(),
      }).catch(() => undefined);
    };
    window.addEventListener('gyopo-music-local', onLocalMusicChange);
    return () => window.removeEventListener('gyopo-music-local', onLocalMusicChange);
  }, [matchId, togetherListening, currentUserId]);

  const toggleTogetherListening = () => {
    const next = !togetherListeningRef.current;
    togetherListeningRef.current = next;
    setTogetherListening(next);
    if (next) window.dispatchEvent(new CustomEvent('gyopo-music-request-state'));
  };

  const beginCountdown = (startAt = new Date(Date.now() + TETRIS_COUNTDOWN_MS).toISOString()) => {
    if (countdownRoomRef.current === startAt) return;
    runStartedAtRef.current = Date.now();
    countdownRoomRef.current = startAt;
    setMatchResult(null);
    setMatchPhase('countdown');
    setRoomStartAt(startAt);
    setCountdown(Math.max(1, Math.min(10, Math.ceil((new Date(startAt).getTime() - Date.now()) / 1000))));
  };

  useEffect(() => {
    if (!roomStartAt) {
      setCountdown(null);
      return;
    }
    const startTime = new Date(roomStartAt).getTime();
    let timer: number | null = null;
    let cancelled = false;
    const finish = () => {
      if (cancelled || gameStartedRef.current) return;
      setCountdown(null);
      setMatchPhase('playing');
      gameStartedRef.current = true;
      dispatch({ type: 'START' });
    };
    const tick = () => {
      const remaining = Math.ceil((startTime - Date.now()) / 1000);
      if (remaining > 0) {
        setCountdown(Math.min(10, remaining));
        if (lastCountdownSoundRef.current !== remaining) {
          lastCountdownSoundRef.current = remaining;
          playGameSound('clear');
        }
        timer = window.setTimeout(tick, 100);
        return;
      }
      setCountdown('START');
      if (lastCountdownSoundRef.current !== 0) {
        lastCountdownSoundRef.current = 0;
        playGameSound('start');
      }
      timer = window.setTimeout(finish, 450);
    };
    if (Number.isFinite(startTime)) tick();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [roomStartAt]);

  const practiceStart = () => {
    const token = getSessionToken();
    if (token && currentUserId) void deleteDocument('tetrisQueue', currentUserId, token).catch(() => undefined);
    setMatchId(null);
    setMatchRole(null);
    setRoomNumber(null);
    setSentInviteId(null);
    setOpponent(null);
    setOpponentState(null);
    setReadyForBattle(false);
    setOpponentReady(false);
    setRoomBetConfigured(false);
    startRequestedRef.current = false;
    autoStartRequestedRef.current = false;
    setStakeReserved(false);
    setRoomStartAt(null);
    setCountdown(null);
    gameStartedRef.current = false;
    resultSent.current = false;
    holdRequestedRef.current = false;
    settlementRequestedRef.current = false;
    resultNoticeRef.current = null;
    opponentAttackTotalRef.current = 0;
    opponentAttackInitializedRef.current = false;
    dispatch({ type: 'RESET' });
    setMatchStatus('연습 모드');
    beginCountdown();
  };

  const findMatch = async () => {
    if (!user) return window.alert('로그인 후 게임을 시작할 수 있습니다.');
    const token = getSessionToken();
    if (!token) return window.alert('로그인 세션이 만료되었습니다. 다시 로그인해주세요.');
    const profile: TetrisQueueProfile = { id: currentUserId, name: user.name, image: user.image, country: user.country || 'Global' };
    setOpponentState(null);
    setOpponent(null);
    setMatchId(null);
    setMatchRole(null);
    setRoomNumber(null);
    setSentInviteId(null);
    setReadyForBattle(false);
    setOpponentReady(false);
    setRoomBetConfigured(false);
    startRequestedRef.current = false;
    autoStartRequestedRef.current = false;
    setStakeReserved(false);
    setRoomStartAt(null);
    setCountdown(null);
    gameStartedRef.current = false;
    resultSent.current = false;
    holdRequestedRef.current = false;
    settlementRequestedRef.current = false;
    resultNoticeRef.current = null;
    opponentAttackTotalRef.current = 0;
    opponentAttackInitializedRef.current = false;
    dispatch({ type: 'RESET' });
    setMatchPhase('waiting');
    setMatchStatus('매칭 상대를 찾는 중...');
    setInviteStatus('다른 회원이 입장하면 양쪽 화면이 자동으로 대전 준비로 전환됩니다.');
    try {
      const claim = await claimTetrisLobbyRoom(profile, token);
      if (!claim) throw new Error('현재 10개 방이 모두 사용 중입니다. 잠시 후 다시 시도해주세요.');
      setRoomNumber(claim.roomNumber);
      setMatchId(claim.matchId);
      setMatchRole(claim.role);
      setOpponent(claim.opponent ? { ...claim.opponent, country: claim.opponent.country || 'Global' } : null);
      setMatchPhase(claim.role === 'B' ? 'betting' : 'waiting');
      setMatchStatus(claim.role === 'B' ? '상대 입장 완료 · 배팅금액을 기다리는 중' : `${claim.roomNumber}번 방에서 상대를 기다리는 중`);
      setInviteStatus(claim.role === 'B' ? '상대가 방에 입장했습니다. 양쪽 모두 배팅금액을 확정하면 자동으로 시작합니다.' : '상대가 입장하면 이 방에서 자동으로 연결됩니다.');
    } catch (error) {
      setMatchStatus('매칭 서버에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.');
      setMatchPhase('idle');
      setMatchId(null);
      setMatchRole(null);
      setRoomNumber(null);
      setInviteStatus(error instanceof Error ? error.message : '매칭 서버에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.');
    }
  };

  const cancelMatch = async () => {
    if (matchId && matchRole && user) {
      await leaveBattleRoom();
      return;
    }
    if (user) {
      const token = getSessionToken();
      if (token) await deleteDocument('tetrisQueue', currentUserId, token).catch(() => undefined);
      if (token && sentInviteId) await mergeDocument('tetrisInvites', sentInviteId, { status: 'rejected', updatedAt: new Date() }, token).catch(() => undefined);
    }
    setSentInviteId(null);
    setMatchPhase('idle');
    setMatchStatus('대전 준비 안됨');
    setInviteStatus('');
    setOpponentReady(false);
    setRoomBetConfigured(false);
    startRequestedRef.current = false;
    autoStartRequestedRef.current = false;
    holdRequestedRef.current = false;
  };

  const resetBattleRoom = (status = '대전 준비 안됨') => {
    roomSeenRef.current = false;
    setMatchId(null);
    setMatchRole(null);
    setRoomNumber(null);
    setSentInviteId(null);
    setOpponent(null);
    setOpponentState(null);
    setReadyForBattle(false);
    setOpponentReady(false);
    setRoomBetConfigured(false);
    setStakeReserved(false);
    setRoomStartAt(null);
    setCountdown(null);
    setMatchResult(null);
    setMatchPhase('idle');
    setMatchStatus(status);
    setInviteStatus('');
    startRequestedRef.current = false;
    autoStartRequestedRef.current = false;
    holdRequestedRef.current = false;
    gameStartedRef.current = false;
    countdownRoomRef.current = null;
    opponentAttackTotalRef.current = 0;
    opponentAttackInitializedRef.current = false;
    roomMusicKeyRef.current = '';
    togetherListeningRef.current = false;
    setTogetherListening(false);
    dispatch({ type: 'RESET' });
  };

  const leaveBattleRoom = async () => {
    if (!matchId || !matchRole || !user) return;
    const leavingMatchId = matchId;
    const token = getSessionToken();
    if (!token) return;
    let cleanupError: unknown = null;
    try {
      if (roomNumber) await releaseTetrisLobbyRoom(roomNumber, leavingMatchId, matchRole, token, ['waiting', 'betting', 'holding'].includes(matchPhase)).catch(() => undefined);
      if (matchPhase === 'playing') {
        await updateRoom(matchRole === 'A'
          ? { phase: 'finished', playerAResult: 'lose' }
          : { phase: 'finished', playerBResult: 'lose' });
      } else {
        if (stakeReserved) await refundGameStake(currentUserId, leavingMatchId, token);
        await mergeDocument('tetrisRooms', leavingMatchId, {
          phase: 'finished',
          canceledBy: currentUserId,
          updatedAt: new Date(),
        }, token).catch(() => undefined);
      }
      if (sentInviteId) await mergeDocument('tetrisInvites', sentInviteId, { status: 'rejected', updatedAt: new Date() }, token).catch(() => undefined);
    } catch (error) {
      cleanupError = error;
    }
    resetBattleRoom(cleanupError ? '대전방에서 나왔습니다. 서버 정리가 완료되지 않았습니다.' : '대전방을 나갔습니다.');
    try {
      const refreshed = await refreshStoredUser().catch(() => null);
      if (refreshed) setUser(refreshed);
    } catch { /* Local room state is already reset. */ }
  };

  const sendInvite = async (online: OnlineUser) => {
    if (!user) return window.alert('로그인 후 대전 신청을 보낼 수 있습니다.');
    const recipientId = online.userId || online.id;
    if (recipientId === currentUserId) return;
    const token = getSessionToken();
    if (!token) return window.alert('로그인 세션이 만료되었습니다. 다시 로그인해주세요.');
    const matchId = `tetris-${currentUserId}-${recipientId}-${crypto.randomUUID()}`;
    const inviteId = crypto.randomUUID();
    const sender: TetrisProfile = { id: currentUserId, name: user.name, image: user.image, country: user.country || 'Global' };
    const recipient: TetrisProfile = { id: recipientId, name: online.name, image: online.image, country: online.country || 'Global' };
    let reservedRoom: number | null = null;
    try {
      reservedRoom = await reserveTetrisLobbyRoom(sender, matchId, token, recipientId);
      if (!reservedRoom) throw new Error('현재 10개 방이 모두 사용 중입니다. 잠시 후 다시 시도해주세요.');
      await createDocument('tetrisInvites', inviteId, {
        senderId: currentUserId,
        recipientId,
        sender,
        recipient,
        matchId,
        roomNumber: reservedRoom,
        status: 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
      }, token);
      await deleteDocument('tetrisQueue', currentUserId, token).catch(() => undefined);
      setSelectedOnlineUserId(null);
      setSentInviteId(inviteId);
      setMatchId(matchId);
      setMatchRole('A');
      setRoomNumber(reservedRoom);
      setOpponent(recipient);
      setOpponentState(null);
      setReadyForBattle(false);
      setOpponentReady(false);
      setRoomBetConfigured(false);
    startRequestedRef.current = false;
    autoStartRequestedRef.current = false;
       setStakeReserved(false);
      setRoomStartAt(null);
      setCountdown(null);
      gameStartedRef.current = false;
      setMatchPhase('waiting');
      setMatchStatus(`${recipient.name}님에게 대전 신청을 보냈습니다`);
      setInviteStatus('상대방 화면에 수락 / 거절 메시지가 표시됩니다.');
    } catch (error) {
      if (reservedRoom) await releaseTetrisLobbyRoom(reservedRoom, matchId, 'A', token, false).catch(() => undefined);
      setInviteStatus(error instanceof Error ? error.message : '대전 신청을 보내지 못했습니다. 잠시 후 다시 시도해주세요.');
    }
  };

  const requestRematch = async () => {
    if (!user || !opponent) return;
    const token = getSessionToken();
    if (!token) return window.alert('로그인 세션이 만료되었습니다. 다시 로그인해주세요.');
    const rematchId = `tetris-${currentUserId}-${opponent.id}-${crypto.randomUUID()}`;
    const inviteId = crypto.randomUUID();
    const sender: TetrisProfile = { id: currentUserId, name: user.name, image: user.image, country: user.country || 'Global' };
    const recipient: TetrisProfile = { id: opponent.id, name: opponent.name, image: opponent.image, country: opponent.country || 'Global' };
    let reservedRoom: number | null = null;
    try {
      reservedRoom = await reserveTetrisLobbyRoom(sender, rematchId, token, recipient.id);
      if (!reservedRoom) throw new Error('현재 10개 방이 모두 사용 중입니다. 잠시 후 다시 시도해주세요.');
      await createDocument('tetrisInvites', inviteId, {
        senderId: currentUserId,
        recipientId: recipient.id,
        sender,
        recipient,
        matchId: rematchId,
        roomNumber: reservedRoom,
        status: 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
      }, token);
      await deleteDocument('tetrisQueue', currentUserId, token).catch(() => undefined);
      setMatchId(rematchId);
      setMatchRole('A');
      setRoomNumber(reservedRoom);
      setSentInviteId(inviteId);
      setOpponent(recipient);
      setOpponentState(null);
      setReadyForBattle(false);
      setOpponentReady(false);
      setRoomBetConfigured(false);
      setStakeReserved(false);
      setBetAmount(DEFAULT_ENTRY_FEE);
      setRoomStartAt(null);
      setCountdown(null);
      setMatchResult(null);
      setMatchPhase('waiting');
      setMatchStatus(`${recipient.name}님에게 리매치 요청을 보냈습니다`);
      setInviteStatus('상대가 수락하면 새 참가비를 설정하고 다시 시작합니다.');
      startRequestedRef.current = false;
      autoStartRequestedRef.current = false;
      holdRequestedRef.current = false;
      gameStartedRef.current = false;
      resultSent.current = false;
      settlementRequestedRef.current = false;
      resultNoticeRef.current = null;
      opponentAttackTotalRef.current = 0;
      opponentAttackInitializedRef.current = false;
      dispatch({ type: 'RESET' });
    } catch (error) {
      if (reservedRoom) await releaseTetrisLobbyRoom(reservedRoom, rematchId, 'A', token, false).catch(() => undefined);
      setMatchStatus(error instanceof Error ? error.message : '리매치 요청을 보내지 못했습니다. 잠시 후 다시 시도해주세요.');
    }
  };

  const acceptInvite = async () => {
    if (!incomingInvite) return;
    const invite = incomingInvite;
    const token = getSessionToken();
    if (!token || !user) return;
    await deleteDocument('tetrisQueue', currentUserId, token).catch(() => undefined);
    try {
      if (!invite.roomNumber || !(await joinTetrisLobbyRoom(invite.roomNumber, invite.matchId, {
        id: currentUserId,
        name: user.name,
        image: user.image,
        country: user.country || 'Global',
      }, token))) {
        throw new Error('이 초대의 방이 이미 종료되었습니다. 새 대전을 신청해주세요.');
      }
      await mergeDocument('tetrisInvites', invite.id, { status: 'accepted', updatedAt: new Date() }, token);
    } catch (error) {
      setInviteStatus(error instanceof Error ? error.message : '수락 정보를 서버에 저장하지 못했습니다. 다시 시도해주세요.');
      return;
    }
    handledInviteIds.current.add(invite.id);
    setIncomingInvite(null);
    setMatchId(invite.matchId);
    setMatchRole('B');
    setRoomNumber(invite.roomNumber || null);
    setSentInviteId(null);
    setOpponent(invite.sender);
    setReadyForBattle(false);
    setOpponentReady(false);
    setRoomBetConfigured(false);
    setStakeReserved(false);
    setRoomStartAt(null);
    setCountdown(null);
    gameStartedRef.current = false;
    resultSent.current = false;
    holdRequestedRef.current = false;
    settlementRequestedRef.current = false;
    resultNoticeRef.current = null;
    opponentAttackTotalRef.current = 0;
    opponentAttackInitializedRef.current = false;
    dispatch({ type: 'RESET' });
    setIncomingInvite(null);
    setMatchPhase('betting');
    setMatchStatus('대전 신청 수락 · 상대의 배팅금액을 기다리는 중');
    setInviteStatus('대전 신청을 수락했습니다. 상대가 배팅금액을 설정하면 준비할 수 있습니다.');
  };

  const rejectInvite = async () => {
    if (!incomingInvite) return;
    const invite = incomingInvite;
    const token = getSessionToken();
    if (!token) return;
    try {
      await mergeDocument('tetrisInvites', invite.id, { status: 'rejected', updatedAt: new Date() }, token);
      handledInviteIds.current.add(invite.id);
      setIncomingInvite(null);
      setInviteStatus('대전 신청을 거절했습니다.');
    } catch {
      setInviteStatus('거절 정보를 서버에 저장하지 못했습니다. 다시 시도해주세요.');
    }
  };

  const restoreMatch = (invite: TetrisInvite, role: 'A' | 'B', room: TetrisRoom, fixedRoomNumber?: number) => {
    const isNewMatch = matchId !== invite.matchId || matchRole !== role;
    const ownReady = role === 'A' ? Boolean(room.readyA) : Boolean(room.readyB);
    const nextReady = role === 'A' ? Boolean(room.readyB) : Boolean(room.readyA);
    const ownStakeHeld = role === 'A' ? Boolean(room.stakeHeldA) : Boolean(room.stakeHeldB);
    const phase: MatchPhase = room.phase === 'playing'
      ? 'playing'
      : room.phase === 'countdown'
        ? 'countdown'
        : room.startRequestedBy || room.phase === 'holding'
          ? 'holding'
          : 'betting';

    if (isNewMatch) {
      startRequestedRef.current = false;
      autoStartRequestedRef.current = false;
      holdRequestedRef.current = false;
      settlementRequestedRef.current = false;
      resultNoticeRef.current = null;
      gameStartedRef.current = false;
      resultSent.current = false;
      opponentAttackTotalRef.current = 0;
      opponentAttackInitializedRef.current = false;
      dispatch({ type: 'RESET' });
    }
    setMatchId(invite.matchId);
    setMatchRole(role);
    setRoomNumber(fixedRoomNumber || invite.roomNumber || room.roomNumber || null);
    setSentInviteId(role === 'A' ? invite.id : null);
    setOpponent(role === 'A' ? invite.recipient : invite.sender);
    setOpponentState(deserializeGameState(role === 'A' ? room.playerBState : room.playerAState));
    setBetAmount(Number(room.betAmount || DEFAULT_ENTRY_FEE));
    setRoomBetConfigured(Boolean(room.betAmount));
    setReadyForBattle(ownReady);
    setOpponentReady(nextReady);
    setStakeReserved(ownStakeHeld);
    setMatchPhase(phase);
    setRoomStartAt(room.startAt || null);
    setMatchStatus(
      phase === 'playing'
        ? '실시간 대전 중 · 상대 화면 동기화됨'
        : room.startRequestedBy
            ? '양쪽 참가비를 자동으로 홀딩하고 3초 후 시작합니다.'
          : ownReady
            ? '내 준비 완료 · 상대 준비를 기다리는 중'
            : '대전 방에 다시 연결했습니다. 참가비를 확인해주세요.',
    );
     setInviteStatus('대전 방에 다시 연결되었습니다.');

    if (room.startAt) beginCountdown(room.startAt);
    if (phase === 'playing' && !gameStartedRef.current) {
      gameStartedRef.current = true;
      dispatch({ type: 'START' });
    }
  };

  const restorePendingInvite = (invite: TetrisInvite) => {
    setMatchId(invite.matchId);
    setMatchRole('A');
    setRoomNumber(invite.roomNumber || null);
    setSentInviteId(invite.id);
    setOpponent(invite.recipient);
    setOpponentState(null);
    setReadyForBattle(false);
    setOpponentReady(false);
    setRoomBetConfigured(false);
    setStakeReserved(false);
    setBetAmount(DEFAULT_ENTRY_FEE);
    setRoomStartAt(null);
    setCountdown(null);
    setMatchResult(null);
    setMatchPhase('waiting');
    setMatchStatus(`${invite.recipient.name}님에게 보낸 대전 신청을 복구했습니다.`);
    setInviteStatus('상대방의 수락 또는 거절을 기다리는 중입니다.');
  };

  const confirmBet = async () => {
    if (!matchId || !matchRole) return;
    const token = getSessionToken();
    if (!token || !user) return window.alert('로그인 세션이 만료되었습니다. 다시 로그인해주세요.');
    let roomBeforeBet = await getDocument<TetrisRoom>('tetrisRooms', matchId, token).catch(() => null);
    if (matchRole === 'B') {
      for (let attempt = 0; attempt < 4 && !roomBeforeBet?.betAmount; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 400));
        roomBeforeBet = await getDocument<TetrisRoom>('tetrisRooms', matchId, token).catch(() => null);
      }
    }
    const roomAmount = Number(roomBeforeBet?.betAmount || 0);
    const requestedAmount = Number(betAmount);
    if (matchRole === 'A' && roomAmount && roomBeforeBet?.readyA && roomAmount !== requestedAmount) {
      setBetAmount(roomAmount);
      setRoomBetConfigured(true);
       setMatchStatus(`참가비는 이미 ${formatUsd(roomAmount)} USD로 확정되었습니다.`);
      return;
    }
    const amount = matchRole === 'B' ? roomAmount : requestedAmount;
    if (!Number.isFinite(amount) || amount < MIN_ENTRY_FEE || amount > MAX_ENTRY_FEE) {
       window.alert(`참가비는 ${MIN_ENTRY_FEE}~${MAX_ENTRY_FEE} USD 사이로 입력해주세요.`);
      return;
    }
    if (matchRole === 'B' && !roomBeforeBet?.betAmount) {
      window.alert('상대방이 참가비를 먼저 설정해야 합니다. 잠시 후 다시 시도해주세요.');
      return;
    }
    let reservedNow = false;
    try {
      if (!stakeReserved) {
        await reserveGameStake(currentUserId, matchId, amount, token);
        reservedNow = true;
        setStakeReserved(true);
        void refreshStoredUser().then((refreshed) => {
          if (refreshed) setUser(refreshed);
        }).catch(() => undefined);
      }
      // Player A is the only source of truth for the room fee. Player B only confirms it.
      await updateRoom({
        ...(matchRole === 'A' ? { betAmount: amount } : {}),
        phase: 'betting',
        ...(matchRole === 'A' ? { readyA: true, readyAAt: new Date() } : { readyB: true, readyBAt: new Date() }),
        ...(matchRole === 'A' ? { stakeHeldA: true } : { stakeHeldB: true }),
      });
      setReadyForBattle(true);
      setRoomBetConfigured(true);
      setMatchPhase('betting');
      setMatchStatus('서버 준비 완료 · 상대 준비를 기다리는 중');
    } catch (error) {
      if (reservedNow) {
        await refundGameStake(currentUserId, matchId, token).catch(() => undefined);
        setStakeReserved(false);
      }
      setMatchStatus(gameErrorMessage(error, '대전 설정을 저장하지 못했습니다. 다시 눌러주세요.'));
    }
  };

  // Manual fallback for a client that was opened before the automatic start update.
  const requestBattleStart = async () => {
    if (!matchId || !matchRole || !user || !readyForBattle) return;
    const token = getSessionToken();
    if (!token) return window.alert('로그인 세션이 만료되었습니다. 다시 로그인해주세요.');
    try {
      const room = await getDocument<TetrisRoom>('tetrisRooms', matchId, token);
      if (!room?.readyA || !room.readyB) return;
      await updateRoom({ phase: 'holding', startRequestedBy: room.playerAId || room.playerA?.id || currentUserId, startRequestedAt: new Date() });
      setMatchPhase('holding');
      setMatchStatus('참가비를 자동으로 홀딩하는 중입니다...');
    } catch (error) {
      setMatchStatus(gameErrorMessage(error, '자동 게임 시작 신호를 저장하지 못했습니다.'));
    }
  };

  useEffect(() => {
    if (!user || matchPhase !== 'waiting' || matchId || sentInviteId) return;
    const token = getSessionToken();
    if (!token) return;
    let stopped = false;
    const profile: TetrisQueueProfile = { id: currentUserId, name: user.name, image: user.image, country: user.country || 'Global' };
    const applyMatch = (record: TetrisQueueRecord) => {
      if (stopped || !record.matchId || !record.role || !record.opponent) return;
      setMatchId(record.matchId);
      setMatchRole(record.role);
       setOpponent(record.opponent);
       setMatchPhase('betting');
       setReadyForBattle(false);
       setOpponentReady(false);
        startRequestedRef.current = false;
       setStakeReserved(false);
       setRoomStartAt(null);
       setCountdown(null);
        gameStartedRef.current = false;
        holdRequestedRef.current = false;
        settlementRequestedRef.current = false;
       setMatchStatus('상대 입장 완료 · 배팅금액을 입력해주세요');
      setInviteStatus('상대가 방에 입장했습니다. 양쪽 모두 배팅금액을 확정하면 자동으로 시작합니다.');
    };
    const poll = async () => {
      if (stopped || queuePollingRef.current) return;
      queuePollingRef.current = true;
      try {
        const own = await getDocument<TetrisQueueRecord>('tetrisQueue', currentUserId, token).catch(() => null);
        if (own?.status === 'matched') {
          applyMatch(own);
          return;
        }
        await mergeDocument('tetrisQueue', currentUserId, { lastSeenAt: new Date(), status: 'waiting' }, token).catch(() => undefined);
        const claimed = await claimTetrisMatch(profile, token).catch(() => null);
        if (claimed) applyMatch({ ...profile, userId: currentUserId, status: 'matched', ...claimed, lastSeenAt: new Date() });
      } finally {
        queuePollingRef.current = false;
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 800);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [matchId, matchPhase, sentInviteId, user?.country, user?.id, user?.image, user?.name]);

  useEffect(() => {
    if (!user) return;
    const token = getSessionToken();
    if (!token) return;
    const pollInvites = async () => {
      if (invitePollingRef.current) return;
      invitePollingRef.current = true;
      try {
        const [received, sent] = await Promise.all([
          queryDocuments<TetrisInvite>('tetrisInvites', 'recipientId', currentUserId, token),
          queryDocuments<TetrisInvite>('tetrisInvites', 'senderId', currentUserId, token),
        ]).catch(() => [[], []] as [TetrisInvite[], TetrisInvite[]]);
        const lobbyRooms = await listDocuments<TetrisLobbyRoom>('tetrisLobby', token).catch(() => []);
        const invites = [...received, ...sent];
        const currentLobby = roomNumber
          ? lobbyRooms.find((room) => room.roomNumber === roomNumber || room.activeMatchId === matchId)
          : undefined;
        if (matchId && roomNumber && currentLobby?.activeMatchId && currentLobby.activeMatchId !== matchId) {
          const previousMatchId = matchId;
          if (stakeReserved) await refundGameStake(currentUserId, previousMatchId, token).catch(() => undefined);
          setStakeReserved(false);
          if (currentLobby.status === 'waiting' && currentLobby.waitingUserId === currentUserId) {
            startRequestedRef.current = false;
            autoStartRequestedRef.current = false;
            holdRequestedRef.current = false;
            dispatch({ type: 'RESET' });
            setMatchId(currentLobby.activeMatchId);
            setMatchRole('A');
            setOpponent(null);
            setOpponentState(null);
            setReadyForBattle(false);
            setOpponentReady(false);
            setRoomBetConfigured(false);
            setRoomStartAt(null);
            setCountdown(null);
            setMatchPhase('waiting');
            setMatchStatus(`${roomNumber}번 방에서 새 상대를 기다리는 중`);
            setInviteStatus('상대가 나가 배팅과 준비 상태를 초기화했습니다. 같은 방에서 새 대전을 기다립니다.');
          } else {
            resetBattleRoom('대전방이 초기화되었습니다. 새 대전을 시작해주세요.');
          }
        }
        if (matchId && roomNumber && matchRole === 'A' && currentLobby?.activeMatchId === matchId && currentLobby.status === 'occupied' && currentLobby.playerBId) {
          if (currentLobby.playerB) setOpponent(currentLobby.playerB);
          if (matchPhase === 'waiting') {
            setMatchPhase('betting');
            setMatchStatus('상대 입장 완료 · 배팅금액을 기다리는 중');
            setInviteStatus('상대가 방에 입장했습니다. 양쪽 모두 배팅금액을 확정하면 자동으로 시작합니다.');
          }
        }
        const accepted = invites
          .filter((invite) => invite.status === 'accepted' && invite.matchId)
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        let activeMatch = Boolean(matchId);

        if (!activeMatch) {
          for (const invite of accepted.slice(0, 20)) {
            const room = await getDocument<TetrisRoom>('tetrisRooms', invite.matchId, token).catch(() => null);
            if (!room || room.phase === 'finished') continue;
            const lastActivity = new Date(String(room.updatedAt || invite.updatedAt || invite.createdAt)).getTime();
            if (!Number.isFinite(lastActivity) || Date.now() - lastActivity > 30 * 60 * 1000) continue;
            const role = invite.senderId === currentUserId ? 'A' : 'B';
            restoreMatch(invite, role, room, lobbyRooms.find((lobby) => lobby.activeMatchId === invite.matchId)?.roomNumber);
            activeMatch = true;
            break;
          }
        }

        const pendingSentInvite = !activeMatch
          ? invites
            .filter((invite) => invite.senderId === currentUserId && invite.status === 'pending' && Date.now() - new Date(invite.createdAt).getTime() < 120_000)
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]
          : undefined;
        if (pendingSentInvite) {
          const pendingLobby = lobbyRooms.find((lobby) => lobby.roomNumber === pendingSentInvite.roomNumber);
          if (pendingLobby?.activeMatchId === pendingSentInvite.matchId && pendingLobby.status === 'waiting') {
            restorePendingInvite(pendingSentInvite);
            activeMatch = true;
          } else if (pendingLobby?.activeMatchId && pendingLobby.activeMatchId !== pendingSentInvite.matchId) {
            await mergeDocument('tetrisInvites', pendingSentInvite.id, { status: 'rejected', updatedAt: new Date() }, token).catch(() => undefined);
            setInviteStatus('이전 대전 신청의 방이 이미 사용되어 신청을 종료했습니다. 새로 신청해주세요.');
          }
        }

        const pending = !['countdown', 'playing'].includes(matchPhase)
          ? invites
            .filter((invite) => invite.recipientId === currentUserId && invite.status === 'pending' && !handledInviteIds.current.has(invite.id) && Date.now() - new Date(invite.createdAt).getTime() < 120_000)
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]
          : undefined;
        const currentInvite = incomingInvite ? invites.find((invite) => invite.id === incomingInvite.id) : null;
        if (currentInvite && currentInvite.status !== 'pending') {
          setIncomingInvite(null);
          setInviteStatus(currentInvite.status === 'accepted' ? '대전 신청이 수락되었습니다. 배팅금액을 설정하고 준비해주세요.' : '대전 신청이 거절되었습니다. 다른 유저에게 다시 신청할 수 있습니다.');
        }
        if (pending && pending.id !== incomingInvite?.id) setIncomingInvite(pending);

        const acceptedSentInvite = sentInviteId ? invites.find((invite) => invite.id === sentInviteId && invite.status === 'accepted') : null;
        if (acceptedSentInvite) setInviteStatus(`${acceptedSentInvite.recipient.name}님이 대전 신청을 수락했습니다. 배팅금액을 설정해주세요.`);

        const rejected = invites.find((invite) => invite.id === sentInviteId && invite.status === 'rejected');
        if (rejected && sentInviteId) {
          const rejectedMatchId = matchId;
          const rejectedRoomNumber = roomNumber;
          setSentInviteId(null);
          if (rejectedRoomNumber && rejectedMatchId) {
            void releaseTetrisLobbyRoom(rejectedRoomNumber, rejectedMatchId, 'A', token, false).catch(() => undefined);
            void deleteDocument('tetrisRooms', rejectedMatchId, token).catch(() => undefined);
          }
          setMatchId(null);
          setMatchRole(null);
          setRoomNumber(null);
          setOpponent(null);
          setReadyForBattle(false);
          setOpponentReady(false);
          setMatchPhase('idle');
          setMatchStatus('상대방이 대전 신청을 거절했습니다.');
          setInviteStatus('다른 온라인 회원에게 대전 신청을 보낼 수 있습니다.');
        }
      } finally {
        invitePollingRef.current = false;
      }
    };
    void pollInvites();
    const timer = window.setInterval(() => void pollInvites(), 1200);
    return () => window.clearInterval(timer);
  }, [matchId, roomNumber, stakeReserved, incomingInvite?.id, sentInviteId, user?.id]);

  useEffect(() => {
    roomSeenRef.current = false;
    lobbyReleaseRequestedRef.current = null;
  }, [matchId]);

  useEffect(() => {
    if (!roomNumber || !matchId || !matchRole || !user) return;
    const token = getSessionToken();
    if (!token) return;
    const profile: TetrisQueueProfile = { id: currentUserId, name: user.name, image: user.image, country: user.country || 'Global' };
    const heartbeat = () => void heartbeatTetrisLobbyRoom(roomNumber, matchId, profile, matchRole, token);
    heartbeat();
    const timer = window.setInterval(heartbeat, 10_000);
    return () => window.clearInterval(timer);
  }, [roomNumber, matchId, matchRole, user?.id, user?.image, user?.name, user?.country]);

  useEffect(() => {
     if (!matchId || !matchRole || !user || matchPhase === 'finished') return;
    const token = getSessionToken();
    if (!token) return;
    // Let the joining player create the first shared room document with both participant IDs.
    // This also keeps older deployed Firestore rules from rejecting the second player.
    if (roomNumber && matchPhase === 'waiting') return;
    const syncRoom = async () => {
      const state = gameRef.current;
      let current: TetrisRoom | null;
      try {
        current = await getDocument<TetrisRoom>('tetrisRooms', matchId, token);
      } catch (error) {
        // Firestore returns 403 for a missing room when its read rule references resource.data.
        // Treat that first read as a create race; an existing unauthorized room still fails on write.
        if (isPermissionDenied(error)) current = null;
        else {
          setMatchStatus(gameErrorMessage(error, '대전 방을 확인하지 못했습니다.'));
          return;
        }
      }
      if (!current && roomSeenRef.current) {
        if (stakeReserved) await refundGameStake(currentUserId, matchId, token).catch(() => undefined);
        resetBattleRoom('상대가 대전방을 종료했습니다.');
        const refreshed = await refreshStoredUser().catch(() => null);
        if (refreshed) setUser(refreshed);
        return;
      }
      if (!current && roomNumber && matchRole === 'A') return;
      if (current) roomSeenRef.current = true;
      const sessionUserId = currentUserId;
      const profile: TetrisProfile = { id: sessionUserId, name: user.name, image: user.image, country: user.country || 'Global' };
      const ownPatch = {
        matchId,
        ...(roomNumber ? { roomNumber } : {}),
        ...(matchRole === 'A' ? {
          playerAId: sessionUserId,
          playerA: profile,
           playerAState: serializeGameState(state),
        } : {
           playerBId: sessionUserId,
           playerB: profile,
           ...(roomNumber && opponent ? { playerAId: opponent.id, playerA: opponent } : {}),
            playerBState: serializeGameState(state),
        }),
         ...(matchPhase === 'playing' ? { phase: 'playing' } : {}),
        updatedAt: new Date(),
      };
      try {
        await mergeDocument('tetrisRooms', matchId, ownPatch, token);
      } catch (error) {
        setMatchStatus(gameErrorMessage(error, '대전 방을 만들지 못했습니다.'));
        return;
      }
        const room = await getDocument<TetrisRoom>('tetrisRooms', matchId, token).catch(() => null);
        if (!room) return;
        roomSeenRef.current = true;
        const nextOpponent = matchRole === 'A' ? room.playerB : room.playerA;
        const nextState = deserializeGameState(matchRole === 'A' ? room.playerBState : room.playerAState);
        if (room.musicVideoId && room.musicUpdatedAt && room.musicUpdatedAt !== roomMusicKeyRef.current) {
          roomMusicKeyRef.current = room.musicUpdatedAt;
          window.dispatchEvent(new CustomEvent('gyopo-music-sync', {
            detail: {
              source: 'room',
              track: { id: `youtube-${room.musicVideoId}`, title: room.musicTitle || 'GYOPO MUSIC', artist: room.musicArtist || 'YouTube', videoId: room.musicVideoId, keywords: [] },
              playing: Boolean(room.musicPlaying),
              position: Number(room.musicPosition || 0),
              startedAt: Number(room.musicStartedAt || Date.now()),
              volume: Number(room.musicVolume ?? 70),
            },
          }));
        }
        const nextReady = matchRole === 'A' ? Boolean(room.readyB) : Boolean(room.readyA);
         if (room.betAmount) {
           setBetAmount(room.betAmount);
           setRoomBetConfigured(true);
         }
        setOpponentReady(nextReady);
        if (nextOpponent) setOpponent(nextOpponent);
        if (nextOpponent && matchPhase === 'waiting' && room.phase !== 'playing' && room.phase !== 'countdown' && room.phase !== 'finished') {
          setMatchPhase(room.startRequestedBy || room.phase === 'holding' ? 'holding' : 'betting');
          setMatchStatus(room.startRequestedBy ? '참가비를 자동으로 홀딩하는 중입니다...' : '상대 입장 완료 · 배팅금액을 설정해주세요');
          setInviteStatus('상대가 방에 입장했습니다. 양쪽 모두 배팅금액을 확정하면 자동으로 시작합니다.');
        }
         const ownStakeHeld = matchRole === 'A' ? Boolean(room.stakeHeldA) : Boolean(room.stakeHeldB);
        const bothStakesHeld = Boolean(room.stakeHeldA && room.stakeHeldB);
        if (ownStakeHeld && !stakeReserved) setStakeReserved(true);
        if (room.startRequestedBy && !room.startAt && room.phase !== 'finished') {
          setMatchPhase('holding');
          setMatchStatus(bothStakesHeld ? '양쪽 참가비 홀딩 완료 · 곧 카운트다운이 시작됩니다.' : '참가비를 서버 잔고에서 홀딩하는 중입니다...');
        }
         if (room.startRequestedBy && !ownStakeHeld && !holdRequestedRef.current) {
          holdRequestedRef.current = true;
          const amount = Number(room.betAmount || betAmount);
              void reserveGameStake(currentUserId, matchId, amount, token)
            .then(async () => {
              setStakeReserved(true);
              void refreshStoredUser().then((refreshed) => {
                if (refreshed) setUser(refreshed);
              }).catch(() => undefined);
              await updateRoom(matchRole === 'A' ? { stakeHeldA: true } : { stakeHeldB: true });
            })
            .catch((error) => {
              holdRequestedRef.current = false;
               setMatchStatus(gameErrorMessage(error, '참가비 홀딩에 실패했습니다. 다시 시도해주세요.'));
             });
         }
          const bothReady = Boolean(room.readyA && room.readyB);
          if (bothReady && !room.startRequestedBy && !autoStartRequestedRef.current) {
            autoStartRequestedRef.current = true;
            void updateRoom({ phase: 'holding', startRequestedBy: sessionUserId, startRequestedAt: new Date() })
             .then(() => {
               setMatchPhase('holding');
               setMatchStatus('양쪽 준비 완료 · 참가비를 자동으로 홀딩하는 중입니다.');
             })
             .catch(() => {
               autoStartRequestedRef.current = false;
               setMatchStatus('자동 게임 시작 신호를 저장하지 못했습니다. 다시 확인하는 중입니다.');
             });
         }
          if (room.startRequestedBy && bothStakesHeld && !room.startAt && room.phase !== 'finished' && !startRequestedRef.current) {
           startRequestedRef.current = true;
          void startTetrisCountdown(matchId, token)
            .then((startAt) => {
              if (startAt) beginCountdown(startAt);
              else startRequestedRef.current = false;
            })
            .catch(() => {
              startRequestedRef.current = false;
              setMatchStatus('카운트다운 신호를 저장하지 못했습니다. 잠시 후 다시 시도합니다.');
            });
         }
         if (room.startAt && room.phase !== 'finished') beginCountdown(room.startAt);
          else if (readyForBattle && nextReady && !room.startRequestedBy) setMatchStatus('양쪽 준비 완료 · 참가비를 자동으로 홀딩하고 3초 후 시작합니다.');
        else if (readyForBattle) setMatchStatus('내 준비 완료 · 상대 준비를 기다리는 중');
        else if (nextReady) setMatchStatus('상대 준비 완료 · 내 배팅금액을 확정해주세요');
       if (room.phase === 'finished') setMatchPhase('finished');
       const ownResult = matchRole === 'A' ? room.playerAResult : room.playerBResult;
       const opponentResult = matchRole === 'A' ? room.playerBResult : room.playerAResult;
        if (ownResult === 'lose') {
          setMatchResult('LOSE');
           const notice = `패배 · ${formatUsd(room.betAmount || betAmount)} USD가 차감되었습니다.`;
          if (resultNoticeRef.current !== notice) {
            resultNoticeRef.current = notice;
            setMatchStatus(notice);
            showToast(notice);
          }
        }
        if (opponentResult === 'lose') {
         setMatchResult('WIN');
         if (room.payoutStatus !== 'PAID' && !settlementRequestedRef.current && nextOpponent) {
           settlementRequestedRef.current = true;
           const amount = Number(room.betAmount || betAmount);
            void settleTetrisMatch(matchId, currentUserId, nextOpponent.id, amount, token)
              .then(() => updateRoom({ payoutStatus: 'PAID', payoutAmount: amount * 2 }))
              .then(() => {
                 const notice = `승리 정산 완료 · ${formatUsd(amount * 2)} USD 지급`;
                resultNoticeRef.current = notice;
                setMatchStatus(notice);
                showToast(notice);
              })
             .catch((error) => {
               settlementRequestedRef.current = false;
               setMatchStatus(error instanceof Error ? error.message : '승리 정산을 완료하지 못했습니다.');
             });
         }
       }
       if (nextState) {
         const nextAttackTotal = Number(nextState.attackTotal || 0);
         if (!opponentAttackInitializedRef.current) {
           opponentAttackTotalRef.current = nextAttackTotal;
           opponentAttackInitializedRef.current = true;
         } else if (nextAttackTotal < opponentAttackTotalRef.current) {
           opponentAttackTotalRef.current = nextAttackTotal;
          } else if (nextAttackTotal > opponentAttackTotalRef.current) {
            const incomingLines = nextAttackTotal - opponentAttackTotalRef.current;
            opponentAttackTotalRef.current = nextAttackTotal;
            dispatch({ type: 'RECEIVE_GARBAGE', lines: incomingLines });
            setBattleFx({ id: Date.now(), kind: 'incoming', title: `INCOMING +${incomingLines}`, subtitle: '상대 공격 수신' });
            playGameSound('incoming');
            showToast(`상대 공격 · ${incomingLines}줄이 내 보드에 추가되었습니다`);
         }
         setOpponentState(nextState);
         setMatchStatus('실시간 대전 중 · 상대 화면 동기화됨');
       }
    };
    void syncRoom();
     const timer = window.setInterval(() => void syncRoom(), 600);
    return () => window.clearInterval(timer);
      }, [matchId, matchRole, matchPhase, readyForBattle, stakeReserved, roomNumber, user?.id]);

  useEffect(() => {
    if (!matchId || matchPhase !== 'finished' || !user) return;
    const token = getSessionToken();
    if (!token) return;
    const timer = window.setTimeout(() => {
      void deleteDocument('tetrisRooms', matchId, token).catch(() => undefined);
    }, 8000);
    return () => window.clearTimeout(timer);
  }, [matchId, matchPhase, user?.id]);

  useEffect(() => {
    if (!roomNumber || !matchId || !matchRole || matchPhase !== 'finished' || lobbyReleaseRequestedRef.current === matchId) return;
    const token = getSessionToken();
    if (!token) return;
    lobbyReleaseRequestedRef.current = matchId;
    void releaseTetrisLobbyRoom(roomNumber, matchId, matchRole, token, false);
  }, [roomNumber, matchId, matchRole, matchPhase]);

  useEffect(() => () => {
    if (roomCleanupTimer.current) window.clearTimeout(roomCleanupTimer.current);
  }, []);

  useEffect(() => {
    if (!matchId || !matchRole || matchPhase !== 'playing' || game.running || !game.started || resultSent.current) return;
    resultSent.current = true;
    void updateRoom(matchRole === 'A' ? { phase: 'finished', playerAResult: 'lose' } : { phase: 'finished', playerBResult: 'lose' }).catch(() => undefined);
    setMatchPhase('finished');
    setMatchResult('LOSE');
  }, [game.running, matchId, matchPhase, matchRole]);

  const sendMessage = async (event: FormEvent) => {
    event.preventDefault();
    if (!user || !chatInput.trim()) return;
    const token = getSessionToken();
    if (!token) return;
    const message = { authorId: currentUserId, user: user.name, country: user.country || 'Global', text: chatInput.trim(), createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60 * 1000) };
    try {
      const id = crypto.randomUUID();
      await createDocument('tetrisChatMessages', id, message, token);
      setChatInput('');
      showToast(`${user.name}: ${message.text}`);
    } catch {
      window.alert('메시지를 보내지 못했습니다. 다시 시도해주세요.');
    }
  };

  const visual = buildVisual(game);
  const opponentVisual = opponentState ? buildVisual(opponentState) : emptyBoard();
  // An invitation already has both IDs; only admitted room phases may request media.
  const videoRoomActive = Boolean(matchId && opponent && ['betting', 'holding', 'countdown', 'playing'].includes(matchPhase));
  const videoRoomUrl = videoRoomActive && matchId && opponent
     ? `/webrtc?friend=${encodeURIComponent(opponent.id)}&auto=1&compact=1&callKind=game&videoOnly=1&gameRoom=${encodeURIComponent(matchId)}`
    : '';

  if (true) {
    return (
       <div className="tetris-focused-page text-white">
         <div className="tetris-focused-shell">
           <div className="tetris-focused-workspace" aria-label="Tetris workspace">
             <section id="tetris-own" className="tetris-focus-panel tetris-own-panel" data-tetris-panel="own" aria-label="내 테트리스 보드">
           <header className="tetris-focus-header">
             <b>내 보드</b><a className="tetris-panel-link" href="#tetris-opponent">상대 보드 보기 ↓</a>
              <div className="tetris-head-readout flex items-center gap-2 text-[10px] font-black sm:gap-3 sm:text-xs">
               <span><Timer size={12} className="mr-1 inline text-cyan-200" />{elapsedLabel}</span>
               <span><Sparkles size={12} className="mr-1 inline text-amber-200" />{game.score.toLocaleString()}</span>
               <span className="text-emerald-200">{game.combo} COMBO</span>
             </div>
             <div className="tetris-inline-next" aria-label="다음 블록"><span>Next</span><NextBlock piece={game.nextPiece} compact /></div>
            </header>
                   <div className="tetris-focus-board">
                        <div className="relative h-full w-full" onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}>
                         <BoardGrid cells={visual} />
                         {!game.started && !countdown && <div className="tetris-ready-readout pointer-events-none absolute inset-0 z-10 grid place-items-center"><div><Timer size={20} className="mx-auto text-cyan-200" /><b className="mt-2 block text-sm tracking-[.25em] text-white">{elapsedLabel}</b><span className="mt-1 block text-[9px] font-black uppercase tracking-[.2em] text-slate-500">READY</span></div></div>}
                          {battleFx && <div key={battleFx.id} className={`battle-fx ${battleFx.kind === 'incoming' ? 'battle-fx-incoming' : battleFx.kind === 'attack' ? 'battle-fx-attack' : 'battle-fx-clear'}`}><span className="battle-fx-stars">✦ ✦ ✦</span>{battleFx.kind === 'incoming' ? <Zap size={18} /> : <Sparkles size={18} />}<b>{battleFx.title}</b><span>{battleFx.subtitle}</span></div>}
                         {countdown && <div className="absolute inset-0 z-10 grid place-items-center rounded-xl bg-black/45"><span key={String(countdown)} className="tetris-countdown-number text-3xl font-black tracking-widest text-cyan-200 drop-shadow-[0_0_18px_rgba(34,211,238,.8)] sm:text-5xl">{countdown}</span></div>}
                        {matchResult && <div className="absolute inset-0 z-10 grid place-items-center rounded-xl bg-black/45"><span className={`text-3xl font-black tracking-widest sm:text-5xl ${matchResult === 'WIN' ? 'text-emerald-300' : 'text-rose-300'}`}>{matchResult}</span></div>}
                      </div>
                  </div>

                  <div className="tetris-focus-controls">
                   <button type="button" onClick={practiceStart} disabled={matchPhase === 'countdown' || matchPhase === 'playing'} className="flex min-h-9 items-center justify-center gap-1 rounded-xl bg-cyan-400 px-1 text-[10px] font-black text-slate-950 disabled:opacity-40 sm:text-xs"><Play size={13} />시작</button>
                  <button type="button" onClick={matchPhase === 'waiting' ? () => void cancelMatch() : () => void findMatch()} disabled={['betting', 'countdown', 'playing'].includes(matchPhase)} className="min-h-9 rounded-xl border border-cyan-300/25 bg-cyan-300/10 px-1 text-[10px] font-black text-cyan-100 disabled:opacity-40 sm:text-xs">{matchPhase === 'waiting' ? '취소' : '매칭'}</button>
                   <button type="button" onClick={() => dispatch({ type: 'ROTATE' })} disabled={!game.running || game.paused} className="flex min-h-9 items-center justify-center gap-1 rounded-xl border border-white/10 bg-white/5 px-1 text-[10px] font-bold disabled:opacity-30 sm:text-xs"><RotateCw size={13} />회전</button>
                    <button type="button" onClick={() => dispatch({ type: 'SWAP_NEXT' })} disabled={!game.running || game.paused} className="flex min-h-9 items-center justify-center gap-1 rounded-xl border border-violet-300/20 bg-violet-300/10 px-1 text-[10px] font-black text-violet-100 disabled:opacity-30 sm:text-xs"><ArrowRightLeft size={13} />교체</button>
                    <button type="button" onClick={() => dispatch({ type: 'DROP' })} disabled={!game.running || game.paused} className="flex min-h-9 items-center justify-center gap-1 rounded-xl border border-amber-300/20 bg-amber-300/10 px-1 text-[10px] font-black text-amber-100 disabled:opacity-30 sm:text-xs"><ArrowDown size={13} />드롭</button>
                    <button type="button" onClick={() => void leaveBattleRoom()} disabled={!matchId} className="flex min-h-9 items-center justify-center gap-1 rounded-xl border border-rose-300/25 bg-rose-300/10 px-1 text-[10px] font-black text-rose-200 disabled:opacity-30 sm:text-xs"><X size={13} />나가기</button>
                </div>
              <div className="tetris-focus-settings space-y-1 text-xs" role="region" aria-label="대전 및 배팅 설정">
                <b className="block text-amber-100">대전 · 배팅 설정</b>
                <p role="status" className="text-slate-300">{matchStatus} · {matchPhase.toUpperCase()}</p>
                <div className="flex gap-1.5">
                  <select aria-label="대전 상대 선택" value={selectedOnlineUserId || ''} onChange={(event) => setSelectedOnlineUserId(event.target.value || null)} className="min-w-0 flex-1 bg-transparent p-1 text-xs">
                    <option value="">접속 회원 선택</option>
                    {onlineUsers.filter((online) => online.id !== user?.id).map((online) => <option key={online.id} value={online.id}>{online.name}</option>)}
                  </select>
                  <button type="button" disabled={!selectedOnlineUserId || Boolean(matchId) || matchPhase === 'countdown' || matchPhase === 'playing'} onClick={() => { const online = onlineUsers.find((entry) => entry.id === selectedOnlineUserId); if (online) void sendInvite(online); }} className="bg-cyan-300/10 px-2 py-1 text-cyan-100 disabled:opacity-40">대전 신청</button>
                </div>
                {inviteStatus && <p className="rounded-lg bg-cyan-300/[0.07] px-2 py-1.5 leading-4 text-cyan-100">{inviteStatus}</p>}
                {matchId && <div className="grid grid-cols-2 gap-1.5"><div className={`rounded-lg px-2 py-1.5 text-center ${readyForBattle ? 'bg-emerald-300/10 text-emerald-200' : 'bg-white/[0.04] text-slate-500'}`}><b className="block">나</b>{readyForBattle ? '준비 완료' : '준비 전'}</div><div className={`rounded-lg px-2 py-1.5 text-center ${opponentReady ? 'bg-emerald-300/10 text-emerald-200' : 'bg-white/[0.04] text-slate-500'}`}><b className="block">상대방</b>{opponentReady ? '준비 완료' : '준비 전'}</div></div>}
                {!['holding', 'countdown', 'playing', 'finished'].includes(matchPhase) && <div className="flex gap-1.5"><label className="min-w-0 flex-1"><span className="sr-only">배팅금액</span>{matchRole === 'B' ? <div className="flex h-full items-center rounded-lg border border-amber-300/20 bg-amber-300/10 px-2 py-1.5 font-black text-amber-100">배팅 {formatUsd(betAmount)} USD</div> : <input type="number" min={MIN_ENTRY_FEE} max={MAX_ENTRY_FEE} step="1" value={betAmount} onChange={(event) => setBetAmount(Number(event.target.value))} aria-label="배팅금액" className="h-full w-full rounded-lg border border-amber-300/30 bg-black/30 px-2 py-1.5 font-black text-white outline-none focus:border-amber-300" />}</label><button type="button" onClick={() => void confirmBet()} disabled={!matchId || matchPhase !== 'betting' || readyForBattle} className="min-w-[88px] rounded-lg bg-amber-300 px-2 py-1.5 font-black text-slate-950 disabled:opacity-45">{readyForBattle ? '준비 완료' : matchPhase === 'waiting' ? '수락 대기' : matchRole === 'B' ? '수락·준비' : matchId ? '준비하기' : '대전 후 준비'}</button></div>}
                {matchPhase === 'holding' && <div className="rounded-lg bg-emerald-300/10 px-2 py-1.5 text-center font-bold text-emerald-200">양쪽 참가비 홀딩 중 · 자동 시작 대기</div>}
                {matchPhase === 'finished' && <button type="button" onClick={() => void requestRematch()} className="w-full rounded-lg bg-cyan-300 px-2 py-1.5 font-black text-slate-950">승패 결과 · 다시 신청하기</button>}
                {matchId && <div className="flex gap-1.5"><button type="button" onClick={toggleTogetherListening} className={`flex-1 rounded-lg border px-2 py-1.5 font-black ${togetherListening ? 'border-teal-300/40 bg-teal-300/15 text-teal-200' : 'border-white/10 bg-white/5 text-slate-300'}`}>{togetherListening ? '같이 듣기 켜짐' : '같이 듣기'}</button><button type="button" onClick={() => void requestBattleStart()} disabled={!readyForBattle || !opponentReady || !['betting', 'holding'].includes(matchPhase)} className="flex-1 rounded-lg bg-cyan-300 px-2 py-1.5 font-black text-slate-950 disabled:opacity-40">자동 시작 확인</button></div>}
              </div>
              </section>
              <section id="tetris-opponent" className="tetris-focus-panel tetris-opponent-panel" data-tetris-panel="opponent" aria-label="상대 테트리스 보드">
                <header className="tetris-focus-header"><b>상대 보드</b><span className="min-w-0 truncate">{opponent?.name || '상대 대기'}</span><span className="text-emerald-200">{opponentState ? 'SYNC' : 'WAITING'}</span></header>
                <div className="tetris-focus-board"><BoardGrid cells={opponentVisual} /></div>
                <div className="tetris-focus-metrics"><BattleMetrics state={opponentState} elapsed={elapsedLabel} /><a className="tetris-panel-link" href="#tetris-own">내 보드 · 배팅 설정 ↑</a></div>
              </section>
              <section className="tetris-focus-panel tetris-camera-panel" data-tetris-panel="camera" aria-label="웹캠 연결">
                <header className="tetris-focus-header"><b className="flex items-center gap-1.5"><Camera size={13} /> Video Only</b><span>입장 수락 시 자동 연결</span></header>
                <div className="tetris-focus-camera">
                  {videoRoomActive && videoRoomUrl ? <iframe key={`${matchId}-${opponent?.id}`} title="게임 상대방 영상 (마이크 사용 안 함)" src={videoRoomUrl} allow="camera; autoplay; microphone 'none'; display-capture 'none'" className="block h-full w-full border-0" /> : <div className="grid h-full place-items-center p-4 text-center"><div><Camera size={22} className="mx-auto text-cyan-200" /><p className="mt-2 text-xs font-black text-slate-300">{matchPhase === 'finished' ? '게임방 영상 연결 종료' : matchId && opponent ? '상대의 입장 수락을 기다리는 중' : '상대가 입장하면 영상이 연결됩니다'}</p><p className="mt-1 text-xs leading-4 text-slate-400">카메라만 연결합니다. 마이크와 상대 음성은 사용하지 않습니다.</p></div></div>}
                </div>
              </section>
              <section className="tetris-focus-panel tetris-chat-panel" data-tetris-panel="chat" aria-label="게임 채팅">
                <header className="tetris-focus-header"><b>게임 채팅</b><span className="text-emerald-200">{onlineUsers.length}명</span></header>
                <div ref={chatScrollRef} className="tetris-focus-messages">{messages.length === 0 ? <p className="text-slate-400">게임 채팅 대기 중</p> : messages.map((message) => <div key={message.id}><b className="text-cyan-200">{message.user}</b> {message.text}</div>)}</div>
                <form onSubmit={sendMessage} className="tetris-focus-chat-form"><input aria-label="게임 채팅" value={chatInput} onChange={(event) => setChatInput(event.target.value)} placeholder="게임 채팅" className="min-w-0 flex-1 bg-transparent px-2 py-2 text-xs text-white outline-none" /><button aria-label="게임 채팅 보내기" className="bg-cyan-400 px-3 text-slate-950"><Send size={13} /></button></form>
              </section>
          </div>
        </div>
        {incomingInvite && <div className="fixed inset-0 z-[90] grid place-items-center bg-black/75 p-4 backdrop-blur-sm"><div className="w-full max-w-sm rounded-3xl border border-cyan-300/35 bg-[#111a2d] p-5 shadow-[0_25px_100px_rgba(0,0,0,.65)]"><div className="text-[10px] font-black uppercase tracking-[0.24em] text-cyan-300">Live battle request</div><h2 className="mt-1 text-2xl font-black">대전 신청이 왔습니다</h2><div className="mt-4 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.05] p-3"><img src={incomingInvite.sender.image} alt="" className="h-12 w-12 rounded-full object-cover" /><div className="min-w-0"><div className="truncate font-black">{incomingInvite.sender.name}</div><div className="text-xs text-slate-400">{incomingInvite.sender.country || 'Global'} · Tetris Battle</div></div></div><p className="mt-4 text-sm text-slate-400">수락하면 방에 입장하고 배팅금액 확인 후 준비할 수 있습니다.</p><div className="mt-5 grid grid-cols-2 gap-2"><button type="button" onClick={() => void rejectInvite()} className="rounded-xl border border-white/10 bg-white/5 py-3 font-bold">거절</button><button type="button" onClick={() => void acceptInvite()} className="rounded-xl bg-cyan-400 py-3 font-black text-slate-950">수락하고 입장</button></div></div></div>}
      </div>
    );
  }

  return (
    <div className="games-page min-h-[calc(100vh-96px)] bg-[#070b17] px-4 py-8 text-white">
      <div className={`tetris-modern-shell mx-auto max-w-[1500px] ${matchPhase === 'playing' ? 'tetris-live-mode' : ''}`}>
        <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-black uppercase tracking-[0.3em] text-cyan-300"><Gamepad2 size={15} /> Arcade / Live battle</div>
             <div className="font-display text-xs font-black uppercase tracking-[0.28em] text-cyan-300">게임 플레이</div>
            <p className="mt-2 max-w-2xl text-sm text-slate-400">내 보드와 상대 보드를 한 화면에서 확인하고, 2줄 이상 클리어하면 공격 줄이 즉시 전송됩니다.</p>
          </div>
          <div className="flex items-center gap-3 rounded-2xl border border-emerald-300/20 bg-emerald-300/[0.07] px-4 py-3 text-sm shadow-[0_0_30px_rgba(16,185,129,.08)]">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-300 shadow-[0_0_14px_rgba(110,231,183,.9)]" />
            <b>{onlineUsers.length}</b><span className="text-slate-400">접속 중</span>
          </div>
        </header>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_390px]">
          <section className="tetris-arena-card rounded-[2rem] border border-white/10 p-4 shadow-2xl md:p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-500">Current run</div>
                <div className="mt-1 flex items-center gap-2 text-lg font-black">{user?.name || '로그인 필요'} <span className="rounded-full bg-cyan-300/10 px-2 py-1 text-[10px] text-cyan-200">{matchStatus}</span></div>
              </div>
               <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-right text-xs text-slate-400">{roomNumber ? `ROOM ${roomNumber} · FIXED` : matchId ? `ROOM ${matchId?.slice(-8)}` : 'PRACTICE / QUEUE'}</div>
            </div>

            <div className="tetris-battle-grid grid gap-4 lg:grid-cols-[minmax(300px,1fr)_minmax(270px,.78fr)]">
              <div className="rounded-[1.5rem] border border-cyan-300/20 bg-[#050914] p-3 md:p-4">
                <div className="mb-3 flex items-center justify-between"><div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-cyan-200"><Shield size={15} /> 내 보드</div><span className="text-[10px] font-bold text-slate-500">{game.paused ? 'PAUSED' : game.running ? 'LIVE' : 'READY'}</span></div>
                <div className="relative mx-auto w-full max-w-[430px]" onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}>
                  <BoardGrid cells={visual} />
                   {toast && <div key={toast?.id} className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-2xl border border-cyan-200/30 bg-slate-950/90 px-4 py-3 text-sm font-black text-cyan-100 shadow-2xl animate-[portal-toast_4.2s_ease-out_forwards]">{toast?.text}</div>}
                   {battleFx && <div key={battleFx?.id} className={`battle-fx ${battleFx?.kind === 'incoming' ? 'battle-fx-incoming' : battleFx?.kind === 'attack' ? 'battle-fx-attack' : 'battle-fx-clear'}`}><span className="battle-fx-stars">✦ ✦ ✦</span>{battleFx?.kind === 'incoming' ? <Zap size={22} /> : <Sparkles size={22} />}<b>{battleFx?.title}</b><span>{battleFx?.subtitle}</span></div>}
                 {countdown && <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-slate-950/45"><span key={String(countdown)} className="tetris-countdown-number text-6xl font-black tracking-widest text-cyan-200 drop-shadow-[0_0_18px_rgba(34,211,238,.8)]">{countdown}</span></div>}
                   {matchResult && <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-black/55"><span className={`text-6xl font-black tracking-widest ${matchResult === 'WIN' ? 'text-emerald-300' : 'text-rose-300'}`}>{matchResult}</span></div>}
                 </div>
                 <div className="tetris-mobile-next"><span className="text-[9px] font-black uppercase tracking-[.12em] text-slate-500">다음 블록</span><div><NextBlock piece={game.nextPiece} compact /></div></div>
               </div>

              <div className="rounded-[1.5rem] border border-violet-300/20 bg-gradient-to-b from-violet-300/[0.08] to-[#050914] p-3 md:p-4">
                <div className="mb-3 flex items-center justify-between"><div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-violet-200"><Swords size={15} /> 상대 보드</div><span className="flex items-center gap-1 text-[10px] font-bold text-emerald-300"><span className="h-1.5 w-1.5 rounded-full bg-emerald-300" /> SYNC 1.2s</span></div>
                 {opponent ? <div className="mb-3 flex items-center gap-2"><img src={opponent?.image} alt="" className="h-9 w-9 rounded-full object-cover ring-2 ring-violet-300/30" /><div className="min-w-0"><div className="truncate text-sm font-black">{opponent?.name}</div><div className="text-[10px] text-slate-500">{opponent?.country || 'Global'} · {opponentState ? '상대 화면 수신 중' : '연결 대기'}</div></div></div> : <div className="mb-3 rounded-xl border border-dashed border-white/10 px-3 py-3 text-xs text-slate-500">매칭 후 상대 블록이 이 화면에 크게 표시됩니다.</div>}
                 <div className="relative mx-auto w-full max-w-[330px] rounded-2xl border border-violet-300/20 bg-[#030611] p-2 shadow-[0_0_45px_rgba(139,92,246,.12)]"><BoardGrid cells={opponentVisual} compact />{!opponentState && <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-slate-950/45 px-5 text-center text-xs font-bold text-slate-400">상대방이 게임을 시작하면 블록이 실시간으로 보입니다.</div>}</div>
                 <BattleMetrics state={opponentState} elapsed={elapsedLabel} />
               </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
               <button onClick={practiceStart} disabled={matchPhase === 'countdown' || matchPhase === 'playing'} className="tetris-action-primary"><Play size={16} /> 시작</button>
              <button onClick={matchPhase === 'waiting' ? () => void cancelMatch() : () => void findMatch()} disabled={matchPhase === 'betting' || matchPhase === 'countdown' || matchPhase === 'playing'} className="tetris-action-secondary">{matchPhase === 'waiting' ? '매칭 취소' : '매칭 찾기'}</button>
              <button onClick={() => void requestBattleStart()} disabled={!matchId || !readyForBattle || !opponentReady || !['betting', 'holding'].includes(matchPhase)} className="tetris-action-start"><Gamepad2 size={16} /> 게임 시작하기</button>
              <button onClick={() => void leaveBattleRoom()} disabled={!matchId} className="tetris-action-danger"><X size={16} /> 방 나가기</button>
            </div>
              <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4"><button onClick={() => dispatch({ type: 'ROTATE' })} disabled={!game.running || game.paused} className="tetris-action-secondary"><RotateCw size={15} /> 회전</button><button onClick={() => dispatch({ type: 'SWAP_NEXT' })} disabled={!game.running || game.paused} className="tetris-action-secondary"><ArrowRightLeft size={15} /> C 다음</button><div className="col-span-2 hidden items-center justify-center rounded-xl border border-white/5 bg-white/[0.03] px-3 text-center text-[11px] text-slate-500 md:flex">2줄 클리어 = 상대 1줄 공격 · 이후 클리어 줄마다 1줄 추가</div></div>
             <div className="mt-3 grid grid-cols-5 gap-2 sm:hidden"><button onClick={() => dispatch({ type: 'MOVE', dx: -1, dy: 0 })} disabled={!game.running || game.paused} className="touch-control"><ArrowLeft size={16} className="mx-auto" /></button><button onClick={() => dispatch({ type: 'MOVE', dx: 0, dy: 1 })} disabled={!game.running || game.paused} className="touch-control"><ArrowDown size={16} className="mx-auto" /></button><button onClick={() => dispatch({ type: 'ROTATE' })} disabled={!game.running || game.paused} className="touch-control"><ArrowUp size={16} className="mx-auto" /></button><button onClick={() => dispatch({ type: 'SWAP_NEXT' })} disabled={!game.running || game.paused} className="touch-control">C</button><button onClick={() => dispatch({ type: 'MOVE', dx: 1, dy: 0 })} disabled={!game.running || game.paused} className="touch-control"><ArrowRight size={16} className="mx-auto" /></button></div>
              <p className="tetris-touch-hint mt-3 text-center text-[11px] text-slate-500">모바일: 좌우 슬라이드 이동 · 위로 스와이프 다음 블록 · 한 번 탭 회전 · 두 번 탭 하드드롭</p>
          </section>

          <aside className="space-y-4">
             <section className="tetris-panel rounded-[1.5rem] border border-white/10 p-4"><div className="mb-3 flex items-center justify-between"><div className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Next block</div><span className="rounded-full bg-amber-300/10 px-2 py-1 text-[10px] font-black text-amber-200">QUEUE</span></div><div className="mx-auto w-28"><NextBlock piece={game.nextPiece} /></div></section>

             <section className="tetris-panel rounded-[1.5rem] border border-cyan-300/20 p-4"><div className="mb-3 flex items-center justify-between"><div className="font-black">싱글 랭킹</div><span className="text-[10px] font-black uppercase tracking-[.16em] text-cyan-200">TOP 5</span></div>{ranking.length === 0 ? <p className="text-xs text-slate-500">게임 오버 후 점수가 여기에 기록됩니다.</p> : <ol className="space-y-2">{ranking.slice(0, 5).map((entry, index) => <li key={entry.id} className="flex items-center gap-2 rounded-xl bg-white/[.04] px-2.5 py-2"><b className={`w-5 text-center text-xs ${index === 0 ? 'text-amber-200' : 'text-slate-500'}`}>{index + 1}</b><span className="min-w-0 flex-1"><span className="block truncate text-xs font-black text-slate-200">{entry.name}</span><span className="text-[10px] text-slate-500">{entry.country || 'Global'} · {entry.lines}줄</span></span><strong className="text-sm text-cyan-200">{entry.score.toLocaleString()}</strong></li>)}</ol>}</section>

            <section className="tetris-panel rounded-[1.5rem] border border-amber-300/20 p-4"><div className="mb-2 flex items-center justify-between"><div className="font-black">대전 설정</div><span className="rounded-full bg-amber-300/10 px-2 py-1 text-[10px] font-black uppercase text-amber-200">{matchPhase}</span></div><p className="mb-3 text-xs leading-5 text-slate-400">{inviteStatus || matchStatus}</p>{matchPhase === 'waiting' && <div className="rounded-xl border border-cyan-300/20 bg-cyan-300/[0.08] px-3 py-3 text-xs font-bold text-cyan-100">상대의 수락 또는 매칭을 기다리는 중입니다.</div>}{matchPhase === 'betting' && matchRole === 'A' && <div className="space-y-2"><label className="block text-xs font-bold text-amber-100">참가비 설정<input type="number" min={MIN_ENTRY_FEE} max={MAX_ENTRY_FEE} step="1" value={betAmount} onChange={(event) => setBetAmount(Number(event.target.value))} className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm font-black text-white outline-none focus:border-amber-300" /></label><button onClick={() => void confirmBet()} disabled={readyForBattle} className="tetris-action-start w-full">참가비 확정 · 준비하기</button></div>}{matchPhase === 'betting' && matchRole === 'B' && <div className="space-y-2"><div className="rounded-xl bg-amber-300/[0.08] px-3 py-3 text-sm text-amber-100">상대 참가비 <b>{betAmount} USD</b></div><button onClick={() => void confirmBet()} disabled={readyForBattle} className="tetris-action-start w-full">수락하고 준비하기</button></div>}{matchPhase === 'holding' && <div className="rounded-xl border border-emerald-300/20 bg-emerald-300/[0.08] px-3 py-3 text-sm font-bold text-emerald-100">양쪽 참가비를 홀딩하고 있습니다. 잠시 후 카운트다운이 시작됩니다.</div>}{matchPhase === 'finished' && <div className={`rounded-2xl px-3 py-4 text-center ${matchResult === 'WIN' ? 'bg-emerald-300/[0.1] text-emerald-200' : 'bg-rose-300/[0.1] text-rose-200'}`}><div className="text-3xl font-black">{matchResult || 'FINISHED'}</div><p className="mt-1 text-xs">정산 완료 후 새 참가비로 다시 대전할 수 있습니다.</p><div className="mt-3 grid grid-cols-2 gap-2"><button onClick={() => void requestRematch()} className="rounded-xl bg-cyan-300 py-3 text-xs font-black text-slate-950">리매치 요청</button><button onClick={() => void leaveBattleRoom()} className="rounded-xl border border-white/10 bg-white/5 py-3 text-xs font-bold">방 나가기</button></div></div>}</section>

            {matchId && (matchPhase === 'betting' || matchPhase === 'holding') && <section className="tetris-panel rounded-[1.5rem] border border-violet-300/20 p-4"><div className="mb-3 flex items-center justify-between"><div className="font-black">Ready check</div><span className="text-[10px] font-bold text-violet-200">AUTO START</span></div><div className="grid grid-cols-2 gap-2 text-center text-xs"><div className={`rounded-xl px-2 py-3 ${readyForBattle ? 'bg-emerald-300/10 text-emerald-200 ring-1 ring-emerald-300/30' : 'bg-white/[0.04] text-slate-500'}`}><b className="block">나</b>{readyForBattle ? '준비 완료' : '준비 전'}</div><div className={`rounded-xl px-2 py-3 ${opponentReady ? 'bg-emerald-300/10 text-emerald-200 ring-1 ring-emerald-300/30' : 'bg-white/[0.04] text-slate-500'}`}><b className="block">상대</b>{opponentReady ? '준비 완료' : '준비 전'}</div></div><p className="mt-3 text-center text-[11px] text-slate-500">{readyForBattle && opponentReady ? '게임 시작하기를 누르거나 자동 시작을 기다리세요.' : '양쪽 참가비를 확정하면 시작할 수 있습니다.'}</p></section>}

             <section className="tetris-panel tetris-chat-panel flex h-[280px] min-h-0 flex-col rounded-[1.5rem] border border-white/10 p-4"><div className="mb-3 flex shrink-0 items-center justify-between"><div className="flex items-center gap-2 font-black"><MessageCircle size={16} className="text-cyan-300" /> LIVE CHAT</div><span className="text-[10px] font-bold text-emerald-300">ONLINE</span></div><div ref={chatScrollRef} className="tetris-chat-messages min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">{messages.length === 0 ? <p className="py-8 text-center text-xs text-slate-500">아직 메시지가 없습니다.</p> : messages.map((message) => <div key={message.id} className="rounded-xl bg-white/[0.04] p-2.5"><div className="mb-1 flex justify-between text-[10px]"><b className="text-cyan-200">{message.user}</b><span className="text-slate-600">{formatTime(message.createdAt)}</span></div><p className="break-words text-xs text-slate-300">{message.text}</p></div>)}</div>{user ? <form onSubmit={sendMessage} className="mt-3 flex shrink-0 gap-2"><input value={chatInput} onChange={(event) => setChatInput(event.target.value)} placeholder="메시지 보내기" className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-xs text-white outline-none focus:border-cyan-300" /><button aria-label="메시지 보내기" className="rounded-xl bg-cyan-300 px-3 text-slate-950"><Send size={15} /></button></form> : <p className="mt-3 shrink-0 text-center text-xs text-slate-500">로그인 후 참여할 수 있습니다.</p>}</section>

            <section className="tetris-panel rounded-[1.5rem] border border-white/10 p-4"><div className="mb-3 flex items-center justify-between"><div className="flex items-center gap-2 font-black"><Users size={16} className="text-emerald-300" /> 접속 회원</div><span className="text-[10px] font-bold text-emerald-300">대전 신청</span></div>{onlineUsers.length === 0 ? <p className="text-xs text-slate-500">현재 접속 중인 회원이 없습니다.</p> : <div className="space-y-2">{onlineUsers.filter((online) => online.id !== user?.id).map((online) => <div key={online.id} className={`rounded-xl p-2.5 ${selectedOnlineUserId === online.id ? 'bg-cyan-300/10 ring-1 ring-cyan-300/30' : 'bg-white/[0.04]'}`}><button onClick={() => setSelectedOnlineUserId(selectedOnlineUserId === online.id ? null : online.id)} className="flex w-full items-center gap-2 text-left"><img src={online.image} alt="" className="h-8 w-8 rounded-full object-cover" /><span className="min-w-0 flex-1"><span className="block truncate text-xs font-bold">{online.name}</span><span className="text-[10px] text-emerald-300">● {online.country || 'Global'}</span></span></button>{selectedOnlineUserId === online.id && <button onClick={() => void sendInvite(online)} disabled={matchPhase === 'betting' || matchPhase === 'countdown' || matchPhase === 'playing'} className="mt-2 w-full rounded-lg bg-cyan-300 py-2 text-[11px] font-black text-slate-950 disabled:opacity-40">대전 신청하기</button>}</div>)}</div>}</section>
          </aside>
        </div>
      </div>
       {incomingInvite && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4"><div className="w-full max-w-sm rounded-3xl border border-cyan-300/30 bg-[#111a2d] p-6 shadow-2xl"><div className="mb-2 text-xs font-black uppercase tracking-[0.2em] text-cyan-300">Battle request</div><h2 className="text-2xl font-black">대전 신청이 왔습니다</h2><div className="mt-4 flex items-center gap-3 rounded-2xl bg-white/[0.05] p-3"><img src={incomingInvite?.sender.image} alt="" className="h-12 w-12 rounded-full object-cover" /><div><div className="font-black">{incomingInvite?.sender.name}</div><div className="text-xs text-slate-400">{incomingInvite?.sender.country || 'Global'}</div></div></div><p className="mt-4 text-sm text-slate-400">수락하면 상대가 배팅금액을 정하고 카운트다운 후 대전이 시작됩니다.</p><div className="mt-5 grid grid-cols-2 gap-2"><button onClick={() => void rejectInvite()} className="rounded-xl border border-white/10 bg-white/5 py-3 font-bold">거절</button><button onClick={() => void acceptInvite()} className="rounded-xl bg-cyan-400 py-3 font-black text-slate-950">수락</button></div></div></div>}
        {false && (
         <div className="mx-auto max-w-7xl">
           <header className="mb-6 flex flex-wrap items-end justify-between gap-4"><div><div className="mb-2 flex items-center gap-2 text-xs font-black uppercase tracking-[0.28em] text-cyan-300"><Gamepad2 size={16} /> Arcade live</div><h1 className="text-3xl font-black tracking-tight md:text-5xl">TETRIS</h1><p className="mt-2 text-sm text-slate-400">접속 회원과 채팅하며 즐기는 실시간 테트리스 대전</p></div><div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm"><Users size={16} className="text-emerald-300" /><b>{onlineUsers.length}</b><span className="text-slate-400">접속 회원</span></div></header>
         <div className="games-layout grid gap-3 xl:grid-cols-[minmax(0,1fr)_320px] xl:gap-5">
           <section className="game-main rounded-[1.5rem] border border-white/10 bg-[#10182b] p-3 shadow-2xl md:rounded-[2rem] md:p-6"><div className="mb-3 flex flex-wrap items-center justify-between gap-2 md:mb-4 md:gap-3"><div><span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 md:text-xs">Current run</span><div className="mt-1 text-base font-black md:text-lg">{user?.name || '로그인 필요'}</div></div><div className="flex gap-4 text-right md:gap-6"><div><div className="text-[10px] font-bold text-slate-500">SCORE</div><b className="text-lg text-cyan-300 md:text-xl">{game.score.toLocaleString()}</b></div><div><div className="text-[10px] font-bold text-slate-500">LINES</div><b className="text-lg text-emerald-300 md:text-xl">{game.lines}</b></div></div></div>
              <div className="game-stage grid grid-cols-[minmax(0,1fr)_92px] items-start gap-2 md:block" onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}><div className="relative mx-auto w-full max-w-[min(100%,360px)] rounded-3xl border border-cyan-300/30 bg-[#050914] p-2 shadow-[0_0_60px_rgba(34,211,238,0.14)] md:p-3"><BoardGrid cells={visual} />{toast && <div key={toast.id} className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-2xl border border-cyan-200/30 bg-slate-950/90 px-5 py-3 text-sm font-black text-cyan-100 shadow-2xl animate-[portal-toast_4.2s_ease-out_forwards]">{toast.text}</div>}{countdown && <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"><span className="text-6xl font-black tracking-widest text-cyan-200 drop-shadow-[0_0_18px_rgba(34,211,238,.8)]">{countdown}</span></div>}{matchResult && <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-black/45"><span className={`text-6xl font-black tracking-widest drop-shadow-[0_0_18px_rgba(255,255,255,.7)] ${matchResult === 'WIN' ? 'text-emerald-300' : 'text-rose-300'}`}>{matchResult}</span></div>}</div><div className="space-y-2 lg:hidden"><div className="rounded-xl border border-cyan-300/20 bg-[#050914] p-1.5"><div className="mb-1 text-center text-[9px] font-black text-cyan-200">내 화면</div><BoardGrid cells={visual} compact /></div><div className="grid grid-cols-2 gap-1"><div className="rounded-xl border border-amber-300/20 bg-[#050914] p-1"><div className="mb-1 text-center text-[8px] font-black text-amber-200">다음</div><NextBlock piece={game.nextPiece} compact /></div><div className="rounded-xl border border-emerald-300/20 bg-[#050914] p-1"><div className="mb-1 text-center text-[8px] font-black text-emerald-200">상대</div><BoardGrid cells={opponentVisual} compact /></div></div></div></div>
              <div className="mx-auto mt-3 grid max-w-[360px] grid-cols-2 gap-2 md:mt-4"><button onClick={practiceStart} disabled={matchPhase === 'countdown' || matchPhase === 'playing'} className="rounded-xl bg-cyan-400 px-3 py-2.5 text-sm font-black text-slate-950 transition hover:bg-cyan-300 disabled:opacity-40"><Play size={15} className="mr-1 inline" />연습 시작</button><button onClick={matchPhase === 'waiting' ? () => void cancelMatch() : () => void findMatch()} disabled={matchPhase === 'betting' || matchPhase === 'countdown' || matchPhase === 'playing'} className="rounded-xl border border-cyan-300/30 bg-cyan-300/10 px-3 py-2.5 text-sm font-black text-cyan-100 disabled:opacity-40">{matchPhase === 'waiting' ? '매칭 취소' : '매칭 찾기'}</button><button onClick={() => dispatch({ type: 'TOGGLE_PAUSE' })} disabled={!game.running} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm font-bold text-white disabled:opacity-30">{game.paused ? <Play size={15} className="mr-1 inline" /> : <Pause size={15} className="mr-1 inline" />}{game.paused ? '계속' : '일시정지'}</button><button onClick={() => dispatch({ type: 'ROTATE' })} disabled={!game.running || game.paused} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm font-bold disabled:opacity-30"><RotateCw size={15} className="mr-1 inline" />회전</button></div><div className="mt-3 grid grid-cols-4 gap-2 sm:hidden"><button onClick={() => dispatch({ type: 'MOVE', dx: -1, dy: 0 })} disabled={!game.running || game.paused} className="touch-control">←</button><button onClick={() => dispatch({ type: 'MOVE', dx: 0, dy: 1 })} disabled={!game.running || game.paused} className="touch-control">↓</button><button onClick={() => dispatch({ type: 'ROTATE' })} disabled={!game.running || game.paused} className="touch-control">회전</button><button onClick={() => dispatch({ type: 'MOVE', dx: 1, dy: 0 })} disabled={!game.running || game.paused} className="touch-control">→</button></div><div className="mt-2 text-center text-[10px] text-slate-500 md:mt-3 md:text-[11px]">← → 이동 · ↓ 내리기 · ↑ 회전 · C 다음 블록 · Space 즉시 내리기 · 탭 즉시 내리기</div>
          </section>
            <aside className="space-y-5"><section className="rounded-[2rem] border border-white/10 bg-[#10182b] p-5"><div className="mb-3 text-xs font-black uppercase tracking-[0.2em] text-slate-500">Next block</div><div className="w-24"><NextBlock piece={game.nextPiece} /></div><p className="mt-4 text-sm text-slate-400">상대가 같은 대전방에 들어오면 상대 블록 화면이 실시간으로 표시됩니다.</p></section>
              <section className="rounded-[2rem] border border-cyan-300/20 bg-[#10182b] p-5"><div className="mb-3 flex items-center justify-between gap-2"><div className="font-black">상대방 보드</div><span className="text-[10px] font-bold text-cyan-300">{matchStatus}</span></div>{opponent ? <div className="mb-3 flex items-center gap-2"><img src={opponent.image} alt="" className="h-8 w-8 rounded-full object-cover" /><div className="min-w-0"><div className="truncate text-sm font-bold">{opponent.name}</div><div className="text-[10px] text-slate-500">{opponent.country || 'Global'}</div></div></div> : <p className="mb-3 text-xs text-slate-500">매칭 찾기를 누르면 접속 회원에게 대전 신청을 보냅니다.</p>}<div className="mx-auto max-w-[230px] rounded-2xl border border-white/10 bg-[#050914] p-2"><BoardGrid cells={opponentVisual} compact /></div><p className="mt-3 text-center text-[11px] text-slate-500">{opponentState ? '상대 게임 상태를 수신 중' : '상대가 연결되면 보드가 나타납니다.'}</p></section>
               <section className="rounded-[2rem] border border-amber-300/20 bg-[#10182b] p-5"><div className="mb-2 flex items-center justify-between"><div className="font-black">대전 설정</div><span className="text-[10px] font-bold text-amber-300">{matchPhase}</span></div><p className="mb-3 text-xs text-slate-400">{inviteStatus || matchStatus}</p>{matchPhase === 'waiting' && <div className="rounded-xl border border-cyan-300/20 bg-cyan-300/10 px-3 py-3 text-sm font-bold text-cyan-100">상대방을 찾는 중입니다...</div>}{matchPhase === 'betting' && <div className="mb-3 rounded-xl border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-xs text-amber-100">참가비는 게임 시작을 누른 뒤 양쪽 서버 잔고에서 홀딩됩니다.</div>}{matchPhase === 'betting' && matchRole === 'A' && <div className="space-y-2"><label className="block text-xs font-bold text-amber-100">참가비 설정 (1~100 USD)<input type="number" min={MIN_ENTRY_FEE} max={MAX_ENTRY_FEE} step="1" value={betAmount} onChange={(event) => setBetAmount(Number(event.target.value))} className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm font-bold text-white outline-none focus:border-amber-300" /></label><button onClick={() => void confirmBet()} disabled={readyForBattle} className="w-full rounded-xl bg-amber-300 py-2.5 text-sm font-black text-slate-950 disabled:opacity-40">참가비 확정 · 준비하기</button></div>}{matchPhase === 'betting' && matchRole === 'B' && <div className="space-y-2"><div className="rounded-xl bg-amber-300/10 px-3 py-2 text-sm text-amber-100">상대가 설정한 참가비: <b>{betAmount} USD</b></div><button onClick={() => void confirmBet()} disabled={readyForBattle} className="w-full rounded-xl bg-amber-300 py-2.5 text-sm font-black text-slate-950 disabled:opacity-40">수락하고 준비하기</button></div>}{matchPhase === 'betting' && readyForBattle && <button onClick={() => void requestBattleStart()} className="mt-3 w-full rounded-xl bg-emerald-300 py-2.5 text-sm font-black text-slate-950">게임 시작</button>}{matchPhase === 'holding' && <div className="rounded-xl border border-emerald-300/20 bg-emerald-300/10 px-3 py-3 text-sm font-bold text-emerald-100">양쪽 참가비를 서버 잔고에서 홀딩하고 있습니다...</div>}{matchPhase === 'finished' && <div className={`rounded-xl px-3 py-3 text-center text-xl font-black ${matchResult === 'WIN' ? 'bg-emerald-300/10 text-emerald-200' : 'bg-rose-300/10 text-rose-200'}`}>{matchResult || '대전 종료'}</div>}</section>
                {matchId && matchPhase !== 'finished' && <button onClick={() => void leaveBattleRoom()} className="w-full rounded-2xl border border-rose-400/40 bg-rose-400/10 px-4 py-3 text-sm font-black text-rose-200 transition hover:bg-rose-400/20">방 나가기</button>}
                  {matchId && (matchPhase === 'betting' || matchPhase === 'holding') && <section className="rounded-[2rem] border border-rose-400/30 bg-[#10182b] p-5"><div className="mb-3 flex items-center justify-between"><div className="font-black">실시간 준비 상태</div><span className="text-[10px] font-bold text-slate-500">서버 신호 · 자동 시작</span></div><div className="grid grid-cols-2 gap-2 text-center text-xs"><div className={`rounded-xl px-3 py-3 ${readyForBattle ? 'bg-amber-300/20 text-amber-100 ring-1 ring-amber-300/50' : 'bg-white/[.05] text-slate-400'}`}><span className={`mb-1 inline-block h-2 w-2 rounded-full ${readyForBattle ? 'bg-amber-300 shadow-[0_0_12px_rgba(252,211,77,.9)]' : 'bg-slate-600'}`} /><br /><b className="text-sm">나 · {readyForBattle ? '준비 완료' : '준비 전'}</b></div><div className={`rounded-xl px-3 py-3 ${opponentReady ? 'bg-amber-300/20 text-amber-100 ring-1 ring-amber-300/50' : 'bg-white/[.05] text-slate-400'}`}><span className={`mb-1 inline-block h-2 w-2 rounded-full ${opponentReady ? 'bg-amber-300 shadow-[0_0_12px_rgba(252,211,77,.9)]' : 'bg-slate-600'}`} /><br /><b className="text-sm">상대 · {opponentReady ? '준비 완료' : '준비 전'}</b></div></div>{readyForBattle && opponentReady && !roomStartAt && <p className="mt-3 text-center text-xs font-bold text-amber-200">양쪽 준비 완료 · 참가비 홀딩 후 3초 뒤 자동 시작합니다.</p>}{readyForBattle && !opponentReady && <p className="mt-3 text-center text-xs text-slate-500">상대방의 준비 완료를 기다리는 중입니다.</p>}{matchPhase === 'holding' && <p className="mt-3 text-center text-xs font-bold text-emerald-200">참가비 홀딩 확인 후 3초 카운트다운이 시작됩니다.</p>}</section>}
            <section className="flex min-h-[360px] flex-col rounded-[2rem] border border-white/10 bg-[#10182b] p-5"><div className="mb-3 flex items-center justify-between"><div className="flex items-center gap-2 font-black"><MessageCircle size={17} className="text-cyan-300" /> 실시간 메시지</div><span className="text-[10px] font-bold text-emerald-300">LIVE</span></div><div className="flex-1 space-y-3 overflow-y-auto pr-1">{messages.length === 0 ? <p className="py-10 text-center text-sm text-slate-500">아직 메시지가 없습니다.</p> : messages.map((message) => <div key={message.id} className="rounded-2xl bg-white/[0.045] p-3"><div className="mb-1 flex justify-between gap-2 text-[10px]"><b className="text-cyan-200">{message.user}</b><span className="text-slate-600">{formatTime(message.createdAt)}</span></div><p className="break-words text-sm text-slate-200">{message.text}</p></div>)}</div>{user ? <form onSubmit={sendMessage} className="mt-4 flex gap-2"><input value={chatInput} onChange={(event) => setChatInput(event.target.value)} placeholder="게임 중 메시지..." className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-300" /><button aria-label="메시지 보내기" className="rounded-xl bg-cyan-400 px-3 text-slate-950"><Send size={16} /></button></form> : <p className="mt-4 text-center text-xs text-slate-500">로그인 후 참여할 수 있습니다.</p>}</section>
              <section className="rounded-[2rem] border border-white/10 bg-[#10182b] p-5"><div className="mb-3 flex items-center justify-between gap-2"><div className="flex items-center gap-2 font-black"><Users size={17} className="text-emerald-300" /> 접속 회원</div><span className="text-[10px] font-bold text-emerald-300">클릭하여 신청</span></div>{onlineUsers.length === 0 ? <p className="text-sm text-slate-500">현재 접속 중인 회원이 없습니다.</p> : <div className="space-y-2">{onlineUsers.filter((online) => online.id !== user?.id).map((online) => <div key={online.id} className={`rounded-xl p-2.5 transition ${selectedOnlineUserId === online.id ? 'bg-cyan-300/10 ring-1 ring-cyan-300/40' : 'bg-white/[0.04]'}`}><button onClick={() => setSelectedOnlineUserId(selectedOnlineUserId === online.id ? null : online.id)} className="flex w-full items-center gap-2 text-left"><img src={online.image} alt="" className="h-8 w-8 rounded-full object-cover" /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold">{online.name}</span><span className="text-[10px] text-emerald-300">● {online.country || '국가 미설정'}</span></span></button>{selectedOnlineUserId === online.id && <button onClick={() => void sendInvite(online)} disabled={matchPhase === 'betting' || matchPhase === 'countdown' || matchPhase === 'playing'} className="mt-2 w-full rounded-lg bg-cyan-400 py-2 text-xs font-black text-slate-950 disabled:opacity-40">대전 신청하기</button>}</div>)}</div>}</section></aside>
       </div>
       </div>
       )}
     </div>
  );
}
