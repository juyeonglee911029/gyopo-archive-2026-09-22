export type VideoEffects = { brightness: number; contrast: number; saturation: number; warmth: number; mirror: boolean };
export const DEFAULT_VIDEO_EFFECTS: VideoEffects = { brightness: 100, contrast: 100, saturation: 100, warmth: 0, mirror: false };
export const VIDEO_EFFECT_CONTROLS = [
  { key: 'brightness', label: '밝기', min: 50, max: 150 },
  { key: 'contrast', label: '대비', min: 50, max: 150 },
  { key: 'saturation', label: '채도', min: 0, max: 200 },
  { key: 'warmth', label: '색온도', min: -50, max: 50 },
] as const;

export function normalizeVideoEffects(value: Partial<VideoEffects>): VideoEffects {
  const result = { ...DEFAULT_VIDEO_EFFECTS, mirror: value.mirror === true };
  for (const { key, min, max } of VIDEO_EFFECT_CONTROLS) {
    const number = value[key];
    result[key] = typeof number === 'number' && Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : DEFAULT_VIDEO_EFFECTS[key];
  }
  return result;
}

// Pixel operations work even where CanvasRenderingContext2D.filter is unavailable.
export function applyVideoEffectPixels(pixels: Uint8ClampedArray, value: Partial<VideoEffects>): void {
  const { brightness, contrast, saturation, warmth } = normalizeVideoEffects(value);
  const b = brightness / 100, c = contrast / 100, s = saturation / 100;
  for (let i = 0; i < pixels.length; i += 4) {
    const r = (pixels[i] * b - 128) * c + 128;
    const g = (pixels[i + 1] * b - 128) * c + 128;
    const blue = (pixels[i + 2] * b - 128) * c + 128;
    const luminance = .2126 * r + .7152 * g + .0722 * blue;
    pixels[i] = luminance + (r - luminance) * s + warmth * .6;
    pixels[i + 1] = luminance + (g - luminance) * s;
    pixels[i + 2] = luminance + (blue - luminance) * s - warmth * .6;
  }
}

export type VideoCompositor = {
  stream: MediaStream;
  videoTrack: MediaStreamTrack;
  setEffects: (effects: Partial<VideoEffects>) => void;
  setSource: (source: MediaStream) => Promise<void>;
  dispose: () => void;
};

/** Owns only its canvas track. Caller owns source tracks and must stop them. */
export async function createVideoCompositor(source: MediaStream, initial: Partial<VideoEffects> = {}, options: { signal?: AbortSignal; frameRate?: number } = {}): Promise<VideoCompositor> {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context || typeof canvas.captureStream !== 'function') throw new Error('Canvas video capture is not supported.');
  let effects = normalizeVideoEffects(initial);
  let video: HTMLVideoElement | null = null;
  let stream: MediaStream | null = null;
  let disposed = false;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pending = new Set<() => void>();
  const release = (element: HTMLVideoElement) => { element.pause(); element.srcObject = null; };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    generation += 1;
    clearTimeout(timer);
    pending.forEach((cancel) => cancel());
    if (video) release(video);
    video = null;
    stream?.getTracks().forEach((track) => track.stop());
    options.signal?.removeEventListener('abort', dispose);
  };
  options.signal?.addEventListener('abort', dispose, { once: true });
  const setSource = async (nextSource: MediaStream) => {
    if (disposed || options.signal?.aborted) throw new Error('Video compositor stopped.');
    const version = ++generation;
    const next = document.createElement('video');
    next.muted = true;
    next.playsInline = true;
    next.srcObject = nextSource;
    try {
      await new Promise<void>((resolve, reject) => {
        let played = false;
        const finish = (error?: Error) => {
          clearTimeout(timeout);
          clearInterval(poll);
          pending.delete(cancel);
          error ? reject(error) : resolve();
        };
        const cancel = () => finish(new Error('Video compositor stopped.'));
        const check = () => { if (played && next.readyState >= 2 && next.videoWidth > 0 && next.videoHeight > 0) finish(); };
        const timeout = setTimeout(() => finish(new Error('Video dimensions/playback not ready.')), 10_000);
        const poll = setInterval(check, 25);
        pending.add(cancel);
        next.play().then(() => { played = true; check(); }, () => finish(new Error('Video playback failed.')));
      });
      if (disposed || generation !== version) throw new Error('Video source superseded.');
      if (video) release(video);
      video = next;
      canvas.width = next.videoWidth;
      canvas.height = next.videoHeight;
    } catch (error) { release(next); throw error; }
  };
  const draw = () => {
    if (disposed || !video) return;
    if (video.readyState >= 2) {
      context.save();
      context.setTransform(effects.mirror ? -1 : 1, 0, 0, 1, effects.mirror ? canvas.width : 0, 0);
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      context.restore();
      if (effects.brightness !== 100 || effects.contrast !== 100 || effects.saturation !== 100 || effects.warmth !== 0) {
        const frame = context.getImageData(0, 0, canvas.width, canvas.height);
        applyVideoEffectPixels(frame.data, effects);
        context.putImageData(frame, 0, 0);
      }
    }
    timer = setTimeout(draw, 1000 / Math.max(1, Math.min(30, options.frameRate || 30)));
  };
  try {
    await setSource(source);
    draw();
    stream = canvas.captureStream(Math.max(1, Math.min(30, options.frameRate || 30)));
    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack) throw new Error('Canvas did not produce a video track.');
    return { stream, videoTrack, setSource, setEffects: (next) => { effects = normalizeVideoEffects(next); }, dispose };
  } catch (error) { dispose(); throw error; }
}
