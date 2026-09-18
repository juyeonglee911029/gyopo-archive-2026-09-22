'use client';

import { useEffect, useRef, useState } from 'react';
import { MUSIC_TRACKS, type MusicSyncDetail } from '@/lib/music';
import { SITE_URL } from '@/lib/seo';

export default function SiteBackgroundVideo() {
  const [videoId, setVideoId] = useState(MUSIC_TRACKS[0].videoId);
  const [muted, setMuted] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const currentVideoIdRef = useRef(videoId);
  const mutedRef = useRef(false);

  const sendCommand = (func: string, args: unknown[] = []) => {
    frameRef.current?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args }), 'https://www.youtube.com');
  };

  useEffect(() => {
    const syncTrack = (event: Event) => {
      const detail = (event as CustomEvent<MusicSyncDetail>).detail;
      if (detail?.player === 'video' || (mutedRef.current && detail?.player === 'top')) return;
      const next = detail?.track?.videoId;
      if (!next) return;
      if (next === currentVideoIdRef.current) return;
      currentVideoIdRef.current = next;
      sendCommand('loadVideoById', [next]);
    };
    const syncBackgroundAudio = (event: Event) => {
      const nextMuted = Boolean((event as CustomEvent<{ muted?: boolean }>).detail?.muted);
      mutedRef.current = nextMuted;
      setMuted(nextMuted);
    };
    window.addEventListener('gyopo-music-local', syncTrack);
    window.addEventListener('gyopo-music-sync', syncTrack);
    window.addEventListener('gyopo-background-music', syncBackgroundAudio);
    return () => {
      window.removeEventListener('gyopo-music-local', syncTrack);
      window.removeEventListener('gyopo-music-sync', syncTrack);
      window.removeEventListener('gyopo-background-music', syncBackgroundAudio);
    };
  }, []);

  useEffect(() => {
    sendCommand(muted ? 'mute' : 'unMute');
    sendCommand('playVideo');
  }, [muted]);

  return (
    <div className="site-background-video" aria-hidden="true">
       <iframe
         key={videoId}
          ref={frameRef}
          onLoad={() => {
            if (currentVideoIdRef.current !== videoId) sendCommand('loadVideoById', [currentVideoIdRef.current]);
            sendCommand('mute');
            sendCommand('setVolume', [100]);
            if (!mutedRef.current) sendCommand('unMute');
            sendCommand('playVideo');
          }}
         title="GYOPO background music video"
          src={`https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1&controls=0&loop=1&playlist=${videoId}&playsinline=1&rel=0&modestbranding=1&enablejsapi=1&cc_load_policy=0&iv_load_policy=3&origin=${encodeURIComponent(SITE_URL)}`}
         allow="autoplay; encrypted-media"
       />
      <div className="site-background-video-shade" />
    </div>
  );
}
