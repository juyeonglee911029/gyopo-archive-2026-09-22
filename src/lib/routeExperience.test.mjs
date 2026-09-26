import assert from 'node:assert/strict';
import test from 'node:test';
import { createRouteExperience, ROUTE_TIMEOUT } from './routeExperience.ts';

function createFakeClock() {
  let now = 0;
  let nextId = 0;
  const frames = new Map();
  const timers = new Map();
  const flushFrames = () => {
    while (frames.size) {
      const current = [...frames.values()];
      frames.clear();
      current.forEach((callback) => callback());
    }
  };
  return {
    clock: {
      now: () => now,
      frame: (callback) => { const id = ++nextId; frames.set(id, callback); return id; },
      cancelFrame: (id) => frames.delete(id),
      timer: (callback, delay) => { const id = ++nextId; timers.set(id, { callback, due: now + delay }); return id; },
      cancelTimer: (id) => timers.delete(id),
      reducedMotion: () => true,
    },
    advance: (milliseconds) => {
      const target = now + milliseconds;
      while (true) {
        const next = [...timers.entries()].filter(([, timer]) => timer.due <= target).sort((a, b) => a[1].due - b[1].due)[0];
        if (!next) break;
        const [id, timer] = next;
        timers.delete(id);
        now = timer.due;
        timer.callback();
        flushFrames();
      }
      now = target;
      flushFrames();
    },
    flushFrames,
  };
}

test('a route that becomes ready after its timeout clears the stale error', () => {
  const fake = createFakeClock();
  const experience = createRouteExperience(fake.clock);
  const destination = '/';
  experience.commit(destination);
  experience.report('home-feed', { destination, loading: true, error: false });
  fake.flushFrames();
  assert.equal(experience.getSnapshot().phase, 'LOADING');

  fake.advance(ROUTE_TIMEOUT);
  assert.equal(experience.getSnapshot().phase, 'ERROR');
  assert.equal(experience.getSnapshot().error, 'timeout');

  experience.report('home-feed', { destination, loading: false, error: false });
  fake.flushFrames();
  assert.equal(experience.getSnapshot().phase, 'COMPLETE');
  assert.equal(experience.getSnapshot().error, null);
  experience.dispose();
});
