import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (path) => readFileSync(join(root, path), 'utf8');

function section(source, start, end) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `missing section start: ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `missing section end: ${end}`);
  return source.slice(from, to);
}

test('fresh Tetris match entry paths reset the entry fee to its zero default', () => {
  const page = read('src/app/games/page.tsx');
  const entryPaths = [
    ['const findMatch = async () => {', 'const cancelMatch = async () => {'],
    ['const sendInvite = async (online: OnlineUser) => {', 'const requestRematch = async () => {'],
    ['const requestRematch = async () => {', 'const acceptInvite = async () => {'],
    ['const acceptInvite = async () => {', 'const rejectInvite = async () => {'],
    ['const restorePendingInvite = (invite: TetrisInvite) => {', 'const confirmBet = async () => {'],
    ['const applyMatch = (record: TetrisQueueRecord) => {', 'const poll = async () => {'],
  ];

  for (const [start, end] of entryPaths) {
    assert.match(section(page, start, end), /setBetAmount\(DEFAULT_ENTRY_FEE\)/, start);
  }

  const lobbyReset = section(
    page,
    "if (currentLobby.status === 'waiting' && currentLobby.waitingUserId === currentUserId) {",
    '} else {',
  );
  assert.match(lobbyReset, /setBetAmount\(DEFAULT_ENTRY_FEE\)/);
});

test('Tetris boards, compact metrics, and chat share responsive layout invariants', () => {
  const css = read('public/styles/tetris-refinements.css');
  const page = read('src/app/games/page.tsx');

  assert.match(page, /state\?\.score\.toLocaleString\(\)/);
  assert.match(css, /grid-template-columns: minmax\(220px, 0\.8fr\) repeat\(2, minmax\(0, 1fr\)\) !important;/);
  assert.match(css, /\.tetris-own-panel,\s*\.tetris-opponent-panel\s*\{[^}]*width: 100%;[^}]*align-self: stretch;/s);
  assert.match(css, /\.tetris-own-panel > \.tetris-focus-header,\s*\.tetris-opponent-panel > \.tetris-focus-header\s*\{[^}]*grid-template-columns: minmax\(4\.5rem, 0\.8fr\) minmax\(0, 1fr\) 3\.25rem !important;[^}]*height: 3\.25rem;/s);
  assert.match(css, /\.tetris-battle-metrics\s*\{[^}]*grid-template-columns: repeat\(5, minmax\(0, 1fr\)\)/s);
  assert.match(css, /grid-template-rows: 3\.25rem minmax\(0, 1fr\) 5\.75rem !important;/);
  assert.match(css, /grid-template-rows: 3\.25rem minmax\(0, 1fr\) 6\.5rem !important;/);
  assert.match(css, /\.tetris-battle-stat > b\s*\{[^}]*font-size: 0\.68rem !important;/s);
  assert.match(css, /grid-template-rows: minmax\(6\.5rem, 0\.75fr\) minmax\(0, max-content\) minmax\(12rem, 1\.4fr\) !important;/);
  assert.match(css, /\.tetris-focus-messages\s*\{[^}]*flex: 1;[^}]*overflow-y: auto;/s);
  assert.match(css, /\.tetris-chat-panel\s*\{[^}]*height: clamp\(16rem,[^}]*env\(safe-area-inset-bottom\)/s);
  assert.match(css, /padding-bottom: calc\(4\.5rem \+ env\(safe-area-inset-bottom\)\)/);
});

test('Tetris video-only calls explain that each camera requires an explicit start', () => {
  const game = read('src/app/games/page.tsx');
  const call = read('src/app/webrtc/page.tsx');
  const cameraPanel = section(game, 'data-tetris-panel="camera"', 'data-tetris-panel="settings"');

  assert.match(cameraPanel, /각자 직접 시작/);
  assert.match(cameraPanel, /각자 카메라를 직접 시작해야 연결됩니다/);
  assert.match(call, /videoOnly \? '카메라 시작' : '카메라·마이크 시작'/);
});

test('Badball mirrors its board frames and preserves the game canvas aspect ratio', () => {
  const css = read('src/components/games/brickbreaker.module.css');

  assert.match(css, /\.grid\s*\{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/s);
  assert.match(css, /\.grid > \[data-game-panel="own"\] > \.bar:first-child,[\s\S]*?\.grid > \[data-game-panel="opponent"\] > \.bar:first-child\s*\{[^}]*grid-template-columns:/);
  assert.match(css, /\.grid > \[data-game-panel="own"\], \.grid > \[data-game-panel="opponent"\] \{ min-height: 20rem; \}/);
  assert.match(css, /\.canvas\s*\{[^}]*aspect-ratio: 12 \/ 13;/s);
  assert.match(css, /\.messages\s*\{[^}]*flex: 1;[^}]*min-height: 0;[^}]*overflow-y: auto;/s);
  assert.match(css, /@media \(max-width: 800px\)\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);[\s\S]*?min-height: 2\.5rem;/);
});
