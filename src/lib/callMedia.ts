export function isVideoOnlyCall(search: string) {
  const params = new URLSearchParams(search);
  return params.get('videoOnly') === '1' || params.get('callKind') === 'game' || Boolean(params.get('gameRoom'));
}

export function callMediaConstraints(videoOnly: boolean): MediaStreamConstraints {
  return {
    // Keep mobile capture predictable instead of letting the browser select a
    // high-resolution/60 FPS camera stream that is expensive to encode.
    video: { facingMode: { ideal: 'user' }, width: { ideal: 640, max: 1280 }, height: { ideal: 480, max: 720 }, frameRate: { ideal: 30, max: 30 } },
    audio: videoOnly ? false : { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  };
}

export function mergeRemoteTrack(stream: MediaStream, track: MediaStreamTrack, videoOnly: boolean) {
  if (videoOnly && track.kind === 'audio') { track.stop(); return; }
  if (!stream.getTracks().some((item) => item.id === track.id)) stream.addTrack(track);
}

export async function playCallMedia(element: HTMLVideoElement | null, stream: MediaStream, muted: boolean) {
  if (!element) return false;
  if (element.srcObject !== stream) element.srcObject = stream;
  element.muted = muted;
  element.playsInline = true;
  try { await element.play(); return true; } catch { return false; }
}

export function drawMirroredFrame(context: CanvasRenderingContext2D, source: HTMLVideoElement, mirrored: boolean) {
  if (source.readyState < 2 || !source.videoWidth) return;
  const canvas = context.canvas;
  if (canvas.width !== source.videoWidth || canvas.height !== source.videoHeight) {
    canvas.width = source.videoWidth; canvas.height = source.videoHeight;
  }
  context.save();
  try {
    if (mirrored) { context.translate(canvas.width, 0); context.scale(-1, 1); }
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
  } finally { context.restore(); }
}

export function createMirroredCamera(stream: MediaStream, mirrored: () => boolean) {
  const source = document.createElement('video');
  source.muted = true;
  source.autoplay = true;
  source.playsInline = true;
  source.srcObject = stream;
  source.setAttribute('aria-hidden', 'true');
  source.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;bottom:0;left:0';
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context || typeof canvas.captureStream !== 'function') throw new Error('이 브라우저는 전송 영상 좌우 반전을 지원하지 않습니다. 최신 Safari 또는 Chrome을 사용해주세요.');
  const settings = stream.getVideoTracks()[0]?.getSettings();
  const sourceWidth = settings?.width || 640;
  const sourceHeight = settings?.height || 360;
  const scale = Math.min(1, 640 / sourceWidth, 480 / sourceHeight);
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const output = canvas.captureStream(30);
  const track = output.getVideoTracks()[0];
  if (!track) throw new Error('전송용 카메라 영상을 만들지 못했습니다.');
  document.body.appendChild(source);
  let stopped = false;
  // Independent of the CSS-hidden preview; skip undecoded frames rather than
  // throwing once and permanently killing the draw loop on mobile.
  const draw = () => {
    if (!stopped) drawMirroredFrame(context, source, mirrored());
  };
  const timer = setInterval(() => { try { draw(); } catch { /* Retry the next decoded frame. */ } }, 1000 / 30);
  let playbackTimer: ReturnType<typeof setTimeout>;
  const ready = new Promise<void>((resolve, reject) => {
    playbackTimer = setTimeout(() => reject(new Error('카메라 영상 재생이 지연됩니다. 카메라 권한과 브라우저를 확인해주세요.')), 10_000);
    source.play().then(resolve, reject);
  }).finally(() => clearTimeout(playbackTimer));
  return { track, ready, stop() { stopped = true; clearInterval(timer); clearTimeout(playbackTimer); track.stop(); source.pause(); source.srcObject = null; source.remove(); } };
}
