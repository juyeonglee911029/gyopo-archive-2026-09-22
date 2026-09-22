'use client';

import { useEffect, useRef, useState } from 'react';
import { MUSIC_TRACKS, type MusicSyncDetail } from '@/lib/music';
import { SITE_URL } from '@/lib/seo';

export default function SiteBackgroundVideo() {
  const [videoId, setVideoId] = useState(MUSIC_TRACKS[0].videoId);
  const [muted, setMuted] = useState(true);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const currentVideoIdRef = useRef(videoId);
  const mutedRef = useRef(true);

  const sendCommand = (func: string, args: unknown[] = []) => {
    frameRef.current?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args }), 'https://www.youtube.com');
  };

  useEffect(() => {
    const handleBackgroundCommand = (event: Event) => {
      const detail = (event as CustomEvent<{ func?: string; args?: unknown[] }>).detail;
      if (detail?.func) sendCommand(detail.func, detail.args || []);
    };
    const syncTrack = (event: Event) => {
      const detail = (event as CustomEvent<MusicSyncDetail>).detail;
      if (detail?.player === 'video') return;
      const next = detail?.track?.videoId;
      if (!next) return;
      if (typeof detail.volume === 'number') sendCommand('setVolume', [detail.volume]);
      if (detail.userInitiated && detail.player === 'top') {
        const nextMuted = !detail.playing;
        mutedRef.current = nextMuted;
        setMuted(nextMuted);
        sendCommand(nextMuted ? 'mute' : 'unMute');
        sendCommand(detail.playing ? 'playVideo' : 'pauseVideo');
      }
      if (next === currentVideoIdRef.current) return;
      currentVideoIdRef.current = next;
      setVideoId(next);
    };
    const syncBackgroundAudio = (event: Event) => {
      const nextMuted = Boolean((event as CustomEvent<{ muted?: boolean }>).detail?.muted);
      mutedRef.current = nextMuted;
      setMuted(nextMuted);
    };
    window.addEventListener('gyopo-music-local', syncTrack);
    window.addEventListener('gyopo-music-sync', syncTrack);
    window.addEventListener('gyopo-background-command', handleBackgroundCommand);
    window.addEventListener('gyopo-background-music', syncBackgroundAudio);
    return () => {
      window.removeEventListener('gyopo-music-local', syncTrack);
      window.removeEventListener('gyopo-music-sync', syncTrack);
      window.removeEventListener('gyopo-background-command', handleBackgroundCommand);
      window.removeEventListener('gyopo-background-music', syncBackgroundAudio);
    };
  }, []);

  useEffect(() => {
    sendCommand(muted ? 'mute' : 'unMute');
    if (!muted) sendCommand('playVideo');
  }, [muted]);

  useEffect(() => {
    const handlePlayerMessage = (event: MessageEvent) => {
      if (event.origin !== 'https://www.youtube.com' || event.source !== frameRef.current?.contentWindow || typeof event.data !== 'string') return;
      let payload: { event?: string; info?: number | { playerState?: number } };
      try { payload = JSON.parse(event.data) as typeof payload; } catch { return; }
      const state = payload.event === 'onStateChange' ? Number(payload.info) : payload.event === 'infoDelivery' && typeof payload.info === 'object' ? payload.info.playerState : null;
      if (state !== 0) return;
      const index = MUSIC_TRACKS.findIndex((track) => track.videoId === currentVideoIdRef.current);
      const next = MUSIC_TRACKS[(index + 1) % MUSIC_TRACKS.length];
      currentVideoIdRef.current = next.videoId;
      setVideoId(next.videoId);
    };
    window.addEventListener('message', handlePlayerMessage);
    return () => window.removeEventListener('message', handlePlayerMessage);
  }, []);

  return (
    <div className="site-background-video" aria-hidden="true">
       <iframe
         key={videoId}
          ref={frameRef}
           onLoad={() => {
             if (currentVideoIdRef.current !== videoId) sendCommand('loadVideoById', [currentVideoIdRef.current]);
             frameRef.current?.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: 'gyopo-background-player' }), 'https://www.youtube.com');
             sendCommand('addEventListener', ['onStateChange']);
             sendCommand('mute');
            sendCommand('setVolume', [100]);
            if (!mutedRef.current) sendCommand('unMute');
            sendCommand('playVideo');
          }}
         title="GYOPO background music video"
           src={`https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1&controls=0&playsinline=1&rel=0&modestbranding=1&enablejsapi=1&cc_load_policy=0&iv_load_policy=3&origin=${encodeURIComponent(SITE_URL)}`}
         allow="autoplay; encrypted-media"
       />
      <div className="site-background-video-shade" />
    </div>
  );
}
