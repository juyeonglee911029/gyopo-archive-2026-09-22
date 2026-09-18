'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Ban, Camera, CheckCircle2, Flag, LoaderCircle, Mic, MicOff, MonitorUp, PhoneCall, RefreshCcw, ShieldAlert, Users, VideoOff } from 'lucide-react';
import {
  deleteDocument,
  claimWebrtcMatch,
  createDocument,
  deleteExpiredChatMessages,
  createSafetyAuditLog,
  createSafetyReport,
  createUserBlock,
  getAccountModeration,
  getDocument,
  getFreshSessionToken,
  mergeDocument,
  listBlockedUserIds,
  OnlineUser,
  queryDocumentsWhere,
  refreshStoredUser,
  reserveGenderMatchStake,
  saveProfile,
  upsertDocument,
  type GenderPreference,
  type TetrisQueueProfile,
} from '@/lib/firebase';
import { useGlobalStore } from '@/store/useGlobalStore';
import { allowClientAction, getVideoAlias, inspectSafetyText, RANDOM_VIDEO_MIN_AGE } from '@/lib/safety';
import { callMediaConstraints, isVideoOnlyCall, createMirroredCamera, mergeRemoteTrack, playCallMedia } from '@/lib/callMedia';
import { createCandidateQueue, createRtcSignaling, startSerialPoll, RTC_INITIAL_TIMEOUT, RTC_DISCONNECT_GRACE, RTC_RESTART_TIMEOUT, type RtcDescription } from '@/lib/rtcSignaling';
import { rtcConfiguration, rtcFailureMessage } from '@/lib/rtcConfiguration';
import '@/styles/call-ui.css';

type QueueEntry = OnlineUser & {
  status?: 'waiting' | 'matched';
  callId?: string;
  opponent?: TetrisQueueProfile;
};

type CallDocument = {
  callId: string;
  callerId: string;
  calleeId: string;
  status?: 'offer' | 'answer' | 'connected' | 'ended';
  offer?: RtcDescription;
  answer?: RtcDescription | null;
  mediaMode?: 'camera' | 'screen';
  systemAudio?: boolean;
};

type CandidateDocument = {
  callId: string;
  fromUserId: string;
  candidate: RTCIceCandidateInit;
};
type VideoChatMessage = { id: string; callId: string; authorId: string; user: string; text: string; createdAt: string; expiresAt: string };

type ActiveCall = {
  callId: string;
  peer: QueueEntry;
  initiator: boolean;
};

const requestMediaWithTimeout = (constraints: MediaStreamConstraints) => new Promise<MediaStream>((resolve, reject) => {
  let timedOut = false;
  const timer = window.setTimeout(() => {
    timedOut = true;
    reject(new Error('미디어 권한 응답이 지연되고 있습니다. 브라우저 권한을 확인해주세요.'));
  }, 12000);
  navigator.mediaDevices.getUserMedia(constraints).then((stream) => {
    window.clearTimeout(timer);
    if (timedOut) stream.getTracks().forEach((track) => track.stop());
    else resolve(stream);
  }, (error) => { window.clearTimeout(timer); reject(error); });
});

function formatCallDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
  const remainder = (seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${remainder}`;
}

export default function WebRTCPage() {
  const router = useRouter();
  const user = useGlobalStore((state) => state.user);
  const setUser = useGlobalStore((state) => state.setUser);
  const [isMatching, setIsMatching] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [permissionError, setPermissionError] = useState('');
  const [status, setStatus] = useState('대기 중');
  const [peer, setPeer] = useState<QueueEntry | null>(null);
  const [hasRemoteVideo, setHasRemoteVideo] = useState(false);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [videoOnly, setVideoOnly] = useState(true);
  const videoOnlyRef = useRef(true);
  const [isSharingScreen, setIsSharingScreen] = useState(false);
  const [remoteSharingScreen, setRemoteSharingScreen] = useState(false);
  const [remoteSystemAudio, setRemoteSystemAudio] = useState(false);
  const [flip, setFlip] = useState(true);
  const [active, setActive] = useState(false);
  const [activeCallId, setActiveCallId] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<VideoChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatError, setChatError] = useState('');
  const [genderPreference, setGenderPreference] = useState<GenderPreference>(user?.genderPreference || 'any');
  const [ageMin, setAgeMin] = useState(18);
  const [ageMax, setAgeMax] = useState(60);
  const [targetUserId, setTargetUserId] = useState('');
  const [callKind, setCallKind] = useState<'random' | 'friend' | 'game'>('random');
  const [compactMode, setCompactMode] = useState(false);
  const [autoStart, setAutoStart] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [hasEnded, setHasEnded] = useState(false);
  const [callElapsed, setCallElapsed] = useState(0);
  const [adultConsent, setAdultConsent] = useState(false);
  const [showRandomConsent, setShowRandomConsent] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [reportCategory, setReportCategory] = useState<'sexual_content' | 'minor_safety' | 'harassment' | 'privacy' | 'spam' | 'other'>('harassment');
  const [reportDetails, setReportDetails] = useState('');
  const [safetyActionError, setSafetyActionError] = useState('');
  const [safetyActionBusy, setSafetyActionBusy] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const sidebarVideoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const connectionRef = useRef<RTCPeerConnection | null>(null);
  const callRef = useRef<ActiveCall | null>(null);
  const connectionStartedAt = useRef<number | null>(null);
  const queueStartedAtRef = useRef<number | null>(null);
  const signalingErrorAtRef = useRef<number | null>(null);
  const connectedAtRef = useRef<number | null>(null);
  const connectedRef = useRef(false);
  const userRef = useRef(user);
  const candidateQueueRef = useRef(createCandidateQueue());
  const signalingRef = useRef<ReturnType<typeof createRtcSignaling> | null>(null);
  const pendingCandidatesRef = useRef(new Map<string, RTCIceCandidateInit>());
  const relaySeenRef = useRef(false);
  const restartAtRef = useRef<number | null>(null);
  const disconnectedAtRef = useRef<number | null>(null);
  const chargedMatchIds = useRef(new Set<string>());
  const flipRef = useRef(flip);
  const outgoingVideoTrackRef = useRef<MediaStreamTrack | null>(null);
  const mirrorRef = useRef<ReturnType<typeof createMirroredCamera> | null>(null);
  const videoSenderRef = useRef<RTCRtpSender | null>(null);
  const audioSenderRef = useRef<RTCRtpSender | null>(null);
  const screenTrackRef = useRef<MediaStreamTrack | null>(null);
  const screenAudioTrackRef = useRef<MediaStreamTrack | null>(null);
  const mixedAudioTrackRef = useRef<MediaStreamTrack | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const autoStartRef = useRef(false);
  const operationRef = useRef(0);
  const startedRef = useRef(false);
  const startingRef = useRef(false);
  const terminalRef = useRef(false);
  const mountedRef = useRef(true);
  const blockedUserIdsRef = useRef<string[]>([]);
  const stopPollRef = useRef<(() => void) | null>(null);
  const queueProfileRef = useRef<TetrisQueueProfile | null>(null);
  const queueNeedsResetRef = useRef(false);
  const queueWorkRef = useRef<Promise<unknown>>(Promise.resolve());
  const callIdentityRef = useRef({ id: '', kind: 'random', targetUserId: '' });
  const targetedCall = Boolean(targetUserId) || callKind !== 'random';
  const matchGenderPreference = targetedCall ? 'any' : genderPreference;

  const signalEnded = (callId?: string) => {
    const identity = callIdentityRef.current;
    const terminalId = identity.id ? `webrtc-end-${identity.kind}-${identity.id}` : '';
    // The shared admission marker also covers hangup before the queue is matched.
    for (const id of new Set([callId, terminalId].filter((value): value is string => Boolean(value)))) {
      const markerIdentity = id === terminalId && userRef.current && identity.targetUserId
        ? { callerId: userRef.current.id, calleeId: identity.targetUserId } : {};
      void getFreshSessionToken().then((token) => {
        if (token) return mergeDocument('webrtcCalls', id, { ...markerIdentity, status: 'ended', endedAt: new Date() }, token);
      }).catch(() => undefined);
    }
  };

  const publishMediaState = async (mediaMode: 'camera' | 'screen', systemAudio: boolean) => {
    const callId = callRef.current?.callId;
    if (!callId || terminalRef.current) return;
    const token = await getFreshSessionToken().catch(() => null);
    if (!token) return;
    await mergeDocument('webrtcCalls', callId, { mediaMode, systemAudio, mediaUpdatedAt: new Date() }, token).catch(() => undefined);
  };

  const queueWrite = <T,>(work: () => Promise<T>) => {
    const pending = queueWorkRef.current.catch(() => undefined).then(work);
    queueWorkRef.current = pending;
    return pending;
  };

  const resetSignalingState = () => {
    candidateQueueRef.current = createCandidateQueue();
    signalingRef.current = null;
    pendingCandidatesRef.current.clear();
    relaySeenRef.current = false;
    restartAtRef.current = null;
    disconnectedAtRef.current = null;
    signalingErrorAtRef.current = null;
  };

  useEffect(() => {
    flipRef.current = flip;
  }, [flip]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    videoOnlyRef.current = isVideoOnlyCall(window.location.search);
    setVideoOnly(videoOnlyRef.current);
    setTargetUserId(params.get('friend') || '');
    setCallKind(params.get('gameRoom') || params.get('callKind') === 'game' ? 'game' : params.get('friend') ? 'friend' : 'random');
    setCompactMode(params.get('compact') === '1');
    setAutoStart(params.get('auto') === '1');
    callIdentityRef.current = {
      id: params.get('gameRoom') || params.get('callId') || '',
      kind: params.get('gameRoom') || params.get('callKind') === 'game' ? 'game' : params.get('friend') ? 'friend' : 'random',
      targetUserId: params.get('friend') || '',
    };
  }, []);

  useEffect(() => {
    if (!compactMode) return;
    document.body.classList.add('webrtc-compact-shell');
    return () => document.body.classList.remove('webrtc-compact-shell');
  }, [compactMode]);

  useEffect(() => {
    if (!isConnected) {
      connectedAtRef.current = null;
      setCallElapsed(0);
      return;
    }
    connectedAtRef.current ||= Date.now();
    const timer = window.setInterval(() => {
      if (connectedAtRef.current) setCallElapsed(Math.floor((Date.now() - connectedAtRef.current) / 1_000));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [isConnected]);

  useEffect(() => {
    if (startedRef.current && userRef.current?.id !== user?.id) endMatch('로그인 계정이 변경되어 통화를 종료했습니다.');
    userRef.current = user;
    if (!user) return;
    if (!active) {
      setGenderPreference(user.genderPreference || 'any');
    }
  }, [user, active]);

  const requestMedia = async (operation: number) => {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('이 브라우저는 카메라 연결을 지원하지 않습니다.');
    if (!streamRef.current) {
      let stream: MediaStream;
      try {
        stream = await requestMediaWithTimeout(callMediaConstraints(videoOnlyRef.current));
      } catch (error) {
        if (operation !== operationRef.current || !mountedRef.current) return;
        if (error instanceof DOMException && error.name === 'NotFoundError') {
          stream = await requestMediaWithTimeout({ video: true, audio: false });
        } else {
          throw error;
        }
      }
      if (operation !== operationRef.current || !mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      if (videoOnlyRef.current) stream.getAudioTracks().forEach((track) => { track.stop(); stream.removeTrack(track); });
      streamRef.current = stream;
    }
    if (videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      void videoRef.current.play().catch(() => undefined);
    }
    if (operation === operationRef.current && streamRef.current) setAudioEnabled(streamRef.current.getAudioTracks().some((track) => track.enabled));
  };

  const toggleMicrophone = () => {
    if (videoOnlyRef.current) return;
    const next = !audioEnabled;
    streamRef.current?.getAudioTracks().forEach((track) => { track.enabled = next; });
    setAudioEnabled(next);
  };

  const stopOutgoingVideo = () => {
    mirrorRef.current?.stop();
    mirrorRef.current = null;
    outgoingVideoTrackRef.current = null;
  };

  const restoreCameraTrack = async () => {
    const operation = operationRef.current;
    if (terminalRef.current) return;
    const screenTrack = screenTrackRef.current;
    screenTrackRef.current = null;
    if (screenTrack) screenTrack.onended = null;
    screenTrack?.stop();
    const cameraTrack = outgoingVideoTrackRef.current || streamRef.current?.getVideoTracks()[0] || null;
    const microphoneTrack = videoOnlyRef.current ? null : streamRef.current?.getAudioTracks()[0] || null;
    if (videoSenderRef.current && cameraTrack) await videoSenderRef.current.replaceTrack(cameraTrack).catch(() => undefined);
    if (terminalRef.current || operation !== operationRef.current) return;
    if (audioSenderRef.current && microphoneTrack) await audioSenderRef.current.replaceTrack(microphoneTrack).catch(() => undefined);
    if (terminalRef.current || operation !== operationRef.current) return;
    screenAudioTrackRef.current?.stop();
    screenAudioTrackRef.current = null;
    mixedAudioTrackRef.current?.stop();
    mixedAudioTrackRef.current = null;
    await audioContextRef.current?.close().catch(() => undefined);
    if (terminalRef.current || operation !== operationRef.current) return;
    audioContextRef.current = null;
    if (videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      await videoRef.current.play().catch(() => undefined);
    }
    if (terminalRef.current || operation !== operationRef.current) return;
    setIsSharingScreen(false);
    void publishMediaState('camera', false);
  };

  const toggleScreenShare = async () => {
    const operation = operationRef.current;
    const cancelled = () => terminalRef.current || operation !== operationRef.current || !mountedRef.current;
    if (cancelled() || videoOnlyRef.current) return;
    if (isSharingScreen) {
      await restoreCameraTrack();
      return;
    }
    if (!videoSenderRef.current || !navigator.mediaDevices?.getDisplayMedia) {
      setPermissionError('연결 후 화면 공유를 사용할 수 있습니다.');
      return;
    }
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true });
      if (cancelled()) {
        display.getTracks().forEach((track) => track.stop());
        return;
      }
      const screenTrack = display.getVideoTracks()[0];
      if (!screenTrack) { display.getTracks().forEach((track) => track.stop()); return; }
      screenTrackRef.current = screenTrack;
      const systemAudioTrack = display.getAudioTracks()[0] || null;
      screenAudioTrackRef.current = systemAudioTrack;
      await videoSenderRef.current!.replaceTrack(screenTrack);
      if (cancelled()) return;
      if (systemAudioTrack && audioSenderRef.current) {
        const context = new AudioContext();
        const destination = context.createMediaStreamDestination();
        context.createMediaStreamSource(new MediaStream([systemAudioTrack])).connect(destination);
        const microphoneTrack = streamRef.current?.getAudioTracks()[0];
        if (microphoneTrack) context.createMediaStreamSource(new MediaStream([microphoneTrack])).connect(destination);
        const mixedTrack = destination.stream.getAudioTracks()[0] || systemAudioTrack;
        audioContextRef.current = context;
        mixedAudioTrackRef.current = mixedTrack;
        await audioSenderRef.current.replaceTrack(mixedTrack);
        if (cancelled()) return;
      }
      screenTrack.onended = () => { void restoreCameraTrack(); };
      if (videoRef.current) {
        videoRef.current.srcObject = new MediaStream([screenTrack, ...(streamRef.current?.getAudioTracks() || []), ...(systemAudioTrack ? [systemAudioTrack] : [])]);
        await videoRef.current.play().catch(() => undefined);
      }
      if (cancelled()) return;
      setIsSharingScreen(true);
      void publishMediaState('screen', Boolean(systemAudioTrack));
    } catch (error) {
      if (cancelled()) return;
      await restoreCameraTrack();
      if (cancelled()) return;
      if (error instanceof DOMException && error.name === 'NotAllowedError') return;
      setPermissionError('화면 공유를 시작하지 못했습니다. 브라우저 권한을 확인해주세요.');
    }
  };

  const getOutgoingStream = () => {
    if (!streamRef.current) return null;
    if (!outgoingVideoTrackRef.current) {
      try {
        mirrorRef.current = createMirroredCamera(streamRef.current, () => flipRef.current);
        outgoingVideoTrackRef.current = mirrorRef.current.track;
      } catch {
        // Use the camera track directly when this browser cannot capture a canvas.
        mirrorRef.current = null;
        outgoingVideoTrackRef.current = streamRef.current.getVideoTracks()[0] || null;
      }
    }
    const tracks = [
      ...(outgoingVideoTrackRef.current ? [outgoingVideoTrackRef.current] : streamRef.current.getVideoTracks()),
      ...(videoOnlyRef.current ? [] : streamRef.current.getAudioTracks()),
    ];
    return new MediaStream(tracks);
  };

  /* The caller's camera is mirrored in the outgoing canvas, so the peer sees the same orientation. */
  const createOutgoingStream = () => getOutgoingStream() || streamRef.current;

  const closeCallForRematch = (message: string) => {
    if (targetedCall) {
      endMatch('통화가 종료되었습니다. 새 통화 요청으로 다시 연결해주세요.');
      return;
    }
    if (terminalRef.current) return;
    operationRef.current += 1;
    const callId = callRef.current?.callId;
    if (connectionRef.current) {
      connectionRef.current.onconnectionstatechange = null;
      connectionRef.current.oniceconnectionstatechange = null;
      connectionRef.current.ontrack = null;
      connectionRef.current.onicecandidate = null;
    }
    connectionRef.current?.close();
    connectionRef.current = null;
    if (screenTrackRef.current) screenTrackRef.current.onended = null;
    screenTrackRef.current?.stop();
    screenTrackRef.current = null;
    screenAudioTrackRef.current?.stop();
    screenAudioTrackRef.current = null;
    mixedAudioTrackRef.current?.stop();
    mixedAudioTrackRef.current = null;
    void audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = null;
    audioSenderRef.current = null;
    setIsSharingScreen(false);
    remoteStreamRef.current?.getTracks().forEach((track) => track.stop());
    remoteStreamRef.current = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    if (sidebarVideoRef.current) sidebarVideoRef.current.srcObject = null;
    if (videoRef.current && streamRef.current) void playCallMedia(videoRef.current, streamRef.current, true);
    videoSenderRef.current = null;
    callRef.current = null;
    resetSignalingState();
    connectedRef.current = false;
    connectionStartedAt.current = null;
    setIsConnected(false);
     setHasRemoteVideo(false);
     setRemoteSharingScreen(false);
     setRemoteSystemAudio(false);
    setPeer(null);
    setActiveCallId(null);
    setIsMatching(true);
    setStatus(message);
    // The serial poll recreates our waiting entry; no detached delete can erase it.
    if (callId) signalEnded(callId);
    queueNeedsResetRef.current = true;
  };

  const requestSafetyGuard = async (action: 'match' | 'message' | 'report' | 'block') => {
    const token = await getFreshSessionToken();
    if (!token) throw new Error('로그인이 필요합니다.');
    const response = await fetch('/api/safety/guard', {
      method: 'POST',
         headers: { 'Content-Type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ action, automated: Boolean(navigator.webdriver) }),
    });
    const result = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) throw new Error(result.error || '안전 확인에 실패했습니다.');
  };

  const blockPeer = async () => {
    if (!peer || !user || safetyActionBusy) return;
    if (!window.confirm('이 상대를 차단하고 현재 연결을 종료할까요?')) return;
    const token = await getFreshSessionToken();
    if (!token) return;
    setSafetyActionBusy(true);
    setSafetyActionError('');
    try {
      if (!allowClientAction(`${user.id}:block`, 30, 60 * 60_000)) throw new Error('차단 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.');
      await requestSafetyGuard('block');
      await createUserBlock(user.id, peer.userId, peer.name, activeCallId || undefined, token);
      await createSafetyAuditLog({ actorId: user.id, action: 'block', targetUserId: peer.userId, callId: activeCallId || undefined }, token);
      endMatch('상대를 차단했습니다. 해당 상대와 다시 연결되지 않습니다.');
    } catch (error) {
      setSafetyActionError(error instanceof Error ? error.message : '차단하지 못했습니다.');
    } finally {
      setSafetyActionBusy(false);
    }
  };

  const submitReport = async () => {
    if (!peer || !user || !activeCallId || safetyActionBusy) return;
    const token = await getFreshSessionToken();
    if (!token) return;
    setSafetyActionBusy(true);
    setSafetyActionError('');
    try {
      if (!allowClientAction(`${user.id}:report`, 10, 60 * 60_000)) throw new Error('신고 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.');
      await requestSafetyGuard('report');
      await createSafetyReport({ reporterId: user.id, reportedUserId: peer.userId, callId: activeCallId, category: reportCategory, details: reportDetails, createdAt: new Date(), status: 'open' }, token);
      await createSafetyAuditLog({ actorId: user.id, action: 'report', targetUserId: peer.userId, callId: activeCallId, metadata: reportCategory }, token);
      setShowReport(false);
      setReportDetails('');
      endMatch('신고가 접수되었습니다. 안전을 위해 연결을 종료했습니다.');
    } catch (error) {
      setSafetyActionError(error instanceof Error ? error.message : '신고를 접수하지 못했습니다.');
    } finally {
      setSafetyActionBusy(false);
    }
  };

  const startMatch = async (consentOverride = false) => {
    if (startingRef.current || active || (terminalRef.current && targetedCall)) return;
    if (!user) {
      window.alert('로그인이 필요합니다.');
      return;
    }
    let token = await getFreshSessionToken();
    if (!token) {
      window.alert('로그인 세션이 만료되었습니다. 다시 로그인해주세요.');
      return;
    }
    if (typeof user.age !== "number" || user.age < RANDOM_VIDEO_MIN_AGE) {
      setPermissionError('영상채팅은 만 18세 이상 인증 회원만 이용할 수 있습니다.');
      setStatus('18세 이상 이용 가능');
      return;
    }
    if (callKind === 'random' && !adultConsent && !consentOverride) {
      setPermissionError('랜덤 화상채팅은 만 18세 이상이며 안전수칙에 동의해야 시작할 수 있습니다.');
      setStatus('안전수칙 동의 필요');
      return;
    }
    const operation = ++operationRef.current;
    const cancelled = () => operation !== operationRef.current || !mountedRef.current;
    terminalRef.current = false;
    startedRef.current = true;
    startingRef.current = true;
    setIsStarting(true);
    let blockedUserIds: string[];
    try {
      await queueWorkRef.current.catch(() => undefined);
      token = await getFreshSessionToken();
      if (cancelled()) return;
      if (!token) throw new Error('로그인 세션이 만료되었습니다. 다시 로그인해주세요.');
      const moderation = await getAccountModeration(user.id, token);
      if (cancelled()) return;
      if (moderation?.status === 'banned' || (moderation?.status === 'suspended' && (!moderation.until || new Date(moderation.until).getTime() > Date.now()))) {
        throw new Error(moderation.reason || '안전 정책 위반으로 영상채팅 이용이 제한된 계정입니다.');
      }
      if (!allowClientAction(`${user.id}:match`, 3, 5 * 60_000)) throw new Error('매칭 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.');
      await requestSafetyGuard('match');
      if (cancelled()) return;
      blockedUserIds = await listBlockedUserIds(user.id, token);
      if (cancelled()) return;
      if (!targetedCall && ageMin > ageMax) throw new Error('최소 나이는 최대 나이보다 작거나 같아야 합니다.');
    } catch (error) {
      if (cancelled()) return;
      startingRef.current = false;
      setIsStarting(false);
      setPermissionError(error instanceof Error ? error.message : '안전 확인에 실패했습니다.');
      return;
    }
    blockedUserIdsRef.current = blockedUserIds;
    setHasEnded(false);
    setIsStarting(true);
    setStatus(videoOnlyRef.current ? '카메라 권한을 확인하는 중 · 마이크 사용 안 함' : '카메라와 마이크 권한을 확인하는 중');
    setPermissionError('');
    const profile = targetedCall ? user : { ...user, genderPreference };
    const videoAlias = getVideoAlias(user.id, user.name, callKind !== 'random');
    const profileChanged = profile.genderPreference !== user.genderPreference;
    if (profileChanged) {
      try {
        await saveProfile(profile, token);
      } catch {
        if (cancelled()) return;
        setPermissionError('프로필 저장은 지연되고 있지만 현재 설정으로 연결을 계속합니다.');
      }
    }
    if (cancelled()) return;
    if (!targetedCall) setUser(profile);
    try {
      await requestMedia(operation);
      if (cancelled()) return;
      getOutgoingStream();
      try {
        await mirrorRef.current?.ready;
      } catch (error) {
        // Canvas capture can be unavailable or blocked on some mobile browsers.
        // Keep the call alive with the real camera track instead of failing before signaling.
        stopOutgoingVideo();
        outgoingVideoTrackRef.current = streamRef.current?.getVideoTracks()[0] || null;
        if (!outgoingVideoTrackRef.current) throw error;
      }
      if (cancelled()) return;
    } catch (error) {
      if (cancelled()) return;
      startingRef.current = false;
      setIsStarting(false);
      setStatus('카메라 권한 확인 필요');
      stopOutgoingVideo();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      const name = error instanceof DOMException ? error.name : error instanceof Error ? error.message : '알 수 없는 오류';
      if (name === 'NotFoundError') {
        setPermissionError(videoOnlyRef.current ? '이 기기에서 카메라를 찾을 수 없습니다.' : '이 기기에서 카메라 또는 마이크를 찾을 수 없습니다. 장치 연결 상태를 확인해주세요.');
      } else if (name === 'NotAllowedError' || name === 'SecurityError') {
        setPermissionError(videoOnlyRef.current ? '카메라 권한이 필요합니다. 마이크는 사용하지 않습니다.' : '카메라와 마이크 권한이 필요합니다. 브라우저 주소창의 권한 설정을 확인해주세요.');
      } else {
        setPermissionError(`미디어 연결을 준비하지 못했습니다: ${name}`);
      }
      return;
    }
    if (cancelled()) return;
    resetSignalingState();
    callRef.current = null;
    setPeer(null);
    setIsConnected(false);
    setHasRemoteVideo(false);
    setStatus(targetedCall ? '수락한 상대에게 연결하는 중' : '다른 인증 회원을 찾는 중');
    setIsMatching(true);
    queueNeedsResetRef.current = false;
    queueProfileRef.current = { id: user.id, name: videoAlias, image: user.image, country: user.country || 'Global', age: user.age, gender: user.gender || '', genderPreference: matchGenderPreference, ageMin, ageMax, isSubscribed: Boolean(user.isSubscribed), targetUserId: targetUserId || undefined, queueKind: callKind };
    const queued = await queueWrite(() => cancelled() ? Promise.resolve() : mergeDocument('webrtcQueue', user.id, {
      userId: user.id,
      name: videoAlias,
      image: user.image,
       age: user.age || 0,
      country: user.country || 'Global',
       gender: user.gender || '',
         genderPreference: matchGenderPreference,
        ageMin,
        ageMax,
        targetUserId: targetUserId || undefined,
       queueKind: callKind,
       isSubscribed: Boolean(user.isSubscribed),
       status: 'waiting',
      lastSeenAt: new Date(),
    }, token)).then(() => true).catch((error) => {
      if (cancelled()) return false;
      const detail = error instanceof Error ? error.message.slice(0, 180) : '알 수 없는 오류';
      setPermissionError(`매칭 서버 오류: ${detail}`);
      return false;
    });
    if (cancelled()) {
      return;
    }
    startingRef.current = false;
    setIsStarting(false);
    if (!queued) {
      endMatch('매칭 서버에 연결하지 못했습니다.');
      return;
    }
    queueStartedAtRef.current = Date.now();
    setActive(true);
  };

  const startMatchFromUi = () => {
    if (callKind === 'random' && !adultConsent) {
      setShowRandomConsent(true);
      return;
    }
    void startMatch();
  };

  const acceptRandomConsent = () => {
    setAdultConsent(true);
    setShowRandomConsent(false);
    void startMatch(true);
  };

  const rejectRandomConsent = () => {
    setShowRandomConsent(false);
    if (window.history.length > 1) router.back();
    else router.push('/');
  };

  useEffect(() => {
    if (!autoStart || !targetUserId || !user || active || autoStartRef.current || terminalRef.current) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled || terminalRef.current) return;
      autoStartRef.current = true;
      void startMatch();
    });
    return () => { cancelled = true; };
  }, [autoStart, callKind, targetUserId, user?.id, active]);

  function endMatch(message = '통화가 종료되었습니다.', notifyParent = true) {
    if (terminalRef.current) return;
    terminalRef.current = true;
    operationRef.current += 1;
    startingRef.current = false;
    stopPollRef.current?.();
    stopPollRef.current = null;
    const currentCall = callRef.current;
    if (mountedRef.current) {
    setIsStarting(false);
    setHasEnded(true);
    setActive(false);
    setIsMatching(false);
     setIsConnected(false);
     setHasRemoteVideo(false);
     setRemoteSharingScreen(false);
     setRemoteSystemAudio(false);
     setPlaybackBlocked(false);
    setPeer(null);
     setActiveCallId(null);
     setChatMessages([]);
    setShowReport(false);
    setReportDetails('');
    setSafetyActionError('');
    setStatus(message);
    }
    if (connectionRef.current) {
      connectionRef.current.onconnectionstatechange = null;
      connectionRef.current.oniceconnectionstatechange = null;
      connectionRef.current.onicecandidate = null;
      connectionRef.current.ontrack = null;
    }
    connectionRef.current?.close();
    connectionRef.current = null;
    stopOutgoingVideo();
    if (screenTrackRef.current) screenTrackRef.current.onended = null;
    screenTrackRef.current?.stop();
    screenTrackRef.current = null;
    screenAudioTrackRef.current?.stop();
    screenAudioTrackRef.current = null;
    mixedAudioTrackRef.current?.stop();
    mixedAudioTrackRef.current = null;
    void audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = null;
    videoSenderRef.current = null;
    audioSenderRef.current = null;
    if (mountedRef.current) setIsSharingScreen(false);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    if (sidebarVideoRef.current) sidebarVideoRef.current.srcObject = null;
    remoteStreamRef.current?.getTracks().forEach((track) => track.stop());
    remoteStreamRef.current = null;
    callRef.current = null;
    resetSignalingState();
    connectionStartedAt.current = null;
    queueStartedAtRef.current = null;
    connectedRef.current = false;
    signalEnded(currentCall?.callId);
    if (userRef.current && startedRef.current) {
      const userId = userRef.current.id;
      void queueWrite(async () => {
        const token = await getFreshSessionToken();
        if (token) await deleteDocument('webrtcQueue', userId, token);
      }).catch(() => undefined);
    }
    const identity = callIdentityRef.current;
    if (notifyParent && identity.id && window.parent !== window) {
      window.parent.postMessage({ type: 'gyopo-call-ended', callKind: identity.kind, callId: identity.id }, window.location.origin);
    }
  }

  useEffect(() => {
    mountedRef.current = true;
    const onMessage = (event: MessageEvent) => {
      const identity = callIdentityRef.current;
      if (window.parent === window || event.origin !== window.location.origin || event.source !== window.parent) return;
      if (!identity.id || event.data?.type !== 'gyopo-call-end' || event.data.callId !== identity.id || event.data.callKind !== identity.kind) return;
      endMatch();
    };
    const onPageHide = () => { if (startedRef.current) endMatch(); };
    window.addEventListener('message', onMessage);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      mountedRef.current = false;
      window.removeEventListener('message', onMessage);
      window.removeEventListener('pagehide', onPageHide);
      if (startedRef.current) endMatch('통화가 종료되었습니다.', false);
    };
  }, []);

  useEffect(() => {
    const identity = callIdentityRef.current;
    if (!targetedCall || !identity.id || !user || hasEnded) return;
    let cancelled = false;
    let polling = false;
    const checkEnd = async () => {
      if (cancelled || polling || terminalRef.current) return;
      polling = true;
      try {
         const token = await getFreshSessionToken();
         if (cancelled || terminalRef.current || !token) return;
         const marker = await getDocument<CallDocument>('webrtcCalls', `webrtc-end-${identity.kind}-${identity.id}`, token).catch(() => null);
        if (!cancelled && marker?.status === 'ended') endMatch('상대가 통화를 종료했습니다.');
      } finally { polling = false; }
    };
    void checkEnd();
    const timer = window.setInterval(() => void checkEnd(), 700);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [targetedCall, callKind, targetUserId, user?.id, hasEnded]);

  useEffect(() => {
    if (!active || !user || terminalRef.current) return;
    let cancelled = false;

    const ensureConnection = (call: ActiveCall) => {
      if (connectionRef.current) return connectionRef.current;
      const operation = operationRef.current;
      const alive = () => !cancelled && mountedRef.current && !terminalRef.current && operation === operationRef.current && connectionRef.current === connection;
      const connection = new RTCPeerConnection(rtcConfiguration(process.env.NEXT_PUBLIC_WEBRTC_ICE_SERVERS, process.env.NEXT_PUBLIC_TURN_USERNAME, process.env.NEXT_PUBLIC_TURN_CREDENTIAL));
      connectionRef.current = connection;
      signalingRef.current = createRtcSignaling(connection, call.initiator, async (signal) => {
        const token = await getFreshSessionToken();
        if (!alive()) return;
        if (!token) throw new Error('로그인 세션이 만료되었습니다. 다시 로그인해주세요.');
        await mergeDocument('webrtcCalls', call.callId, call.initiator
          ? { callId: call.callId, callerId: user.id, calleeId: call.peer.userId, ...signal }
          : signal, token);
        if (!alive()) signalEnded(call.callId);
      }, alive);
      const outgoing = createOutgoingStream();
      outgoing?.getTracks().forEach((track) => {
        if (videoOnlyRef.current && track.kind === 'audio') { track.stop(); return; }
        const sender = connection.addTrack(track, outgoing);
        if (track.kind === 'video') videoSenderRef.current = sender;
        if (track.kind === 'audio') audioSenderRef.current = sender;
      });
      connection.onicecandidate = ({ candidate }) => {
        if (!candidate || !alive()) return;
        if (candidate.type === 'relay') relaySeenRef.current = true;
        // The call document must exist before candidate writes pass admission rules.
        pendingCandidatesRef.current.set(`${call.callId}-${user.id}-${crypto.randomUUID()}`, candidate.toJSON());
      };
      connection.onicecandidateerror = () => {
        if (alive() && !connectedRef.current) setStatus('중계 경로 확인 중 · 연결 실패 시 네트워크/TURN 설정을 확인해주세요');
      };
      connection.ontrack = (event) => {
        if (!alive()) return;
        if (videoOnlyRef.current && event.track.kind === 'audio') { event.track.stop(); return; }
        const remoteStream = remoteStreamRef.current || new MediaStream();
        mergeRemoteTrack(remoteStream, event.track, videoOnlyRef.current);
        remoteStreamRef.current = remoteStream;
        const playback = () => {
          if (!alive()) return;
          setHasRemoteVideo(remoteStream.getVideoTracks().some((track) => track.readyState === 'live' && !track.muted));
          void playCallMedia(remoteVideoRef.current, remoteStream, videoOnlyRef.current).then((played) => { if (alive()) setPlaybackBlocked(!played); });
          if (window.matchMedia('(min-width: 768px)').matches) void playCallMedia(sidebarVideoRef.current, remoteStream, true);
        };
        event.track.onunmute = playback;
        event.track.onmute = playback;
        event.track.onended = playback;
        playback();
      };
      connection.onconnectionstatechange = () => {
        if (!alive()) return;
        if (connection.connectionState === 'connecting') setStatus('보안 연결을 설정하는 중');
        if (connection.connectionState === 'connected') {
          setIsConnected(true);
          connectedRef.current = true;
          setIsMatching(false);
          connectionStartedAt.current = null;
          disconnectedAtRef.current = null;
          restartAtRef.current = null;
          connectedAtRef.current = Date.now();
          setCallElapsed(0);
          setStatus('연결 성공');
        }
        if (connection.connectionState === 'disconnected') {
          connectedRef.current = false;
          disconnectedAtRef.current ||= Date.now();
          setIsConnected(false);
          setStatus('연결이 불안정합니다. 같은 상대와 복구를 기다리는 중');
        }
        if (connection.connectionState === 'failed') {
          connectedRef.current = false;
          disconnectedAtRef.current ||= Date.now() - RTC_DISCONNECT_GRACE;
          setIsConnected(false);
        }
        if (connection.connectionState === 'closed') setStatus('연결 종료');
      };
      connection.oniceconnectionstatechange = () => {
        if (!alive()) return;
        if (connection.iceConnectionState === 'checking') setStatus('네트워크 경로를 확인하는 중');
        if (connection.iceConnectionState === 'connected' || connection.iceConnectionState === 'completed') {
          setStatus('상대 영상 연결 중');
        }
        if (connection.iceConnectionState === 'failed') {
          connectedRef.current = false;
          disconnectedAtRef.current ||= Date.now() - RTC_DISCONNECT_GRACE;
        }
      };
      return connection;
    };

    const poll = async () => {
      if (cancelled || terminalRef.current) return;
      const operation = operationRef.current;
      const stale = () => cancelled || terminalRef.current || !mountedRef.current || operation !== operationRef.current;
      try {
        const token = await getFreshSessionToken();
        if (stale()) return;
        if (!token) { endMatch('로그인 세션이 만료되었습니다. 다시 로그인해주세요.'); return; }
        const current = callRef.current;
        if (!current) {
          if (targetedCall && queueStartedAtRef.current !== null && Date.now() - queueStartedAtRef.current >= RTC_INITIAL_TIMEOUT) {
            endMatch('상대가 연결 대기에 참여하지 못했습니다. 양쪽의 권한과 로그인 상태를 확인한 뒤 새 통화를 요청해주세요.');
            return;
          }
          if (queueNeedsResetRef.current && queueProfileRef.current) {
            const profile = queueProfileRef.current;
            await queueWrite(() => stale() ? Promise.resolve() : mergeDocument('webrtcQueue', user.id, { ...profile, userId: user.id, status: 'waiting', callId: null, opponent: null, lastSeenAt: new Date() }, token));
            if (stale()) return;
            queueNeedsResetRef.current = false;
          }
          const ownQueue = await getDocument<QueueEntry>('webrtcQueue', user.id, token);
          if (stale()) return;
           const makePeer = (profile: TetrisQueueProfile): QueueEntry => ({
            id: profile.id,
            userId: profile.id,
            name: profile.name,
             image: profile.image,
              country: profile.country,
              age: profile.age,
              gender: profile.gender === 'male' || profile.gender === 'female' ? profile.gender : undefined,
             lastSeenAt: new Date().toISOString(),
           });
          let nextCall: ActiveCall | null = null;
           if (ownQueue?.status === 'matched' && ownQueue.callId && ownQueue.opponent) {
            const matchedPeer = makePeer(ownQueue.opponent);
            if (queueProfileRef.current?.targetUserId && matchedPeer.userId !== queueProfileRef.current.targetUserId) {
              endMatch('지정한 상대와 일치하지 않는 통화입니다. 새 통화 요청으로 다시 시도해주세요.');
              return;
            }
            nextCall = { callId: ownQueue.callId, peer: matchedPeer, initiator: user.id < matchedPeer.userId };
          } else {
            await queueWrite(() => stale() ? Promise.resolve() : mergeDocument('webrtcQueue', user.id, { lastSeenAt: new Date() }, token));
            if (stale()) {
              return;
            }
             const profile = queueProfileRef.current;
             const claimed = profile && await queueWrite(() => stale() ? Promise.resolve(null) : claimWebrtcMatch(profile, token, blockedUserIdsRef.current));
            if (claimed) nextCall = { callId: claimed.callId, peer: makePeer(claimed.opponent), initiator: claimed.initiator };
          }
          if (stale()) {
            if (terminalRef.current) {
              signalEnded(nextCall?.callId);
            }
            return;
          }
          if (!nextCall) {
            signalingErrorAtRef.current = null;
            setPermissionError('');
            setStatus(targetedCall ? '수락한 상대의 카메라를 기다리는 중' : '다른 인증 회원을 찾는 중');
            return;
          }
          const existingCall = await getDocument<CallDocument>('webrtcCalls', nextCall.callId, token).catch(() => null);
          if (stale()) return;
          if (existingCall?.status === 'ended') {
            closeCallForRematch('상대가 연결을 종료했습니다. 다른 상대를 자동으로 찾는 중');
            return;
          }
           const currentUser = userRef.current;
             if (!targetedCall && currentUser && (currentUser.genderPreference || 'any') !== 'any' && !chargedMatchIds.current.has(nextCall.callId)) {
             try {
                await reserveGenderMatchStake(currentUser.id, nextCall.callId, 0.25, token);
                if (stale()) return;
               chargedMatchIds.current.add(nextCall.callId);
                const refreshed = await refreshStoredUser().catch(() => null);
                if (stale()) return;
               if (refreshed) setUser(refreshed);
              } catch (error) {
                 if (stale()) return;
                setPermissionError(error instanceof Error ? error.message : 'LIVE CHAT 필터 이용료를 예약하지 못했습니다.');
                 await deleteDocument('webrtcQueue', currentUser.id, token).catch(() => undefined);
                 if (stale()) return;
                 await deleteDocument('webrtcQueue', nextCall.peer.userId, token).catch(() => undefined);
                 if (stale()) return;
                 await mergeDocument('webrtcCalls', nextCall.callId, { status: 'ended' }, token).catch(() => undefined);
                 if (stale()) return;
                setIsMatching(false);
                setActive(false);
                setStatus('결제 후 성별 매칭을 시작할 수 있습니다');
                router.push('/wallet?reason=video-filter');
                return;
             }
           }
           if (stale()) return;
           setPermissionError('');
              callRef.current = nextCall;
           resetSignalingState();
           connectionStartedAt.current = Date.now();
          connectedRef.current = false;
          setActiveCallId(nextCall.callId);
          setPeer(nextCall.peer);
          setIsMatching(false);
          setStatus('상대에게 연결을 요청하는 중');
           ensureConnection(nextCall);
          return;
        }

        await queueWrite(() => stale() ? Promise.resolve() : mergeDocument('webrtcQueue', user.id, { lastSeenAt: new Date() }, token));
        if (stale()) {
          return;
        }
        const connection = ensureConnection(current);
         const call = await getDocument<CallDocument>('webrtcCalls', current.callId, token).catch(() => null);
         if (stale()) return;
         if (call) {
           setRemoteSharingScreen(call.mediaMode === 'screen');
           setRemoteSystemAudio(call.mediaMode === 'screen' && call.systemAudio === true);
         }
         if (call?.status === 'ended') {
          closeCallForRematch('상대가 연결을 종료했습니다. 다른 상대를 자동으로 찾는 중');
          return;
        }
        const now = Date.now();
        const needsRestart = !restartAtRef.current && !connectedRef.current && (
          (disconnectedAtRef.current !== null && now - disconnectedAtRef.current >= RTC_DISCONNECT_GRACE)
          || (connectionStartedAt.current !== null && now - connectionStartedAt.current >= RTC_INITIAL_TIMEOUT));
        if (needsRestart) { restartAtRef.current = now; setStatus('같은 상대와 네트워크 경로를 다시 연결하는 중'); }
        if (restartAtRef.current && now - restartAtRef.current > RTC_RESTART_TIMEOUT) {
          const message = rtcFailureMessage(relaySeenRef.current);
          setPermissionError(message);
          endMatch(message);
          return;
        }
        await signalingRef.current?.sync(call || {}, needsRestart);
        if (stale()) return;
        // Initial offer publication has now created the admission document.
        if (call || (current.initiator && connection.localDescription)) {
          for (const [id, candidate] of pendingCandidatesRef.current) {
            const freshToken = await getFreshSessionToken();
            if (stale()) return;
            if (!freshToken) throw new Error('로그인 세션이 만료되었습니다.');
            const saved = await upsertDocument('webrtcCandidates', id, { callId: current.callId, fromUserId: user.id, candidate }, freshToken).then(() => true).catch(() => false);
            if (stale()) return;
            if (saved) pendingCandidatesRef.current.delete(id);
          }
        }
        const candidates = await queryDocumentsWhere<CandidateDocument>('webrtcCandidates', [{ field: 'callId', op: 'EQUAL', value: current.callId }], token).catch(() => []);
        if (stale()) return;
        for (const item of candidates.filter((candidate) => candidate.callId === current.callId && candidate.fromUserId !== user.id)) {
          candidateQueueRef.current.enqueue(item.id, item.candidate);
        }
        await candidateQueueRef.current.flush(connection, () => !stale());
        if (!stale()) {
          signalingErrorAtRef.current = null;
          setPermissionError('');
        }
      } catch (error) {
        if (!stale()) {
          setStatus('연결 정보 전송 재시도 중');
          setPermissionError(`연결 서버 오류: ${error instanceof Error ? error.message.slice(0, 180) : '네트워크 오류'}`);
          signalingErrorAtRef.current ??= Date.now();
          const since = restartAtRef.current ?? disconnectedAtRef.current ?? connectionStartedAt.current ?? signalingErrorAtRef.current;
          if (since && Date.now() - since > RTC_INITIAL_TIMEOUT + RTC_RESTART_TIMEOUT) {
            const message = `연결 서버 또는 TURN 확인 필요: ${error instanceof Error ? error.message.slice(0, 140) : '네트워크 오류'}`;
            setPermissionError(message);
            endMatch(message);
          }
        }
      }
    };

    const stop = startSerialPoll(poll, 700);
    stopPollRef.current = stop;
    return () => {
      cancelled = true;
      stop();
      if (stopPollRef.current === stop) stopPollRef.current = null;
    };
  }, [active, user?.id]);

  useEffect(() => {
    if (!activeCallId || !user) return;
    let live = true;
    const loadChat = async () => {
      if (!live || terminalRef.current) return;
      const token = await getFreshSessionToken();
      if (!live || terminalRef.current) return;
      if (!token) return;
      await deleteExpiredChatMessages(token, 'webrtcChatMessages').catch(() => undefined);
      if (!live || terminalRef.current) return;
      const rows = await queryDocumentsWhere<Omit<VideoChatMessage, 'id'>>('webrtcChatMessages', [
        { field: 'callId', op: 'EQUAL', value: activeCallId },
      ], token, 60).catch(() => []);
      if (live && !terminalRef.current) setChatMessages(rows.filter((row) => new Date(row.expiresAt).getTime() > Date.now()).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()));
    };
    const stop = startSerialPoll(loadChat, 1500);
    return () => { live = false; stop(); };
  }, [activeCallId, user?.id]);

  const sendVideoChat = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!activeCallId || !user || !chatInput.trim()) return;
    const token = await getFreshSessionToken();
    if (!token) return;
    setChatError('');
    const safety = inspectSafetyText(chatInput);
    if (!safety.allowed) {
      setChatError(safety.message || '안전 정책에 따라 보낼 수 없는 메시지입니다.');
      return;
    }
    if (!allowClientAction(`${user.id}:message`, 20, 60_000)) {
      setChatError('메시지를 너무 빠르게 보내고 있습니다. 잠시 후 다시 시도해주세요.');
      return;
    }
    const message = { callId: activeCallId, authorId: user.id, user: getVideoAlias(user.id, user.name, callKind !== 'random'), text: chatInput.trim(), createdAt: new Date(), expiresAt: new Date(Date.now() + 60_000) };
    try {
      await requestSafetyGuard('message');
      await createDocument('webrtcChatMessages', crypto.randomUUID(), message, token);
      if (terminalRef.current || callRef.current?.callId !== activeCallId) return;
      setChatInput('');
    } catch {
      setChatError('화상 채팅을 보내지 못했습니다.');
    }
  };

  const askSharedAi = async () => {
    if (!activeCallId || !user) return;
    const question = chatInput.trim();
    if (!question) {
      setChatError('AI에게 물어볼 내용을 먼저 입력해주세요.');
      return;
    }
    const safety = inspectSafetyText(question);
    if (!safety.allowed) {
      setChatError(safety.message || '안전 정책에 따라 보낼 수 없는 질문입니다.');
      return;
    }
    const token = await getFreshSessionToken();
    if (!token) return;
    setChatError('AI가 함께 답변을 준비하고 있습니다...');
    try {
      const response = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({
          messages: [...chatMessages.slice(-8).map((message) => ({ role: message.user === 'GYOPO AI' ? 'assistant' : 'user', content: message.text })), { role: 'user', content: question }],
        }),
      });
      const result = await response.json() as { answer?: string; error?: string };
      if (terminalRef.current || callRef.current?.callId !== activeCallId) return;
      if (!response.ok || !result.answer) throw new Error(result.error || 'AI 답변을 가져오지 못했습니다.');
      const aiText = inspectSafetyText(result.answer).allowed ? result.answer : '안전 정책에 따라 외부 연락처나 링크가 포함된 AI 답변은 표시하지 않았습니다.';
      await createDocument('webrtcChatMessages', crypto.randomUUID(), { callId: activeCallId, authorId: user.id, user: 'GYOPO AI', text: aiText, createdAt: new Date(), expiresAt: new Date(Date.now() + 60_000) }, token);
      if (terminalRef.current || callRef.current?.callId !== activeCallId) return;
      setChatInput('');
      setChatError('');
    } catch (error) {
      setChatError(error instanceof Error ? error.message : 'AI 답변을 가져오지 못했습니다.');
    }
  };

  const retryRemotePlayback = () => {
    const stream = remoteStreamRef.current;
    const operation = operationRef.current;
    if (!stream) return;
    void playCallMedia(remoteVideoRef.current, stream, videoOnlyRef.current).then((played) => {
      if (mountedRef.current && !terminalRef.current && operation === operationRef.current) setPlaybackBlocked(!played);
    });
  };

  if (compactMode) {
    return (
      <div className="gyopo-compact-call h-full min-h-0 w-full overflow-hidden bg-[#050914] text-white">
        <div className="relative flex h-full min-h-0 flex-col">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 bg-transparent px-3 py-2">
            <div className="min-w-0">
              <div className="truncate text-[10px] font-black uppercase tracking-[0.18em] text-cyan-200">{callKind === 'friend' ? 'FRIEND' : 'GAME'} {videoOnly ? 'CAMERA ONLY' : 'VOICE + VIDEO'}</div>
              <div className="truncate text-xs font-bold text-slate-300">{peer?.name || '상대방 연결 대기'}</div>
            </div>
             <span className="flex shrink-0 items-center gap-1.5"><span className={`rounded-full px-2 py-1 text-[10px] font-black ${isConnected ? 'bg-emerald-300/15 text-emerald-200' : 'bg-amber-300/15 text-amber-200'}`}>{hasEnded ? 'ENDED' : permissionError ? 'CHECK CAMERA' : isConnected ? 'CONNECTED' : active || isStarting ? 'CONNECTING' : 'READY'}</span>{isConnected && <span className="font-mono text-[11px] font-black text-cyan-100">{formatCallDuration(callElapsed)}</span>}</span>
          </div>

           <div className="relative min-h-0 flex-1 overflow-hidden bg-black">
             <video ref={remoteVideoRef} muted={videoOnly} autoPlay playsInline className={`h-full w-full object-contain bg-[#030611] ${hasRemoteVideo ? 'opacity-100' : 'opacity-0'}`} />
             <span className="absolute left-2 top-2 rounded-md bg-black/65 px-1.5 py-1 text-[9px] font-black text-slate-200">상대 화면</span>
             {playbackBlocked && <button type="button" onClick={retryRemotePlayback} className="absolute left-1/2 top-1/2 z-20 -translate-x-1/2 rounded-lg bg-cyan-300 px-4 py-3 text-sm font-bold text-slate-950">상대 영상/소리 재생</button>}
             {!hasRemoteVideo && <div className="call-connecting-overlay absolute inset-0 grid place-items-center bg-[radial-gradient(circle_at_center,#172b50,#050914_72%)] p-3 text-center" role="status"><div>{!hasEnded && !permissionError ? <div className="call-connecting-logo" aria-label="GYOPO 연결 중">{'GYOPO'.split('').map((letter, index) => <span key={index} style={{ animationDelay: `${index * 100}ms` }} aria-hidden="true">{letter}</span>)}</div> : <VideoOff size={24} className="mx-auto mb-2 text-slate-400" />}<p className="mt-2 text-xs font-black">{status}</p></div></div>}
             <div className={`call-local-preview absolute bottom-2 right-2 w-[30%] max-w-[160px] overflow-hidden rounded-xl border border-white/80 bg-black shadow-xl ${!active || permissionError ? 'hidden' : ''}`}>
               <span className="absolute left-1.5 top-1.5 z-10 rounded-md bg-black/65 px-1.5 py-1 text-[8px] font-black text-white">내 화면</span>
               <video ref={videoRef} muted autoPlay playsInline className={`aspect-video h-full w-full object-contain bg-[#030611] ${flip ? 'scale-x-[-1]' : ''}`} />
             </div>
          </div>

           {permissionError && !hasEnded && <div className="call-permission-error" role="alert"><span>{permissionError}</span>{!active && <button type="button" onClick={startMatchFromUi} disabled={isStarting}>권한 확인 후 다시 시도</button>}</div>}
          <div className="call-compact-controls grid shrink-0 grid-cols-3 gap-1.5 border-t border-white/10 bg-[#10182b] p-2">
             <button type="button" onClick={toggleMicrophone} disabled={!active || videoOnly} className="flex min-h-9 items-center justify-center gap-1 rounded-lg border border-white/10 bg-white/5 px-1 text-[10px] font-black disabled:opacity-40">{audioEnabled ? <Mic size={13} /> : <MicOff size={13} />}{videoOnly ? '마이크 차단' : audioEnabled ? '마이크' : '음소거'}</button>
              <button type="button" onClick={() => void toggleScreenShare()} disabled={!isConnected || videoOnly} className="flex min-h-9 items-center justify-center gap-1 rounded-lg border border-cyan-300/20 bg-cyan-300/10 px-1 text-[10px] font-black text-cyan-100 disabled:opacity-40"><MonitorUp size={13} />{isSharingScreen ? '공유 중지' : '화면 공유'}</button>
            <button type="button" onClick={() => endMatch()} disabled={hasEnded} className="flex min-h-9 items-center justify-center gap-1 rounded-lg bg-rose-500/90 px-1 text-[10px] font-black text-white disabled:opacity-40"><VideoOff size={13} />종료</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {showRandomConsent && <div className="fixed inset-0 z-[90] grid place-items-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="random-chat-consent-title"><div className="random-chat-consent w-full max-w-lg p-6"><div className="flex items-start gap-3"><ShieldAlert size={22} className="mt-0.5 shrink-0 text-amber-200" /><div><h2 id="random-chat-consent-title" className="text-lg font-black text-white">랜덤 화상채팅 이용 안내</h2><p className="mt-3 text-sm leading-6 text-slate-300">만 18세 이상만 이용할 수 있습니다. 실명·전화번호·주소·외부 연락처·링크를 공유하지 말고, 불쾌하거나 위험한 상황에서는 즉시 종료·신고·차단해주세요. 안전수칙에 동의하면 카메라와 마이크 연결을 시작합니다.</p></div></div><div className="mt-6 flex gap-2"><button type="button" onClick={rejectRandomConsent} className="flex-1 border border-white/10 bg-white/[.06] py-3 text-sm font-black text-slate-300">거절하고 이전 화면</button><button type="button" onClick={acceptRandomConsent} className="flex-1 bg-cyan-300 py-3 text-sm font-black text-slate-950">동의하고 시작</button></div></div></div>}
    <div className="webrtc-page min-h-[calc(100vh-64px)] bg-[#080d1c] px-4 py-8 text-white">
      <div className="webrtc-shell mx-auto max-w-6xl">
         <header className="category-header category-header-workspace mb-6 flex flex-wrap items-end justify-between gap-4">
            <div className="webrtc-title-stack"><div className="mb-2 text-xs font-black uppercase tracking-[0.28em] text-cyan-300">LIVE CHAT</div><h1 className="text-3xl font-black tracking-tight md:text-5xl">LIVE CHAT</h1><p className="mt-2 text-sm text-slate-400">현재 접속 중인 인증 회원과 자동으로 연결됩니다.</p></div>
         </header>

         <section className="mb-5 grid gap-3 border border-amber-300/20 bg-amber-300/[.06] p-4 text-sm text-amber-50 lg:grid-cols-[1fr_auto] lg:items-center">
           <div><div className="flex items-center gap-2 font-black"><ShieldAlert size={17} className="text-amber-200" /> 랜덤 화상채팅 안전정책</div><p className="mt-1 text-xs leading-5 text-amber-100/70">만 18세 이상만 이용할 수 있습니다. 실명·전화번호·주소·외부 연락처·링크 공유는 차단되며, 신고·차단·계정 정지와 운영자 검토가 적용됩니다.</p></div>
            {callKind === 'random' && <p className="text-xs font-bold text-amber-100">시작 버튼을 누르면 안전수칙 동의 화면이 먼저 표시됩니다.</p>}
         </section>

         {peer && <section className="mb-5 border border-rose-300/20 bg-rose-300/[.05] p-4">
           <div className="flex flex-wrap items-center justify-between gap-3"><div><div className="text-xs font-black uppercase tracking-[.18em] text-rose-200">상대방 안전 도구</div><p className="mt-1 text-xs text-slate-400">불쾌하거나 위험한 상황이면 즉시 종료하고 신고 또는 차단하세요.</p></div><div className="flex gap-2"><button type="button" onClick={() => setShowReport((value) => !value)} disabled={safetyActionBusy} className="inline-flex items-center gap-1.5 border border-rose-300/25 px-3 py-2 text-xs font-black text-rose-100 disabled:opacity-50"><Flag size={14} /> 신고</button><button type="button" onClick={() => void blockPeer()} disabled={safetyActionBusy} className="inline-flex items-center gap-1.5 border border-white/10 px-3 py-2 text-xs font-black text-slate-200 disabled:opacity-50"><Ban size={14} /> 차단</button></div></div>
           {showReport && <div className="mt-3 grid gap-2 sm:grid-cols-[180px_1fr_auto]"><select value={reportCategory} onChange={(event) => setReportCategory(event.target.value as typeof reportCategory)} className="border border-white/10 bg-black/20 px-3 py-2 text-xs text-white outline-none"><option value="sexual_content">성적·불법 콘텐츠</option><option value="minor_safety">미성년자 안전 우려</option><option value="harassment">괴롭힘·위협</option><option value="privacy">개인정보 노출</option><option value="spam">도배·사기·악성 링크</option><option value="other">기타</option></select><input value={reportDetails} onChange={(event) => setReportDetails(event.target.value.slice(0, 500))} maxLength={500} placeholder="상황을 간단히 설명해주세요 (선택)" className="min-w-0 border border-white/10 bg-black/20 px-3 py-2 text-xs text-white outline-none" /><button type="button" onClick={() => void submitReport()} disabled={safetyActionBusy} className="bg-rose-500 px-3 py-2 text-xs font-black text-white disabled:opacity-50">{safetyActionBusy ? '처리 중...' : '신고 접수'}</button></div>}
           {safetyActionError && <p className="mt-2 text-xs font-bold text-rose-200">{safetyActionError}</p>}
         </section>}

         <div className="webrtc-grid grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
           <section className="relative aspect-video overflow-hidden rounded-[2rem] border border-white/10 bg-black shadow-2xl">
             {playbackBlocked && <button type="button" onClick={retryRemotePlayback} className="absolute left-1/2 top-1/2 z-20 -translate-x-1/2 rounded-lg bg-cyan-300 px-4 py-3 text-sm font-bold text-slate-950">상대 영상/소리 재생</button>}
             <video ref={remoteVideoRef} muted={videoOnly} autoPlay playsInline className={`h-full w-full object-contain bg-[#030611] transition-opacity ${hasRemoteVideo ? 'opacity-100' : 'opacity-0'}`} />
            {!hasRemoteVideo && <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[radial-gradient(circle_at_center,#172b50,#050914_70%)] text-center"><div className="rounded-full border border-cyan-300/20 bg-cyan-300/10 p-5">{isMatching || active ? <LoaderCircle size={42} className="animate-spin text-cyan-300" /> : <Camera size={42} className="text-slate-500" />}</div><div><p className="text-xl font-black">{active ? status : '연결 대기 중'}</p><p className="mt-2 text-sm text-slate-400">{active ? '상대방의 카메라 연결을 기다리고 있습니다.' : '시작 버튼을 누르면 카메라와 마이크를 준비합니다.'}</p></div></div>}
             {(isConnected || hasRemoteVideo) && <div className="absolute left-4 top-4 flex flex-wrap items-center gap-2 rounded-xl bg-black/60 px-3 py-2 text-xs font-bold backdrop-blur"><span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" /> {status}{remoteSharingScreen && <span className="border-l border-white/20 pl-2 text-cyan-200">함께보기 · 상대 화면 공유{remoteSystemAudio ? ' · 시스템 오디오' : ''}</span>}</div>}
             {peer && <div className="webrtc-peer-card absolute bottom-4 left-4 rounded-2xl bg-black/60 px-4 py-3 backdrop-blur"><div className="flex items-center gap-3"><img src={peer.image} alt="" className="h-10 w-10 rounded-full object-cover" /><div><div className="font-black">{peer.name}</div><div className="text-xs text-slate-300">{peer.gender || '성별 미설정'} · {peer.age || '나이 미설정'} · {peer.country || '국가 미설정'}</div></div></div></div>}
              <div className="absolute bottom-4 right-4 w-1/4 min-w-[100px] overflow-hidden rounded-2xl border-2 border-white/60 bg-black shadow-2xl"><video ref={videoRef} muted autoPlay playsInline className={`aspect-video h-full w-full object-contain bg-[#030611] ${flip ? 'scale-x-[-1]' : ''}`} /></div>
             <div className="webrtc-mobile-controls">
               <div className="mb-2 flex items-center justify-between gap-2 text-xs">
                 <span className="truncate font-bold text-slate-200">{active ? status : '카메라와 마이크를 준비하세요'}</span>
                 <label className="flex shrink-0 items-center gap-1.5 text-[11px] font-bold text-slate-300"><input type="checkbox" checked={flip} onChange={(event) => setFlip(event.target.checked)} className="h-3.5 w-3.5 accent-cyan-400" /> 좌우 반전</label>
               </div>
               <div className="grid grid-cols-3 gap-2">
                  {!active ? <button onClick={startMatchFromUi} className="col-span-3 flex min-h-11 items-center justify-center gap-2 rounded-xl bg-cyan-400 px-3 py-3 text-sm font-black text-slate-950"><PhoneCall size={17} /> LIVE CHAT 시작</button> : <button onClick={() => void endMatch()} className="col-span-3 flex min-h-11 items-center justify-center gap-2 rounded-xl bg-red-500 px-3 py-3 text-sm font-black text-white"><VideoOff size={17} /> 연결 종료</button>}
                  <button onClick={toggleMicrophone} disabled={!active} aria-label={audioEnabled ? '마이크 끄기' : '마이크 켜기'} className="flex min-h-10 items-center justify-center gap-1 rounded-xl border border-white/10 bg-white/10 px-2 text-xs font-black disabled:opacity-40">{audioEnabled ? <Mic size={14} /> : <MicOff size={14} />}{audioEnabled ? '마이크' : '음소거'}</button>
                   <button onClick={() => void toggleScreenShare()} disabled={!isConnected} className="flex min-h-10 items-center justify-center gap-1 rounded-xl border border-cyan-300/20 bg-cyan-300/10 px-2 text-xs font-black text-cyan-100 disabled:opacity-40"><MonitorUp size={14} /> {isSharingScreen ? '공유 중지' : '화면·오디오 공유'}</button>
                 <span className="flex min-h-10 items-center justify-center rounded-xl border border-white/10 px-2 text-[11px] font-bold text-slate-400">{isConnected ? '연결됨' : '대기 중'}</span>
               </div>
             </div>
           </section>

          <aside className="space-y-5">
               <section className="rounded-[2rem] border border-white/10 bg-[#111a2d] p-5"><div className="mb-4 flex items-center justify-between"><span className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">LIVE CHAT 상태</span><span className="text-xs font-bold text-cyan-300">{status}</span></div>{peer ? <div className="mb-5 flex items-center gap-3 rounded-2xl bg-white/[0.05] p-3"><img src={peer.image} alt="" className="h-12 w-12 rounded-full object-cover" /><div><div className="font-black">{peer.name}</div><div className="mt-1 text-xs text-slate-400">{peer.gender || '성별 미설정'} · {peer.age || '나이 미설정'} · {peer.country || '국가 미설정'}</div></div></div> : <div className="mb-5 rounded-2xl border border-dashed border-white/10 p-5 text-center text-sm text-slate-500"><Users className="mx-auto mb-2" size={22} />현재 연결된 상대가 없습니다.</div>}{permissionError && <p className="mb-4 rounded-xl bg-amber-500/10 p-3 text-xs font-bold text-amber-100">{permissionError}</p>}{!active ? <button onClick={startMatchFromUi} className="flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-400 py-4 font-black text-slate-950 transition hover:bg-cyan-300"><PhoneCall size={19} /> LIVE CHAT 시작</button> : <button onClick={() => void endMatch()} className="flex w-full items-center justify-center gap-2 rounded-xl bg-red-500 py-4 font-black text-white transition hover:bg-red-400"><VideoOff size={19} /> 연결 종료</button>}</section>
              <section className="rounded-[2rem] border border-white/10 bg-[#111a2d] p-5"><div className="mb-4 flex items-center justify-between"><span className="font-black">카메라 설정</span><span className="text-xs text-slate-500">상대 화면에도 적용</span></div><label className="flex cursor-pointer items-center justify-between rounded-xl bg-white/[0.04] p-3 text-sm font-bold"><span>내 화면 좌우 반전</span><input type="checkbox" checked={flip} onChange={(event) => setFlip(event.target.checked)} className="h-4 w-4 accent-cyan-400" /></label><div className="mt-4 flex items-start gap-2 text-xs leading-5 text-slate-500"><CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-300" />내 영상과 상대방에게 전송되는 영상 모두에 적용됩니다.</div></section>
              <section className="rounded-[2rem] border border-cyan-300/20 bg-[#111a2d] p-5"><div className="mb-4 flex items-center justify-between"><span className="font-black">LIVE CHAT 필터 / Filters</span><span className="text-xs font-bold text-cyan-300">18–60</span></div><label className="block text-xs font-bold text-slate-400">찾고 싶은 상대 / Gender<select value={genderPreference} onChange={(event) => setGenderPreference(event.target.value as GenderPreference)} className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm font-bold text-white outline-none"><option value="any">모두 / Any</option><option value="male">남성 / Male</option><option value="female">여성 / Female</option></select></label><div className="mt-4 grid grid-cols-2 gap-2"><label className="text-xs font-bold text-slate-400">최소 나이 / Min<select value={ageMin} onChange={(event) => setAgeMin(Number(event.target.value))} className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm font-bold text-white outline-none">{Array.from({ length: 43 }, (_, index) => index + 18).map((value) => <option key={value} value={value}>{value}</option>)}</select></label><label className="text-xs font-bold text-slate-400">최대 나이 / Max<select value={ageMax} onChange={(event) => setAgeMax(Number(event.target.value))} className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm font-bold text-white outline-none">{Array.from({ length: 43 }, (_, index) => index + 18).map((value) => <option key={value} value={value}>{value}</option>)}</select></label></div><p className="mt-3 text-xs leading-5 text-slate-500">랜덤 화상 매칭은 18–60세 범위에서만 연결합니다. 친구 통화는 서로 지정한 상대에게 직접 연결됩니다.</p></section>
              <section className="rounded-[2rem] border border-white/10 bg-[#111a2d] p-5 text-sm text-slate-400"><div className="mb-2 flex items-center gap-2 font-black text-white"><RefreshCcw size={16} className="text-cyan-300" /> 자동 연결 안내</div><p>연결이 끊기거나 상대가 나가면 연결 종료를 누르지 않아도 다음 인증 회원을 계속 찾습니다.</p></section>
               <section className="webrtc-sidebar-screen rounded-[2rem] border border-cyan-300/20 bg-[#111a2d] p-3">
              <div className="mb-2 flex items-center justify-between gap-2 px-1"><span className="text-xs font-black uppercase tracking-[0.18em] text-cyan-200">함께보기 · 상대 화면</span><span className="text-right text-[10px] font-bold text-slate-500">{remoteSharingScreen ? `화면 공유 중${remoteSystemAudio ? ' · 시스템 오디오' : ''}` : '카메라 대기'}</span></div>
              <div className="relative aspect-video overflow-hidden rounded-2xl bg-black"><video ref={sidebarVideoRef} muted autoPlay playsInline className="h-full w-full object-cover" />{!hasRemoteVideo && <div className="absolute inset-0 grid place-items-center text-xs text-slate-500">상대 영상 대기 중</div>}</div>
              <div className="mt-3 grid grid-cols-3 gap-2"><button onClick={toggleMicrophone} disabled={!active} className="flex items-center justify-center gap-1 rounded-xl border border-white/10 bg-white/5 py-2 text-xs font-black disabled:opacity-40">{audioEnabled ? <Mic size={14} /> : <MicOff size={14} />}{audioEnabled ? '마이크 켜짐' : '마이크 꺼짐'}</button><button onClick={() => void toggleScreenShare()} disabled={!isConnected} className="flex items-center justify-center gap-1 rounded-xl border border-cyan-300/20 bg-cyan-300/10 py-2 text-xs font-black text-cyan-100 disabled:opacity-40"><MonitorUp size={14} />{isSharingScreen ? '공유 중지' : '화면·오디오 공유'}</button><span className="flex items-center justify-center rounded-xl border border-white/10 px-2 text-[10px] font-bold text-slate-400">{isConnected ? '연결됨' : '대기 중'}</span></div>
             <div className="mt-3 max-h-36 space-y-2 overflow-y-auto">{chatMessages.length === 0 ? <p className="py-4 text-center text-xs text-slate-500">연결 후 메시지를 보낼 수 있습니다.</p> : chatMessages.map((message) => <div key={`side-${message.id}`} className="rounded-xl bg-white/[0.05] p-2 text-xs"><b className="text-cyan-200">{message.user}</b><p className="mt-1 break-words text-slate-300">{message.text}</p></div>)}</div>
              {user && activeCallId && <><p className="mt-2 text-[10px] text-slate-500">채팅과 AI 답변은 통화방 서버에 저장되어 양쪽에 표시됩니다.</p><form onSubmit={sendVideoChat} className="mt-2 flex gap-2"><input value={chatInput} onChange={(event) => setChatInput(event.target.value)} placeholder="메시지 또는 AI 질문..." className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-white outline-none" /><button type="button" onClick={() => void askSharedAi()} className="rounded-xl border border-violet-300/30 bg-violet-300/10 px-3 text-[11px] font-black text-violet-100">AI 함께</button><button className="rounded-xl bg-cyan-400 px-3 text-xs font-black text-slate-950">전송</button></form></>}
           </section>
           </aside>
         </div>
         <section className="mt-5 rounded-[2rem] border border-white/10 bg-[#111a2d] p-5"><div className="mb-3 flex items-center justify-between"><h2 className="font-black">화상 채팅</h2><span className="text-[10px] font-bold text-emerald-300">1분 후 자동 삭제</span></div><div className="max-h-48 space-y-2 overflow-y-auto">{chatMessages.length === 0 ? <p className="py-6 text-center text-sm text-slate-500">상대와 연결되면 메시지를 보낼 수 있습니다.</p> : chatMessages.map((message) => <div key={message.id} className="rounded-xl bg-white/[0.05] p-3 text-sm"><div className="mb-1 text-[10px] font-bold text-cyan-300">{message.user}</div><div className="break-words text-slate-200">{message.text}</div></div>)}</div>{chatError && <p className="mt-2 text-xs font-bold text-rose-300">{chatError}</p>}{user && activeCallId && <form onSubmit={sendVideoChat} className="mt-3 flex gap-2"><input value={chatInput} onChange={(event) => setChatInput(event.target.value)} placeholder="화상 채팅 메시지..." className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none" /><button className="rounded-xl bg-cyan-400 px-4 text-sm font-black text-slate-950">전송</button></form>}</section>
        </div>
     </div>
    </>
  );
}
