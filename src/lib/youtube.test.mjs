import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { createYouTubeController } from './youtube.ts';
import { createMusicPlayback, revealMusicPlayer } from './musicPlayback.ts';
import { MUSIC_TRACKS, readMusicVolume } from './music.ts';

const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
const host = () => ({ ownerDocument: { createElement: () => ({}) }, replaceChildren() {} });
function setGlobal(t, name, value) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  t.after(() => { if (previous) Object.defineProperty(globalThis, name, previous); else delete globalThis[name]; });
}
function fakeSDK() {
  const players = [];
  class Player {
    constructor(_host, options) {
      this.options = options;
      this.id = options.videoId;
      this.calls = [];
      this.state = -1;
      this.time = 0;
      this.volume = 100;
      this.muted = false;
      this.delayAudio = false;
      this.iframe = { tabIndex: 0 };
      players.push(this);
    }
    ready() { this.options.events.onReady({ target: this }); }
    stateChange(state) { this.state = state; this.options.events.onStateChange({ data: state }); }
    blocked() { this.options.events.onAutoplayBlocked(); }
    error(data) { this.options.events.onError({ data }); }
    playVideo() { this.calls.push(['play']); }
    pauseVideo() { this.calls.push(['pause']); }
    mute() { if (!this.delayAudio) this.muted = true; this.calls.push(['mute']); }
    unMute() { if (!this.delayAudio) this.muted = false; this.calls.push(['unmute']); }
    setVolume(n) { if (!this.delayAudio) this.volume = n; this.calls.push(['volume', n]); }
    cueVideoById(id) { this.id = id; this.calls.push(['cue', id]); }
    loadVideoById(id) { this.id = id; this.calls.push(['load', id]); }
    getPlayerState() { return this.state; }
    getCurrentTime() { return this.time; }
    getVolume() { return this.volume; }
    isMuted() { return this.muted; }
    getVideoData() { return { video_id: this.id }; }
    getIframe() { return this.iframe; }
    destroy() { this.calls.push(['destroy']); }
  }
  return { sdk: { Player }, players };
}
function setup(t, options = {}) {
  const fake = fakeSDK();
  const changes = [];
  const controller = createYouTubeController(host(), {
    videoId: 'first', volume: 70, origin: 'https://preview.example', loadSDK: async () => fake.sdk,
    onChange: (s) => changes.push(s), ...options,
  });
  t.after(() => controller.destroy());
  return { ...fake, changes, controller };
}
const starts = (player) => player.calls.filter(([call]) => call === 'play' || call === 'load');

test('queued click waits for official readiness and does not fake playing', async (t) => {
  const { controller, players } = setup(t);
  controller.setPlaying(true);
  controller.setTrack('latest');
  controller.setVolume(31);
  await flush();
  const player = players[0];
  assert.deepEqual(player.calls, []);
  assert.equal(controller.getSnapshot().status, 'loading');
  assert.equal(player.options.playerVars.origin, 'https://preview.example');
  assert.equal(player.options.playerVars.autoplay, 0);
  assert.equal(player.options.playerVars.controls, 1);
  player.ready();
  assert.deepEqual(player.calls, [['volume', 31], ['unmute'], ['load', 'latest']]);
  assert.notEqual(controller.getSnapshot().status, 'playing');
  player.time = 12.5;
  player.stateChange(1);
  assert.equal(controller.getSnapshot().status, 'playing');
  assert.equal(controller.getSnapshot().currentTime, 12.5);
  player.stateChange(2);
  assert.equal(controller.getSnapshot().desiredPlaying, false);
});

test('rapid play/pause before readiness cancels the queued start', async (t) => {
  const { controller, players } = setup(t);
  controller.setPlaying(true);
  controller.setPlaying(false);
  await flush();
  players[0].ready();
  assert.deepEqual(starts(players[0]), []);
  assert.equal(controller.getSnapshot().desiredPlaying, false);
  controller.setPlaying(true);
  controller.setPlaying(false);
  players[0].stateChange(1); // A late start acknowledgement must not undo cancellation.
  assert.notEqual(controller.getSnapshot().status, 'playing');
  assert.deepEqual(players[0].calls.at(-1), ['pause']);
});

test('blocked playback stops intent, never loops, and permits explicit/native retry', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const { controller, players } = setup(t);
  await flush();
  const player = players[0];
  player.ready();
  controller.setPlaying(true);
  player.blocked();
  const count = starts(player).length;
  t.mock.timers.tick(2000);
  assert.equal(starts(player).length, count);
  assert.equal(controller.getSnapshot().status, 'blocked');
  assert.equal(controller.getSnapshot().desiredPlaying, false);
  controller.setPlaying(true);
  assert.equal(starts(player).length, count + 1);
  player.blocked();
  player.stateChange(1); // Native YouTube Play is also a valid user-controlled recovery.
  assert.equal(controller.getSnapshot().status, 'playing');
  assert.equal(controller.getSnapshot().error, '');
});

test('zero volume is respected, missing storage is 70, and play leaves audio settings alone', async (t) => {
  assert.equal(readMusicVolume(null), 70);
  assert.equal(readMusicVolume('0'), 0);
  const { controller, players } = setup(t, { volume: 0 });
  await flush();
  players[0].ready();
  const beforePlay = players[0].calls.length;
  controller.setPlaying(true);
  assert.deepEqual(players[0].calls.slice(beforePlay), [['play']]);
  assert.equal(players[0].muted, true);
  controller.setVolume(42);
  assert.deepEqual(players[0].calls.slice(-2), [['volume', 42], ['unmute']]);
});

test('errors require retry; stale events from replaced players are ignored', async (t) => {
  const { controller, players } = setup(t);
  await flush();
  players[0].ready();
  controller.setPlaying(true);
  players[0].error(150);
  assert.equal(controller.getSnapshot().status, 'error');
  assert.equal(controller.getSnapshot().desiredPlaying, false);
  assert.match(controller.getSnapshot().error, /150/);
  controller.setPlaying(true);
  players[0].stateChange(1);
  players[0].blocked();
  await flush();
  assert.equal(controller.getSnapshot().status, 'loading');
  assert.deepEqual(players[0].calls.at(-1), ['destroy']);
  players[1].ready();
  players[1].stateChange(1);
  assert.equal(controller.getSnapshot().status, 'playing');
});

test('ready timeout reports failure, and explicit retry creates a fresh player', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const { controller, players } = setup(t);
  await flush();
  controller.setPlaying(true);
  t.mock.timers.tick(15001);
  assert.equal(controller.getSnapshot().status, 'error');
  players[0].ready();
  assert.equal(controller.getSnapshot().ready, false);
  controller.setPlaying(true);
  await flush();
  players[1].ready();
  assert.equal(starts(players[1]).length, 1);
});

test('SDK rejection is recoverable, but resolving after unmount creates no iframe', async (t) => {
  const fake = fakeSDK();
  let resolve;
  let attempts = 0;
  const { controller } = setup(t, { loadSDK: () => ++attempts === 1 ? Promise.reject(new Error('offline')) : new Promise((r) => { resolve = r; }) });
  await flush();
  assert.equal(controller.getSnapshot().status, 'error');
  controller.setPlaying(true);
  controller.destroy();
  resolve(fake.sdk);
  await flush();
  assert.equal(fake.players.length, 0);
});

test('ended only advances after actual playback, once per track', async (t) => {
  let ended = 0;
  const { controller, players } = setup(t, { onEnded: () => ended++ });
  await flush();
  players[0].ready();
  controller.setPlaying(true);
  players[0].stateChange(0);
  assert.equal(ended, 0);
  players[0].stateChange(1);
  players[0].stateChange(0);
  players[0].stateChange(0);
  assert.equal(ended, 1);
});

function sessionSetup(t) {
  const fake = fakeSDK();
  const session = createMusicPlayback((element, options) => createYouTubeController(element, {
    ...options, origin: 'https://www.gyopo.kr', loadSDK: async () => fake.sdk,
  }));
  session.setRoute('top');
  t.after(() => session.setRoute(null));
  return { ...fake, session };
}

test('unmounted Play stays idle; mounted background queues clicks and StrictMode cleans up', async (t) => {
  const { session, players } = sessionSetup(t);
  session.toggle();
  assert.equal(session.getSnapshot().mounted, false);
  assert.equal(session.getSnapshot().status, 'idle');
  assert.equal(session.getSnapshot().desiredPlaying, false);
  const cleanup = session.mount('top', host());
  session.toggle();
  cleanup();
  const finalCleanup = session.mount('top', host());
  t.after(finalCleanup);
  session.toggle();
  session.toggle();
  session.toggle();
  assert.equal(session.getSnapshot().mounted, true);
  await flush();
  assert.equal(players.length, 1);
  players[0].ready();
  assert.equal(starts(players[0]).length, 1);
  finalCleanup();
  players[0].stateChange(1);
  assert.equal(session.getSnapshot().mounted, false);
  assert.equal(session.getSnapshot().desiredPlaying, false);
  assert.equal(session.getSnapshot().status, 'idle');
  assert.deepEqual(players[0].calls.at(-1), ['destroy']);
});

test('page track selection never disables header transport; one player owns audio', async (t) => {
  const { session, players } = sessionSetup(t);
  session.setRoute('video');
  const cleanup = session.mount('video', host());
  t.after(cleanup);
  await flush();
  const player = players[0];
  player.ready();
  session.select(MUSIC_TRACKS[2]); // Page selection.
  player.stateChange(1);
  session.toggle(); // Header pause uses the very same session.
  assert.deepEqual(player.calls.at(-1), ['pause']);
  player.stateChange(2);
  session.toggle(); // Header play, including the page's chosen track.
  assert.deepEqual(player.calls.at(-1), ['play']);
  assert.equal(session.getSnapshot().track.videoId, MUSIC_TRACKS[2].videoId);
  session.setVolume(18);
  assert.deepEqual(player.calls.slice(-2), [['volume', 18], ['unmute']]);
  session.mount('top', host());
  assert.equal(players.length, 1);
  assert.equal(session.getSnapshot().owner, 'video');
});

test('navigation destroys previous owner; stale cleanup cannot stop its replacement', async (t) => {
  const { session, players } = sessionSetup(t);
  const oldCleanup = session.mount('top', host());
  session.play();
  await flush();
  session.setRoute('video');
  assert.deepEqual(players[0].calls.at(-1), ['destroy']);
  const cleanup = session.mount('video', host());
  t.after(cleanup);
  await flush();
  oldCleanup();
  players[0].ready();
  players[1].ready();
  assert.equal(session.getSnapshot().owner, 'video');
  assert.equal(session.getSnapshot().ready, true);
  assert.equal(starts(players[1]).length, 0);
});

test('rapid pause/play uses latest intent even before the old pause acknowledgement', async (t) => {
  const { session, players } = sessionSetup(t);
  const cleanup = session.mount('top', host());
  session.play();
  t.after(cleanup);
  await flush();
  const player = players[0];
  player.ready();
  player.stateChange(1);
  session.toggle();
  session.toggle();
  assert.equal(session.getSnapshot().desiredPlaying, true);
  assert.deepEqual(player.calls.at(-1), ['play']);
  player.stateChange(2);
  assert.equal(session.getSnapshot().desiredPlaying, true);
  player.stateChange(1);
  assert.equal(session.getSnapshot().status, 'playing');
});

test('polling reports actual SDK time/state and confirms an already-playing retry', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const { controller, players } = setup(t);
  await flush();
  const player = players[0];
  player.ready();
  controller.setPlaying(true);
  player.stateChange(1);
  controller.setPlaying(true);
  player.time = 8;
  t.mock.timers.tick(500);
  assert.equal(controller.getSnapshot().status, 'playing');
  assert.equal(controller.getSnapshot().state, 1);
  assert.equal(controller.getSnapshot().currentTime, 8);
});

test('SDK loader is single-flight, chains existing callbacks and uses official URL', async (t) => {
  const scripts = [];
  let chained = 0;
  const win = { onYouTubeIframeAPIReady: () => chained++ };
  setGlobal(t, 'window', win);
  setGlobal(t, 'document', {
    createElement: () => ({ remove() {} }), head: { appendChild: (script) => scripts.push(script) },
  });
  const { loadYouTube } = await import('./youtube.ts?single-flight');
  const one = loadYouTube();
  const two = loadYouTube();
  assert.equal(one, two);
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].src, 'https://www.youtube.com/iframe_api');
  win.YT = fakeSDK().sdk;
  win.onYouTubeIframeAPIReady();
  assert.equal(await one, win.YT);
  assert.equal(chained, 1);
  assert.equal(await loadYouTube(), win.YT);
});

test('SDK loader failure is retryable; timing out does not claim ready', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const scripts = [];
  const win = {};
  setGlobal(t, 'window', win);
  setGlobal(t, 'document', {
    createElement: () => ({ remove() {} }), head: { appendChild: (script) => scripts.push(script) },
  });
  const { loadYouTube } = await import('./youtube.ts?retry-load');
  const first = loadYouTube();
  const rejected = assert.rejects(first, /could not load/);
  scripts[0].onerror();
  await rejected;
  const second = loadYouTube();
  const timeout = assert.rejects(second, /could not load/);
  t.mock.timers.tick(15001);
  await timeout;
  const third = loadYouTube();
  win.YT = fakeSDK().sdk;
  win.onYouTubeIframeAPIReady();
  assert.equal(await third, win.YT);
  assert.equal(scripts.length, 3);
});

test('controller defaults to the actual window origin, not the canonical hostname', async (t) => {
  setGlobal(t, 'window', { location: { origin: 'https://aa09-preview.pages.dev' } });
  const { players } = setup(t, { origin: undefined });
  await flush();
  assert.equal(players[0].options.playerVars.origin, 'https://aa09-preview.pages.dev');
});

test('native controls inherit stored volume without an automatic play or unmute', async (t) => {
  const { players } = setup(t, { volume: 0 });
  await flush();
  players[0].ready();
  assert.deepEqual(players[0].calls, [['volume', 0], ['mute'], ['pause'], ['cue', 'first']]);
});

test('header controls the mounted viewport background, with no player popup or retry UI', async () => {
  const [header, page, background, shell] = await Promise.all([
    '../components/layout/musicplayer.tsx', '../app/music/page.tsx', '../components/layout/sitebackgroundvideo.tsx', '../components/layout/GlobalAppShell.tsx',
  ].map((path) => readFile(new URL(path, import.meta.url), 'utf8')));
  for (const source of [header, page, background]) assert.doesNotMatch(source, /postMessage|SITE_URL|resumeAudio|videoSelectedRef/);
  assert.doesNotMatch(header, /h-px|opacity-0|syncTimerRef|autoAdvanceTimerRef|panelOpen|playerPosition|playButtonRef|playerHostRef|musicPlayback\.(mount|close|setRoute)/);
  assert.doesNotMatch(header + page, /musicPlayback\.retry|retryPlaying|YouTube에서 열기|youtube\.com\/watch/);
  assert.doesNotMatch(background, /<iframe|autoplay=1|key=|usePathname|gyopo-music-/);
  assert.match(background, /musicPlayback\.mount\('top', playerHostRef\.current\)/);
  assert.match(background, /width: '100vw', height: '100dvh', minWidth: 200, minHeight: 200/);
  assert.match(header, /data-player-time=\{playback.currentTime\}/);
  for (const source of [header, page, background]) {
    assert.match(source, /data-player-volume=\{(?:playback\.)?volume\}/);
    assert.match(source, /data-player-state=\{playback.state\}/);
    assert.match(source, /data-player-muted=\{playback.muted\}/);
  }
  assert.match(header, /disabled=\{!playback.mounted\}/);
  assert.match(header, /id="top-music-favorites"/);
  assert.match(header, /id="top-music-search"/);
  assert.match(page, /musicPlayback\.mount\('video'/);
  assert.match(header, /musicPlayback\.toggle\(\)/);
  assert.match(page, /musicPlayback\.toggle\(\)/);
  assert.match(shell, /musicOwner === 'top' && <SiteBackgroundVideo \/>/);
  assert.match(shell, /musicPlayback\.setRoute\(musicOwner\); \}, \[musicOwner\]\)/);
});

test('buffering -> pause -> pause -> late PLAYING stays cancelled until explicit Play', async (t) => {
  const { controller, players } = setup(t);
  await flush();
  const player = players[0];
  player.ready();
  controller.setPlaying(true);
  player.stateChange(3);
  controller.setPlaying(false);
  controller.setPlaying(false);
  for (const intermediate of [undefined, 2, 5, 'blocked']) {
    if (intermediate === 'blocked') player.blocked();
    else if (intermediate !== undefined) player.stateChange(intermediate);
    player.stateChange(1);
    assert.equal(controller.getSnapshot().desiredPlaying, false);
    assert.notEqual(controller.getSnapshot().status, 'playing');
    assert.deepEqual(player.calls.at(-1), ['pause']);
  }
  controller.setPlaying(true);
  player.stateChange(1);
  assert.equal(controller.getSnapshot().status, 'playing');
  assert.equal(controller.getSnapshot().desiredPlaying, true);
});

test('native pause/play works without cancellation, but cannot override an app safety pause', async (t) => {
  const { controller, players } = setup(t);
  await flush();
  const player = players[0];
  player.ready();
  player.stateChange(1);
  player.stateChange(2);
  player.stateChange(1);
  assert.equal(controller.getSnapshot().desiredPlaying, true);
  controller.setPlaying(false);
  player.stateChange(2);
  player.stateChange(1);
  assert.equal(controller.getSnapshot().desiredPlaying, false);
  controller.setPlaying(true);
  player.stateChange(1);
  assert.equal(controller.getSnapshot().desiredPlaying, true);
});

test('visibility is a persistent gate even with no new visibility/observer callback', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const doc = { hidden: false };
  setGlobal(t, 'document', doc);
  setGlobal(t, 'window', { innerWidth: 1024, innerHeight: 768 });
  let top = 10;
  const element = { ...host(), isConnected: true, getBoundingClientRect: () => ({ top, bottom: top + 200, left: 0, right: 320, width: 320, height: 200 }) };
  const { session, players } = sessionSetup(t);
  session.setRoute('video');
  const cleanup = session.mount('video', element);
  t.after(cleanup);
  await flush();
  const player = players[0];
  player.ready();
  session.play();
  player.stateChange(1);
  doc.hidden = true; // Deliberately no visibilitychange callback.
  t.mock.timers.tick(500);
  assert.equal(session.getSnapshot().desiredPlaying, false);
  session.pause();
  session.play();
  player.stateChange(1);
  assert.equal(session.getSnapshot().desiredPlaying, false);
  doc.hidden = false;
  player.stateChange(1);
  assert.equal(session.getSnapshot().desiredPlaying, false);
  session.play();
  player.stateChange(1);
  top = 1000; // Deliberately no IntersectionObserver callback.
  t.mock.timers.tick(500);
  assert.equal(session.getSnapshot().desiredPlaying, false);
  const count = starts(player).length;
  session.play();
  session.play();
  assert.equal(starts(player).length, count);
  top = 10;
  session.play();
  player.stateChange(1);
  assert.equal(session.getSnapshot().desiredPlaying, true);
});

test('the ordinary /music Play handler reveals the pane before recovering blocked playback', async (t) => {
  setGlobal(t, 'document', { hidden: false });
  setGlobal(t, 'window', { innerWidth: 1024, innerHeight: 768 });
  let top = 1000;
  const element = {
    ...host(), isConnected: true,
    getBoundingClientRect: () => ({ top, bottom: top + 200, left: 0, right: 320, width: 320, height: 200 }),
    scrollIntoView(options) { assert.equal(options.behavior, 'instant'); top = 10; },
  };
  const { session, players } = sessionSetup(t);
  session.setRoute('video');
  const cleanup = session.mount('video', element);
  t.after(cleanup);
  await flush();
  players[0].ready();
  players[0].blocked();
  session.pause();
  session.play();
  assert.equal(starts(players[0]).length, 0);
  const source = await readFile(new URL('../app/music/page.tsx', import.meta.url), 'utf8');
  const body = source.match(/const togglePlaying = \(\) => \{([\s\S]*?)\n  \};/)[1];
  assert.match(source, /onClick=\{togglePlaying\}/);
  runInNewContext(body, { revealMusicPlayer, playerHostRef: { current: element }, musicPlayback: session });
  assert.equal(starts(players[0]).length, 1);
  players[0].stateChange(1);
  assert.equal(session.getSnapshot().desiredPlaying, true);
});

test('native mute and volume reach shared UI state and survive play, retry and remount', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const { session, players } = sessionSetup(t);
  const cleanup = session.mount('top', host());
  session.play();
  t.after(cleanup);
  await flush();
  const player = players[0];
  player.ready();
  player.stateChange(1);
  player.volume = 23;
  player.muted = true;
  t.mock.timers.tick(500);
  assert.equal(session.getSnapshot().volume, 23);
  assert.equal(session.getSnapshot().muted, true);
  const before = player.calls.length;
  session.pause();
  player.stateChange(2);
  session.play();
  player.blocked();
  session.play();
  assert.equal(player.calls.slice(before).some(([name]) => ['volume', 'unmute'].includes(name)), false);
  session.setRoute('video');
  assert.equal(session.getSnapshot().volume, 23);
  assert.equal(session.getSnapshot().muted, true);
  const nextCleanup = session.mount('video', host());
  t.after(nextCleanup);
  await flush();
  players[1].ready();
  assert.deepEqual(players[1].calls.slice(0, 2), [['volume', 23], ['mute']]);
  session.setMuted(false);
  assert.deepEqual(players[1].calls.at(-1), ['unmute']);
  assert.equal(session.getSnapshot().volume, 23);
  const source = await readFile(new URL('../components/layout/musicplayer.tsx', import.meta.url), 'utf8');
  assert.match(source, /const silenced = playback.muted \|\| volume === 0/);
  assert.match(source, /aria-pressed=\{silenced\}/);
});

test('real games producer payload reaches receiver without granting playback consent', async (t) => {
  const source = await readFile(new URL('../app/games/page.tsx', import.meta.url), 'utf8');
  const start = source.indexOf("window.dispatchEvent(new CustomEvent('gyopo-music-sync'");
  const producer = source.slice(start, source.indexOf('}));', start) + 4);
  let detail;
  runInNewContext(producer, {
    room: { musicVideoId: 'room-video', musicTitle: 'Room selection', musicPlaying: true, musicVolume: 19 },
    window: { dispatchEvent(event) { detail = event.detail; } },
    CustomEvent: class { constructor(_name, init) { this.detail = init.detail; } },
  });
  assert.equal(detail.player, 'top');
  const { session, players } = sessionSetup(t);
  assert.equal(session.sync(detail), true);
  assert.equal(session.getSnapshot().track.videoId, 'room-video');
  assert.equal(session.getSnapshot().volume, 19);
  assert.equal(session.getSnapshot().desiredPlaying, false);
  assert.equal(session.getSnapshot().mounted, false);
  const cleanup = session.mount('top', host());
  t.after(cleanup);
  await flush();
  const player = players[0];
  player.ready();
  assert.equal(starts(player).length, 0);
  session.play();
  player.stateChange(1);
  player.muted = true;
  session.sync({ ...detail, volume: 25 });
  assert.equal(player.muted, true);
  session.pause();
  const count = starts(player).length;
  session.sync({ ...detail, track: { ...detail.track, videoId: 'next-room-video' } });
  player.stateChange(1);
  assert.equal(starts(player).length, count);
  assert.equal(session.getSnapshot().desiredPlaying, false);
});

test('top means one paused background player, not an on-demand audible popup', async (t) => {
  const { session, players } = sessionSetup(t);
  t.after(session.mount('top', host()));
  await flush();
  const player = players[0];
  player.ready();
  assert.equal(players.length, 1);
  assert.equal(session.getSnapshot().owner, 'top');
  assert.equal(session.getSnapshot().mounted, true);
  assert.equal(session.getSnapshot().ready, true);
  assert.equal(session.getSnapshot().desiredPlaying, false);
  assert.equal('panelOpen' in session.getSnapshot(), false);
  assert.deepEqual(starts(player), []);
  session.play();
  assert.deepEqual(starts(player), [['play']]);
  player.stateChange(1);
  session.pause();
  player.stateChange(2);
  assert.equal(session.getSnapshot().status, 'paused');
  assert.equal(players.length, 1);
});

test('/ -> /community -> /games leaves the same background instance and timeline running', async (t) => {
  const source = await readFile(new URL('../components/layout/GlobalAppShell.tsx', import.meta.url), 'utf8');
  const ownerExpression = source.match(/const musicOwner = ([^;]+);/)[1];
  const { session, players } = sessionSetup(t);
  t.after(session.mount('top', host()));
  await flush();
  const player = players[0];
  player.ready();
  session.play();
  player.time = 37;
  player.stateChange(1);
  const before = session.getSnapshot();
  const commands = player.calls.length;
  for (const pathname of ['/', '/community', '/games']) {
    session.setRoute(runInNewContext(ownerExpression, { mode: 'public', isCallRoute: false, pathname }));
    assert.equal(session.getSnapshot(), before);
    assert.equal(player.calls.length, commands);
  }
  assert.equal(players.length, 1);
  assert.equal(session.getSnapshot().currentTime, 37);
  assert.equal(session.getSnapshot().status, 'playing');
});

test('volume, mute, next, previous and chosen tracks all command the same background', async (t) => {
  const { session, players } = sessionSetup(t);
  t.after(session.mount('top', host()));
  await flush();
  const player = players[0];
  player.ready();
  session.setVolume(28);
  session.setMuted(true);
  session.relative(1);
  player.stateChange(1);
  assert.equal(player.id, MUSIC_TRACKS[1].videoId);
  assert.equal(player.volume, 28);
  assert.equal(player.muted, true);
  session.relative(-1);
  assert.equal(player.id, MUSIC_TRACKS[0].videoId);
  session.select(MUSIC_TRACKS[3]);
  assert.equal(player.id, MUSIC_TRACKS[3].videoId);
  session.setMuted(false);
  assert.equal(player.muted, false);
  session.setVolume(0);
  assert.equal(player.muted, true);
  session.setVolume(64);
  assert.equal(player.volume, 64);
  assert.equal(player.muted, false);
  session.setPlaylist([MUSIC_TRACKS[2], MUSIC_TRACKS[3]], true);
  session.relative(1);
  assert.equal(player.id, MUSIC_TRACKS[2].videoId);
  assert.equal(players.length, 1);
  assert.equal(player.calls.some(([name]) => name === 'destroy'), false);
});

test('owner handoff captures native audio immediately and rejects every late old-owner event', async (t) => {
  const { session, players } = sessionSetup(t);
  const oldCleanup = session.mount('top', host());
  await flush();
  const old = players[0];
  old.ready();
  session.play();
  old.stateChange(1);
  old.volume = 17;
  old.muted = true; // Navigate before the next native-volume poll.
  session.setRoute('video');
  t.after(session.mount('video', host()));
  await flush();
  const current = players[1];
  current.ready();
  const before = session.getSnapshot();
  oldCleanup();
  old.ready();
  old.stateChange(1);
  old.stateChange(0);
  old.error(150);
  old.blocked();
  assert.equal(session.getSnapshot(), before);
  assert.deepEqual(old.calls.at(-1), ['destroy']);
  assert.deepEqual(current.calls.slice(0, 2), [['volume', 17], ['mute']]);
  assert.equal(starts(current).length, 0);
  session.play();
  current.stateChange(1);
  session.setRoute('top');
  t.after(session.mount('top', host()));
  await flush();
  players[2].ready();
  assert.equal(starts(players[2]).length, 0);
  assert.equal(players[2].volume, 17);
  assert.equal(players[2].muted, true);
});

test('compact, admin and both video-call routes suspend ownership; disabled Play cannot load', async (t) => {
  const source = await readFile(new URL('../components/layout/GlobalAppShell.tsx', import.meta.url), 'utf8');
  const ownerExpression = source.match(/const musicOwner = ([^;]+);/)[1];
  const { session, players } = sessionSetup(t);
  t.after(session.mount('top', host()));
  await flush();
  players[0].ready();
  session.play();
  players[0].stateChange(1);
  for (const [mode, pathname] of [['admin', '/admin'], ['admin', '/master'], ['compact', '/webrtc'], ['public', '/webrtc'], ['public', '/apps/random-chat']]) {
    const owner = runInNewContext(ownerExpression, { mode, pathname, isCallRoute: pathname === '/webrtc' || pathname === '/apps/random-chat' });
    assert.equal(owner, null);
    session.setRoute(owner);
    session.play();
    session.toggle();
    session.select(MUSIC_TRACKS[1]);
    session.sync({ player: 'top', track: MUSIC_TRACKS[2], playing: true });
    session.mount('top', host());
    players[0].stateChange(1);
    assert.equal(session.getSnapshot().mounted, false);
    assert.equal(session.getSnapshot().desiredPlaying, false);
    assert.equal(session.getSnapshot().status, 'idle');
  }
  assert.equal(players.length, 1);
  assert.deepEqual(players[0].calls.at(-1), ['destroy']);
});

test('header remount cannot overwrite native volume and mute with stale local storage', async (t) => {
  const { session, players } = sessionSetup(t);
  session.restoreVolume(41);
  t.after(session.mount('top', host()));
  await flush();
  players[0].ready();
  players[0].volume = 13;
  players[0].muted = true;
  session.setRoute(null);
  session.restoreVolume(41);
  assert.equal(session.getSnapshot().volume, 13);
  assert.equal(session.getSnapshot().muted, true);
});

test('owner change during controller creation destroys the unassigned ghost controller', async (t) => {
  const { session, players } = sessionSetup(t);
  const unsubscribe = session.subscribe(() => {
    if (session.getSnapshot().status === 'loading') session.setRoute(null);
  });
  t.after(unsubscribe);
  session.mount('top', host());
  await flush();
  assert.equal(players.length, 0);
  assert.equal(session.getSnapshot().owner, null);
  assert.equal(session.getSnapshot().mounted, false);
  assert.equal(session.getSnapshot().status, 'idle');
});

test('synchronous SDK onReady cleanup cannot resurrect a ghost iframe or polling timer', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const fake = fakeSDK();
  class ImmediatePlayer extends fake.sdk.Player {
    constructor(element, options) { super(element, options); this.ready(); }
  }
  let controller;
  let updates = 0;
  controller = createYouTubeController(host(), {
    videoId: 'ghost', volume: 70, origin: 'https://preview.example',
    loadSDK: async () => ({ Player: ImmediatePlayer }),
    onChange(snapshot) { updates++; if (snapshot.ready) controller.destroy(); },
  });
  t.after(() => controller.destroy());
  controller.setPlaying(true);
  await flush();
  const before = updates;
  t.mock.timers.tick(20000);
  fake.players[0].stateChange(1);
  fake.players[0].ready();
  assert.equal(updates, before);
  assert.deepEqual(starts(fake.players[0]), []);
  assert.deepEqual(fake.players[0].calls.at(-1), ['destroy']);
});

test('delayed and intermediate SDK audio acknowledgements cannot roll back newer commands', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
  const { controller, players } = setup(t);
  await flush();
  const player = players[0];
  player.ready();
  player.delayAudio = true;
  controller.setVolume(18);
  controller.setMuted(true);
  assert.equal(controller.getSnapshot().volume, 18);
  assert.equal(controller.getSnapshot().muted, true);
  assert.equal(player.volume, 70);
  assert.equal(player.muted, false);
  controller.setVolume(32, true);
  player.volume = 18; // Only the previous command has reached the SDK cache.
  t.mock.timers.tick(500);
  assert.equal(controller.getSnapshot().volume, 32);
  assert.equal(controller.getSnapshot().muted, true);
  player.volume = 32;
  t.mock.timers.tick(500);
  assert.equal(controller.getSnapshot().muted, true);
  player.muted = true;
  t.mock.timers.tick(500);
  player.volume = 47; // After acknowledgement, native controls remain authoritative.
  player.muted = false;
  t.mock.timers.tick(500);
  assert.equal(controller.getSnapshot().volume, 47);
  assert.equal(controller.getSnapshot().muted, false);
});

test('rapid commands returning to the old getter value wait through intermediate acknowledgements', async (t) => {
  const { controller, players } = setup(t);
  await flush();
  const player = players[0];
  player.ready();
  player.delayAudio = true;
  controller.setVolume(18);
  controller.setMuted(true);
  controller.setVolume(70);
  assert.equal(controller.getSnapshot().volume, 70);
  assert.equal(controller.getSnapshot().muted, false);
  player.volume = 18;
  player.muted = true;
  assert.equal(controller.getSnapshot().volume, 70);
  assert.equal(controller.getSnapshot().muted, false);
  player.volume = 70;
  player.muted = false;
  controller.getSnapshot();
  player.volume = 26;
  player.muted = true;
  assert.equal(controller.getSnapshot().volume, 26);
  assert.equal(controller.getSnapshot().muted, true);
});

test('unacknowledged commands do not suppress native audio readings indefinitely', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
  const { controller, players } = setup(t);
  await flush();
  const player = players[0];
  player.ready();
  player.delayAudio = true;
  controller.setVolume(18);
  controller.setMuted(true);
  player.volume = 46;
  t.mock.timers.tick(1500);
  assert.equal(controller.getSnapshot().volume, 18);
  assert.equal(controller.getSnapshot().muted, true);
  const commands = player.calls.length;
  t.mock.timers.tick(1000);
  assert.equal(controller.getSnapshot().volume, 46);
  assert.equal(controller.getSnapshot().muted, false);
  assert.equal(player.calls.length, commands);
});

test('pending volume and mute survive immediate owner handoff and an SDK retry', async (t) => {
  const { session, players } = sessionSetup(t);
  session.mount('top', host());
  await flush();
  const old = players[0];
  old.ready();
  old.delayAudio = true;
  session.setVolume(18);
  session.setMuted(true);
  session.setRoute('video');
  assert.equal(session.getSnapshot().volume, 18);
  assert.equal(session.getSnapshot().muted, true);
  t.after(session.mount('video', host()));
  await flush();
  const page = players[1];
  page.delayAudio = true;
  page.ready();
  assert.deepEqual(page.calls.slice(0, 2), [['volume', 18], ['mute']]);
  assert.equal(starts(page).length, 0);
  page.error(150);
  session.play();
  await flush();
  const replacement = players[2];
  replacement.ready();
  assert.deepEqual(replacement.calls.slice(0, 2), [['volume', 18], ['mute']]);
  assert.equal(session.getSnapshot().volume, 18);
  assert.equal(session.getSnapshot().muted, true);
  assert.deepEqual(page.calls.at(-1), ['destroy']);
});

test('only the generated background iframe loses focus and native keyboard controls', async (t) => {
  const { session, players } = sessionSetup(t);
  const backgroundHost = host();
  session.mount('top', backgroundHost);
  await flush();
  const background = players[0];
  background.ready();
  assert.equal(background.options.playerVars.controls, 0);
  assert.equal(background.options.playerVars.disablekb, 1);
  assert.equal(background.getIframe().tabIndex, -1);
  assert.equal(backgroundHost.tabIndex, undefined);
  session.setRoute('video');
  t.after(session.mount('video', host()));
  await flush();
  const page = players[1];
  page.ready();
  assert.equal(page.options.playerVars.controls, 1);
  assert.equal(page.options.playerVars.disablekb, 0);
  assert.equal(page.getIframe().tabIndex, 0);
});

test('paused Next sends exactly one load, never cue followed by Play', async (t) => {
  const { session, players } = sessionSetup(t);
  t.after(session.mount('top', host()));
  await flush();
  const player = players[0];
  player.ready();
  session.play();
  player.stateChange(1);
  player.time = 12;
  session.pause();
  player.stateChange(2);
  const before = player.calls.length;
  session.relative(1);
  assert.deepEqual(player.calls.slice(before), [['load', MUSIC_TRACKS[1].videoId]]);
  assert.equal(session.getSnapshot().currentTime, 0);
  assert.equal(session.getSnapshot().desiredPlaying, true);
  player.stateChange(3);
  player.stateChange(1);
  assert.equal(session.getSnapshot().status, 'playing');
  assert.equal(players.length, 1);
});

test('same-ID selection resumes and retries errors; a different selection retries with its new ID', async (t) => {
  const { session, players } = sessionSetup(t);
  t.after(session.mount('top', host()));
  await flush();
  const player = players[0];
  player.ready();
  session.play();
  player.stateChange(1);
  session.pause();
  player.time = 19;
  player.stateChange(2);
  const before = player.calls.length;
  session.select(MUSIC_TRACKS[0]);
  assert.deepEqual(player.calls.slice(before), [['play']]);
  assert.equal(session.getSnapshot().currentTime, 19);
  player.error(150);
  session.select(MUSIC_TRACKS[0]);
  await flush();
  assert.deepEqual(player.calls.at(-1), ['destroy']);
  players[1].ready();
  assert.deepEqual(starts(players[1]), [['load', MUSIC_TRACKS[0].videoId]]);
  players[1].stateChange(1);
  assert.equal(session.getSnapshot().status, 'playing');
  players[1].error(150);
  const failedCalls = players[1].calls.length;
  session.select(MUSIC_TRACKS[2]);
  assert.deepEqual(players[1].calls.slice(failedCalls), [['destroy']]);
  await flush();
  players[2].ready();
  assert.deepEqual(starts(players[2]), [['load', MUSIC_TRACKS[2].videoId]]);
  players[2].stateChange(1);
  assert.equal(session.getSnapshot().status, 'playing');
});

test('atomic start respects canPlay and rapid cancellation before SDK readiness', async (t) => {
  let visible = true;
  const { controller, players } = setup(t, { canPlay: () => visible });
  controller.setTrack('queued', true);
  controller.setPlaying(false);
  await flush();
  const player = players[0];
  player.ready();
  assert.deepEqual(starts(player), []);
  visible = false;
  controller.setTrack('queued', true);
  assert.equal(controller.getSnapshot().desiredPlaying, false);
  assert.deepEqual(starts(player), []);
  visible = true;
  const before = player.calls.length;
  controller.setTrack('next', true);
  assert.deepEqual(player.calls.slice(before), [['load', 'next']]);
});

test('metadata and room selections preserve local intent, and ownerless selection stays idle', async (t) => {
  const { session, players } = sessionSetup(t);
  t.after(session.mount('top', host()));
  await flush();
  const player = players[0];
  player.ready();
  session.play();
  player.time = 21;
  player.stateChange(1);
  const before = player.calls.length;
  session.select({ ...MUSIC_TRACKS[0], title: 'Updated metadata' }, false);
  assert.equal(player.calls.length, before);
  assert.equal(session.getSnapshot().currentTime, 21);
  assert.equal(session.getSnapshot().desiredPlaying, true);
  session.sync({ player: 'top', track: MUSIC_TRACKS[1], playing: true });
  assert.deepEqual(player.calls.slice(before), [['load', MUSIC_TRACKS[1].videoId]]);
  session.pause();
  player.stateChange(2);
  const pausedCalls = player.calls.length;
  session.sync({ player: 'top', track: MUSIC_TRACKS[2], playing: true });
  assert.deepEqual(player.calls.slice(pausedCalls), [['pause'], ['cue', MUSIC_TRACKS[2].videoId]]);
  assert.equal(session.getSnapshot().desiredPlaying, false);
  session.setRoute(null);
  session.select(MUSIC_TRACKS[3]);
  assert.equal(session.getSnapshot().status, 'idle');
  assert.equal(session.getSnapshot().desiredPlaying, false);
  assert.equal(session.getSnapshot().mounted, false);
});
