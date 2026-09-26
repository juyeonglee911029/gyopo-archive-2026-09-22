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
      players.push(this);
    }
    ready() { this.options.events.onReady({ target: this }); }
    stateChange(state) { this.state = state; this.options.events.onStateChange({ data: state }); }
    blocked() { this.options.events.onAutoplayBlocked(); }
    error(data) { this.options.events.onError({ data }); }
    playVideo() { this.calls.push(['play']); }
    pauseVideo() { this.calls.push(['pause']); }
    mute() { this.muted = true; this.calls.push(['mute']); }
    unMute() { this.muted = false; this.calls.push(['unmute']); }
    setVolume(n) { this.volume = n; this.calls.push(['volume', n]); }
    cueVideoById(id) { this.id = id; this.calls.push(['cue', id]); }
    loadVideoById(id) { this.id = id; this.calls.push(['load', id]); }
    getPlayerState() { return this.state; }
    getCurrentTime() { return this.time; }
    getVolume() { return this.volume; }
    isMuted() { return this.muted; }
    getVideoData() { return { video_id: this.id }; }
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
  controller.retry();
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
  controller.retry();
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
  controller.retry();
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
  t.after(() => session.setRoute('top'));
  return { ...fake, session };
}

test('header clicks queue before mount, rapid toggles and StrictMode keep latest intent', async (t) => {
  const { session, players } = sessionSetup(t);
  session.toggle();
  session.toggle();
  session.toggle();
  assert.equal(session.getSnapshot().panelOpen, true);
  const cleanup = session.mount('top', host());
  cleanup();
  const finalCleanup = session.mount('top', host());
  t.after(finalCleanup);
  await flush();
  assert.equal(players.length, 1);
  players[0].ready();
  assert.equal(starts(players[0]).length, 1);
  session.close();
  players[0].stateChange(1);
  assert.equal(session.getSnapshot().panelOpen, false);
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
  assert.equal(session.getSnapshot().panelOpen, false);
});

test('navigation destroys previous owner; stale cleanup cannot stop its replacement', async (t) => {
  const { session, players } = sessionSetup(t);
  session.play();
  const oldCleanup = session.mount('top', host());
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
  session.play();
  const cleanup = session.mount('top', host());
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

test('components retain visible native controls and no raw-message or generic resume paths', async () => {
  const [header, page, background] = await Promise.all([
    '../components/layout/musicplayer.tsx', '../app/music/page.tsx', '../components/layout/sitebackgroundvideo.tsx',
  ].map((path) => readFile(new URL(path, import.meta.url), 'utf8')));
  for (const source of [header, page, background]) assert.doesNotMatch(source, /postMessage|SITE_URL|resumeAudio|videoSelectedRef/);
  assert.doesNotMatch(header, /h-px|opacity-0|syncTimerRef|autoAdvanceTimerRef/);
  assert.match(header, /minWidth: 200, minHeight: 200/);
  assert.match(header, /data-player-time=\{playback.currentTime\}/);
  assert.match(header, /musicPlayback\.close\(\)/);
  assert.match(page, /musicPlayback\.mount\('video'/);
  assert.match(header, /musicPlayback\.toggle\(\)/);
  assert.match(page, /musicPlayback\.toggle\(\)/);
  assert.match(background, /mute=1&controls=0/);
  assert.doesNotMatch(background, /unMute|gyopo-background-music|enablejsapi/);
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
  controller.retry();
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
  session.retry();
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
  session.retry();
  session.play();
  assert.equal(starts(player).length, count);
  top = 10;
  session.play();
  player.stateChange(1);
  assert.equal(session.getSnapshot().desiredPlaying, true);
});

test('the actual /music Retry handler reveals the pane before requesting playback', async (t) => {
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
  session.retry();
  assert.equal(starts(players[0]).length, 0);
  const source = await readFile(new URL('../app/music/page.tsx', import.meta.url), 'utf8');
  const body = source.match(/const retryPlaying = \(\) => \{([\s\S]*?)\n  \};/)[1];
  assert.match(source, /onClick=\{retryPlaying\}/);
  runInNewContext(body, { revealMusicPlayer, playerHostRef: { current: element }, musicPlayback: session });
  assert.equal(starts(players[0]).length, 1);
  players[0].stateChange(1);
  assert.equal(session.getSnapshot().desiredPlaying, true);
});

test('native mute and volume reach shared UI state and survive play, retry and remount', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const { session, players } = sessionSetup(t);
  session.play();
  const cleanup = session.mount('top', host());
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
  session.retry();
  assert.equal(player.calls.slice(before).some(([name]) => ['volume', 'unmute'].includes(name)), false);
  session.close();
  assert.equal(session.getSnapshot().volume, 23);
  assert.equal(session.getSnapshot().muted, true);
  session.play();
  const nextCleanup = session.mount('top', host());
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
  assert.equal(session.getSnapshot().panelOpen, false);
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
