export function rtcConfiguration(raw?: string, username = 'openrelayproject', credential = 'openrelayproject'): RTCConfiguration {
  let configured: RTCIceServer[] = [];
  if (raw) {
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { throw new Error('NEXT_PUBLIC_WEBRTC_ICE_SERVERS must be valid JSON'); }
    if (!Array.isArray(parsed) || !parsed.length || !parsed.every((server) => {
      const urls = typeof server?.urls === 'string' ? [server.urls] : server?.urls;
      return Array.isArray(urls) && urls.length && urls.every((url: unknown) => typeof url === 'string' && /^(stun|stuns|turn|turns):[^\s]+$/.test(url))
        && (server.username === undefined || typeof server.username === 'string')
        && (server.credential === undefined || typeof server.credential === 'string');
    })) throw new Error('NEXT_PUBLIC_WEBRTC_ICE_SERVERS must be an RTCIceServer JSON array');
    configured = parsed;
  }
  return { iceServers: [
    ...configured,
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp', 'turns:openrelay.metered.ca:443?transport=tcp'], username, credential },
  ], iceCandidatePoolSize: 0 };
}

export function rtcFailureMessage(relaySeen: boolean) {
  return relaySeen
    ? '네트워크 연결을 복구하지 못했습니다. Wi-Fi/모바일 데이터를 전환해 재시도하세요. 운영자는 TURN 인증 및 UDP/TCP 443 연결을 확인해주세요.'
    : '중계(TURN) 경로를 확보하지 못했습니다. 공용 중계는 가용성이 보장되지 않습니다. Wi-Fi/모바일 데이터를 전환하거나 운영자에게 정상 TURN 설정을 요청해주세요.';
}
