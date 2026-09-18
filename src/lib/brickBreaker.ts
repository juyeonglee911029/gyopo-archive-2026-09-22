export const WIDTH = 720;
export const HEIGHT = 780;
export const STEP = 1 / 120;
export type Mode = 'classic' | 'items';
export type Status = 'ready' | 'playing' | 'paused' | 'lost' | 'won';
export type Brick = { x: number; y: number; hp: number; color: string };
export type Particle = { x: number; y: number; vx: number; vy: number; life: number; color: string };
export type Drop = { x: number; y: number; kind: 'wide' | 'slow' | 'life' | 'missile' };
export type Missile = { x: number; y: number; vy: number };
export type Game = {
  mode: Mode; status: Status; score: number; lives: number; combo: number;
  paddle: number; target: number; wide: number; slow: number; narrow: number;
  level: number; attackTotal: number; attacksReceived: number; slowFactor: number;
  ball: { x: number; y: number; vx: number; vy: number };
  bricks: Brick[]; particles: Particle[]; drops: Drop[]; missiles: Missile[]; trail: { x: number; y: number }[];
  time: number; shake: number; message: string; seed: number;
};
export function createGame(mode: Mode, seed = 1, slowFactor = 0.68): Game {
  const colors = ['#fb7185', '#fb923c', '#facc15', '#a3e635', '#2dd4bf', '#818cf8'];
  return {
    mode, seed, status: 'ready', score: 0, lives: 3, combo: 0, paddle: 360, target: 360,
    wide: 0, slow: 0, narrow: 0, level: 1, attackTotal: 0, attacksReceived: 0, slowFactor,
    ball: { x: 360, y: 708, vx: 190, vy: -430 },
    bricks: Array.from({ length: 60 }, (_, i) => ({ x: 24 + i % 10 * 68, y: 92 + Math.floor(i / 10) * 34, hp: (i + seed % 60) % 60 < 20 ? 2 : 1, color: colors[(Math.floor(i / 10) + seed % 6) % 6] })),
    particles: [], drops: [], missiles: [], trail: [], time: 0, shake: 0, message: '',
  };
}
export function gameLevel(g: Game) { return 1 + Math.min(14, Math.floor(g.time / 12) + Math.floor(g.score / 300)); }
export function speedScale(g: Game) { return Math.min(1.85, 1 + (g.level - 1) * 0.065); }
export function launch(g: Game) {
  if (g.status === 'ready') { g.status = 'playing'; g.ball.vx = g.seed % 2 ? 190 : -190; g.ball.vy = -430 - g.level * 8; }
}
export function paddleWidth(g: Game) {
  const base = g.wide > 0 ? 164 : 112;
  return Math.max(58, g.narrow > 0 ? base * 0.58 : base);
}
export function burst(g: Game, x: number, y: number, color: string) {
  for (let i = 0; i < 18; i++) {
    const angle = i * Math.PI / 9;
    g.particles.push({ x, y, vx: Math.cos(angle) * (100 + i * 6), vy: Math.sin(angle) * 180, life: 0.72, color });
  }
  g.shake = 0.18;
}
export function stepGame(g: Game, dt = STEP) {
  if (g.status !== 'playing' && g.status !== 'ready') return;
  // Defensive cap also protects callers outside the animation accumulator.
  dt = Math.min(Math.max(dt, 0), STEP);
  g.time += dt; g.level = gameLevel(g); g.shake = Math.max(0, g.shake - dt);
  g.particles = g.particles.filter(p => { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 220 * dt; p.life -= dt; return p.life > 0; });
  g.wide = Math.max(0, g.wide - dt); g.slow = Math.max(0, g.slow - dt); g.narrow = Math.max(0, g.narrow - dt);
  const half = paddleWidth(g) / 2;
  g.paddle += (g.target - g.paddle) * Math.min(1, dt * 28);
  g.paddle = Math.max(half + 8, Math.min(WIDTH - half - 8, g.paddle));
  if (g.status === 'ready') { g.ball.x = g.paddle; g.ball.y = 708; return; }
  const b = g.ball, radius = 8, oldX = b.x, oldY = b.y;
  const speed = (g.slow > 0 ? g.slowFactor : 1) * speedScale(g);
  b.x += b.vx * dt * speed; b.y += b.vy * dt * speed;
  g.trail.unshift({ x: b.x, y: b.y }); g.trail.length = Math.min(12, g.trail.length);
  if (b.x < radius) { b.x = radius; b.vx = Math.abs(b.vx); }
  if (b.x > WIDTH - radius) { b.x = WIDTH - radius; b.vx = -Math.abs(b.vx); }
  if (b.y < radius) { b.y = radius; b.vy = Math.abs(b.vy); }
  if (b.vy > 0 && oldY + radius <= 724 && b.y + radius >= 724 && b.x >= g.paddle - half - radius && b.x <= g.paddle + half + radius) {
    const angle = Math.max(-1, Math.min(1, (b.x - g.paddle) / half)) * 1.05;
    const magnitude = Math.min(980, Math.max(320, Math.hypot(b.vx, b.vy) + 8 + g.level * 1.5));
    b.vx = Math.sin(angle) * magnitude; b.vy = -Math.cos(angle) * magnitude; b.y = 716;
    g.combo = 0; burst(g, b.x, 724, '#a3e635');
  }
  for (const brick of g.bricks) {
    if (!brick.hp || b.x + radius < brick.x || b.x - radius > brick.x + 60 || b.y + radius < brick.y || b.y - radius > brick.y + 24) continue;
    if (oldY + radius <= brick.y) { b.y = brick.y - radius; b.vy = -Math.abs(b.vy); }
    else if (oldY - radius >= brick.y + 24) { b.y = brick.y + 32; b.vy = Math.abs(b.vy); }
    else if (oldX < brick.x) { b.x = brick.x - radius; b.vx = -Math.abs(b.vx); }
    else { b.x = brick.x + 68; b.vx = Math.abs(b.vx); }
    brick.hp--; g.combo++; g.score += Math.round(10 * Math.min(g.combo, 8) * (1 + (g.level - 1) * 0.08));
    burst(g, brick.x + 30, brick.y + 12, brick.color);
    if (!brick.hp && g.mode === 'items' && g.bricks.filter(v => !v.hp).length % 3 === 0) {
      const n = g.bricks.filter(v => !v.hp).length / 3;
      g.drops.push({ x: brick.x + 30, y: brick.y + 12, kind: n % 7 === 0 ? 'life' : n % 5 === 0 ? 'missile' : n % 3 === 0 ? 'slow' : 'wide' });
    }
    break;
  }
  g.drops = g.drops.filter(drop => {
    drop.y += (170 + g.level * 10) * dt;
    if (drop.y >= 712 && drop.y <= 748 && Math.abs(drop.x - g.paddle) < half + 14) {
      if (drop.kind === 'wide') { g.wide = 14; g.message = '패들 확장!'; }
      if (drop.kind === 'slow') { g.slow = 12; g.message = `감속 ${Math.round((1 - g.slowFactor) * 100)}%`; }
      if (drop.kind === 'life') { g.lives = Math.min(5, g.lives + 1); g.message = '라이프 +1!'; }
      if (drop.kind === 'missile') { g.missiles.push({ x: g.paddle, y: 704, vy: -680 }); g.message = '미사일 발사!'; }
      burst(g, drop.x, drop.y, '#a3e635'); return false;
    }
    return drop.y < HEIGHT + 20;
  });
  g.missiles = g.missiles.filter((missile) => {
    missile.y += missile.vy * dt;
    if (missile.y <= 68) {
      g.attackTotal += 1;
      g.message = '미사일 명중 · 상대 압박';
      burst(g, missile.x, missile.y, '#67e8f9');
      return false;
    }
    return true;
  });
  if (g.bricks.every(brick => !brick.hp)) { g.status = 'won'; g.message = 'ALL CLEAR'; return; }
  if (b.y > HEIGHT + radius) {
    g.lives--; g.combo = 0; g.drops = []; g.missiles = []; g.trail = []; g.wide = 0; g.slow = 0;
    g.status = g.lives > 0 ? 'ready' : 'lost'; g.message = '';
    b.x = g.paddle; b.y = 708;
  }
}
export function applyAttack(g: Game, rows = 1) {
  if (g.status === 'lost' || g.status === 'won') return;
  const safeRows = Math.min(3, Math.max(1, Math.floor(rows)));
  const live = g.bricks.filter(brick => brick.hp);
  live.forEach(brick => { brick.y += 34 * safeRows; });
  g.narrow = Math.max(g.narrow, 9 + safeRows * 2);
  g.attacksReceived += safeRows;
  if (live.some(brick => brick.y + 24 >= 690)) {
    g.status = 'lost';
    g.message = '상대 압박 · 방어선 돌파';
    return;
  }
  const colors = ['#67e8f9', '#a78bfa', '#fb7185', '#facc15'];
  const empty = g.bricks.filter(brick => !brick.hp).slice(0, safeRows * 10);
  empty.forEach((brick, index) => {
    const column = index % 10;
    const row = Math.floor(index / 10);
    const gap = Math.abs((g.seed + g.attacksReceived + row * 3) % 10);
    brick.x = 24 + column * 68;
    brick.y = 92 + row * 34;
    brick.hp = column === gap ? 0 : 1;
    brick.color = colors[(g.attacksReceived + column + row) % colors.length];
  });
  g.message = `상대 미사일 · ${safeRows}줄 하강 · 패들 축소`;
  g.shake = 0.28;
}
export function drawGame(ctx: CanvasRenderingContext2D, g: Game, reducedMotion = false) {
  ctx.clearRect(0, 0, WIDTH, HEIGHT); ctx.save();
  if (g.shake > 0 && !reducedMotion) ctx.translate(Math.sin(g.time * 120) * 2, Math.cos(g.time * 98) * 2);
  ctx.fillStyle = '#090f1e'; ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.strokeStyle = '#ffffff06'; ctx.lineWidth = 1;
  for (let x = 24; x < WIDTH; x += 34) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, HEIGHT); ctx.stroke(); }
  for (let y = 24; y < HEIGHT; y += 34) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WIDTH, y); ctx.stroke(); }
  ctx.font = 'bold 12px sans-serif'; ctx.fillStyle = '#728098'; ctx.textAlign = 'left';
  ctx.fillText('SECTOR 01 / NEON GARDEN', 24, 40);
  ctx.textAlign = 'right'; ctx.fillText(`LEVEL ${g.level}  ·  ${g.bricks.filter(b => b.hp).length} BRICKS LEFT`, WIDTH - 24, 40);
  for (const b of g.bricks) {
    if (!b.hp) continue;
    ctx.fillStyle = b.color; ctx.globalAlpha = b.hp === 2 ? 1 : 0.8;
    ctx.beginPath(); ctx.roundRect(b.x, b.y, 60, 24, 5); ctx.fill();
    ctx.fillStyle = '#ffffff55'; ctx.fillRect(b.x + 5, b.y + 3, 50, 2);
    if (b.hp === 2) { ctx.fillStyle = '#090f1e77'; ctx.fillRect(b.x + 26, b.y + 10, 8, 4); }
  }
  ctx.globalAlpha = 1;
  if (!reducedMotion) {
    g.trail.forEach((p, i) => { ctx.globalAlpha = (1 - i / 12) * 0.3; ctx.fillStyle = '#b7f76a'; ctx.beginPath(); ctx.arc(p.x, p.y, 8 - i * 0.5, 0, Math.PI * 2); ctx.fill(); });
    g.particles.forEach(p => { ctx.globalAlpha = p.life / 0.6; ctx.fillStyle = p.color; ctx.fillRect(p.x, p.y, 4, 4); });
  }
  ctx.globalAlpha = 1;
  for (const d of g.drops) {
    ctx.fillStyle = d.kind === 'life' ? '#fb7185' : d.kind === 'slow' ? '#67e8f9' : d.kind === 'missile' ? '#c084fc' : '#a3e635';
    ctx.beginPath(); ctx.roundRect(d.x - 16, d.y - 12, 32, 24, 6); ctx.fill();
    ctx.fillStyle = '#090f1e'; ctx.textAlign = 'center'; ctx.font = 'bold 15px sans-serif'; ctx.fillText(d.kind === 'life' ? '+' : d.kind === 'slow' ? 'S' : d.kind === 'missile' ? 'M' : 'W', d.x, d.y + 5);
  }
  g.missiles.forEach(missile => { ctx.strokeStyle = '#67e8f9'; ctx.lineWidth = 4; ctx.shadowBlur = reducedMotion ? 0 : 14; ctx.shadowColor = '#67e8f9'; ctx.beginPath(); ctx.moveTo(missile.x, missile.y + 18); ctx.lineTo(missile.x, missile.y - 10); ctx.stroke(); ctx.fillStyle = '#e0f2fe'; ctx.beginPath(); ctx.moveTo(missile.x, missile.y - 15); ctx.lineTo(missile.x - 6, missile.y - 3); ctx.lineTo(missile.x + 6, missile.y - 3); ctx.closePath(); ctx.fill(); });
  ctx.shadowBlur = reducedMotion ? 0 : 18; ctx.shadowColor = '#b5f66a'; ctx.fillStyle = '#b5f66a';
  ctx.beginPath(); ctx.roundRect(g.paddle - paddleWidth(g) / 2, 724, paddleWidth(g), 13, 6); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(g.ball.x, g.ball.y, 8, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0; ctx.fillStyle = '#fb718533'; ctx.fillRect(0, HEIGHT - 2, WIDTH, 2);
  ctx.restore();
}
