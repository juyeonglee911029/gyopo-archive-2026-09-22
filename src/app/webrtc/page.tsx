'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useEffectEvent } from '@/lib/useeffectevent';
import { Ban, Camera, CheckCircle2, Flag, Headphones, LoaderCircle, Maximize2, Mic, MicOff, Minimize2, MonitorUp, PhoneCall, RefreshCcw, ShieldAlert, VideoOff } from 'lucide-react';
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
  type WebrtcQueueProfile,
} from '@/lib/firebase';
import { useGlobalStore } from '@/store/useGlobalStore';
import { allowClientAction, getVideoAlias, inspectSafetyText, RANDOM_VIDEO_MIN_AGE } from '@/lib/safety';
import { callMediaConstraints, isVideoOnlyCall, createMirroredCamera, mergeRemoteTrack, playCallMedia } from '@/lib/callMedia';
import { createCandidateQueue, createRtcSignaling, startSerialPoll, updateCallMediaLease, CALL_MEDIA_LEASE_MS, RTC_INITIAL_TIMEOUT, RTC_DISCONNECT_GRACE, RTC_RESTART_TIMEOUT, type RtcDescription } from '@/lib/rtcSignaling';
import { rtcConfiguration, rtcFailureMessage } from '@/lib/rtcConfiguration';
import { canPhotoMatch, getVisibleMatchPhotos } from '@/lib/profilePhotos';

type QueueEntry = OnlineUser & {
  status?: 'waiting' | 'matched';
  callId?: string;
  opponent?: WebrtcQueueProfile;
  profilePhotos?: string[];
};

type CallDocument = {
  callId: string;
  callerId: string;
  calleeId: string;
  status?: 'offer' | 'answer' | 'connected' | 'ended';
  offer?: RtcDescription;
  answer?: RtcDescription | null;
  mediaMode?: 'camera' | 'screen';
  mediaOwnerId?: string | null;
  mediaLeaseId?: string | null;
  systemAudio?: boolean;
  mediaUpdatedAt?: string;
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

const CALL_STATUS_EN: Record<string, string> = {
  '대기 중': 'Ready',
  '18세 이상 이용 가능': 'Adults only',
  '공개 사진 3장 필요': 'At least three public profile photos are required',
  '안전수칙 동의 필요': 'Accept the safety rules to continue',
  '카메라 권한을 확인하는 중 · 마이크 사용 안 함': 'Checking camera permission · microphone disabled',
  '카메라와 마이크 권한을 확인하는 중': 'Checking camera and microphone permissions',
  '카메라 권한 확인 필요': 'Camera permission required',
  '수락한 상대에게 연결하는 중': 'Connecting to the caller',
  '다른 인증 회원을 찾는 중': 'Finding another verified member',
  '보안 연결을 설정하는 중': 'Setting up a secure connection',
  '연결 성공': 'Connected',
  '연결이 불안정합니다. 같은 상대와 복구를 기다리는 중': 'Connection unstable; reconnecting to the same person',
  '연결 종료': 'Call ended',
  '네트워크 경로를 확인하는 중': 'Checking network route',
  '중계 경로 확인 중 · 연결 실패 시 네트워크/TURN 설정을 확인해주세요': 'Checking relay route · Check your network/TURN settings if the connection fails',
  '상대 영상 연결 중': 'Connecting to your friend\'s video',
  '상대 연결 대기 중': 'Waiting for your friend to connect',
  '수락한 상대의 카메라를 기다리는 중': 'Waiting for the caller\'s camera',
  '결제 후 성별 매칭을 시작할 수 있습니다': 'Gender matching starts after payment',
  '상대에게 연결을 요청하는 중': 'Requesting a connection',
  '같은 상대와 네트워크 경로를 다시 연결하는 중': 'Reconnecting to the same person',
  '연결 정보 전송 재시도 중': 'Retrying connection setup',
  '상대가 연결을 종료했습니다. 다른 상대를 자동으로 찾는 중': 'Your friend ended the call; looking for another member',
  '상대가 통화를 종료했습니다.': 'Your friend ended the call',
};

export default function WebRTCPage() {
  const router = useRouter();
  const user = useGlobalStore((state) => state.user);
  const setUser = useGlobalStore((state) => state.setUser);
  const isKorean = useGlobalStore((state) => state.language === 'ko');
  const t = (korean: string, english: string) => isKorean ? korean : english;
  const [isMatching, setIsMatching] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [permissionError, setPermissionError] = useState('');
  const [status, setStatus] = useState('대기 중');
  const displayStatus = isKorean ? status : CALL_STATUS_EN[status] || (/[\uAC00-\uD7A3]/.test(status) ? 'Checking connection status' : status);
  const [peer, setPeer] = useState<QueueEntry | null>(null);
  const [hasRemoteVideo, setHasRemoteVideo] = useState(false);
  const [hasRemoteScreen, setHasRemoteScreen] = useState(false);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [videoOnly, setVideoOnly] = useState(true);
  const videoOnlyRef = useRef(true);
  const [isSharingScreen, setIsSharingScreen] = useState(false);
  const [remoteSharingScreen, setRemoteSharingScreen] = useState(false);
  const [remoteSystemAudio, setRemoteSystemAudio] = useState(false);
  const [hasRemoteScreenAudio, setHasRemoteScreenAudio] = useState(false);
  const [screenAudioEnabled, setScreenAudioEnabled] = useState(false);
  const [screenAudioListening, setScreenAudioListening] = useState(false);
  const [mediaOwnerId, setMediaOwnerId] = useState<string | null>(null);
  const [mediaLeaseId, setMediaLeaseId] = useState<string | null>(null);
  const [screenShareBusy, setScreenShareBusy] = useState(false);
  const [fullscreenSupported, setFullscreenSupported] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const screenShareBusyRef = useRef(false);
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
  const [gameType, setGameType] = useState<'tetris' | 'brickBreaker' | ''>('');
  const [gameRoomId, setGameRoomId] = useState('');
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
  const localScreenVideoRef = useRef<HTMLVideoElement>(null);
  const sharedAudioRef = useRef<HTMLAudioElement>(null);
  const compactStageRef = useRef<HTMLDivElement>(null);
  const desktopStageRef = useRef<HTMLElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const remoteScreenStreamRef = useRef<MediaStream | null>(null);
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
  const screenVideoSenderRef = useRef<RTCRtpSender | null>(null);
  const screenVideoTransceiverRef = useRef<RTCRtpTransceiver | null>(null);
  const audioSenderRef = useRef<RTCRtpSender | null>(null);
  const screenAudioSenderRef = useRef<RTCRtpSender | null>(null);
  const screenAudioTransceiverRef = useRef<RTCRtpTransceiver | null>(null);
  const screenTrackRef = useRef<MediaStreamTrack | null>(null);
  const screenAudioTrackRef = useRef<MediaStreamTrack | null>(null);
  const remoteScreenAudioStreamRef = useRef<MediaStream | null>(null);
  const mediaLeaseRef = useRef<{ callId: string; ownerId: string; leaseId: string } | null>(null);
  const mediaLeaseUpdatedAtRef = useRef(0);
  const remotePlaybackEnabledRef = useRef(false);
  const operationRef = useRef(0);
  const startedRef = useRef(false);
  const autoStartAttemptedRef = useRef(false);
  const startingRef = useRef(false);
  const terminalRef = useRef(false);
  const mountedRef = useRef(true);
  const blockedUserIdsRef = useRef<string[]>([]);
  const stopPollRef = useRef<(() => void) | null>(null);
  const queueProfileRef = useRef<WebrtcQueueProfile | null>(null);
  const queueNeedsResetRef = useRef(false);
  const queueWorkRef = useRef<Promise<unknown>>(Promise.resolve());
  const callIdentityRef = useRef({ id: '', kind: 'random', targetUserId: '', gameType: '' as 'tetris' | 'brickBreaker' | '', gameRoomId: '' });
  const targetedCall = Boolean(targetUserId) || callKind !== 'random';
  const matchGenderPreference = targetedCall ? 'any' : genderPreference;

  const signalEnded = (callId?: string) => {
      const identity = callIdentityRef.current;
      const terminalId = identity.id ? `webrtc-end-${identity.kind}-${identity.id}` : '';
      // The shared admission marker also covers hangup before the queue is matched.
      for (const id of new Set([callId, terminalId].filter((value): value is string => Boolean(value)))) {
      const markerIdentity = id === terminalId && userRef.current && identity.targetUserId
        ? {
            callerId: userRef.current.id,
            calleeId: identity.targetUserId,
            queueKind: identity.kind,
            targetUserId: identity.targetUserId,
            ...(identity.kind === 'game' ? { gameType: identity.gameType, gameRoomId: identity.gameRoomId } : {}),
          }
        : {};
      void getFreshSessionToken().then((token) => {
        if (token) return mergeDocument('webrtcCalls', id, { ...markerIdentity, status: 'ended', endedAt: new Date() }, token);
      }).catch(() => undefined);
    }
  };

  const releaseCallMediaLease = () => {
    const lease = mediaLeaseRef.current;
    if (!lease) return;
    mediaLeaseRef.current = null;
    mediaLeaseUpdatedAtRef.current = 0;
    void (async () => {
      const token = await getFreshSessionToken().catch(() => null);
      if (token) await updateCallMediaLease(lease.callId, lease.ownerId, token, 'camera', false, lease.leaseId);
    })().catch(() => undefined);
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
    const kind = params.get('gameRoom') || params.get('callKind') === 'game' ? 'game' : params.get('friend') ? 'friend' : 'random';
    const gameRoom = params.get('gameRoom') || '';
    const requestedGameType = params.get('gameType');
    // Existing Tetris embeds identify the room without an explicit game type.
    const nextGameType = requestedGameType === 'tetris' || requestedGameType === 'brickBreaker' ? requestedGameType : gameRoom ? 'tetris' : '';
    const nextGameRoomId = params.get('gameRoomId') || (nextGameType === 'tetris' ? gameRoom : '');
    setCallKind(kind);
    setGameType(nextGameType);
    setGameRoomId(nextGameRoomId);
    setCompactMode(params.get('compact') === '1');
    setAutoStart(params.get('auto') === '1');
    callIdentityRef.current = {
      id: params.get('gameRoom') || params.get('callId') || '',
      kind,
      targetUserId: params.get('friend') || '',
      gameType: nextGameType,
      gameRoomId: nextGameRoomId,
    };
  }, []);

  useEffect(() => {
    if (!compactMode) return;
    document.body.classList.add('webrtc-compact-shell');
    return () => document.body.classList.remove('webrtc-compact-shell');
  }, [compactMode]);

  useEffect(() => {
    const updateFullscreenState = () => {
      const stages = [compactStageRef.current, desktopStageRef.current].filter((stage): stage is HTMLElement => Boolean(stage));
      setFullscreenSupported(Boolean(document.fullscreenEnabled && stages.some((stage) => stage.requestFullscreen)));
      setIsFullscreen(stages.some((stage) => document.fullscreenElement === stage));
    };
    updateFullscreenState();
    document.addEventListener('fullscreenchange', updateFullscreenState);
    return () => document.removeEventListener('fullscreenchange', updateFullscreenState);
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
    if (screenVideoSenderRef.current) await screenVideoSenderRef.current.replaceTrack(null).catch(() => undefined);
    if (terminalRef.current || operation !== operationRef.current) return;
    if (screenAudioSenderRef.current) await screenAudioSenderRef.current.replaceTrack(null).catch(() => undefined);
    if (terminalRef.current || operation !== operationRef.current) return;
    screenAudioTrackRef.current?.stop();
    screenAudioTrackRef.current = null;
    if (localScreenVideoRef.current) localScreenVideoRef.current.srcObject = null;
    setScreenAudioEnabled(false);
    if (videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      await videoRef.current.play().catch(() => undefined);
    }
    if (terminalRef.current || operation !== operationRef.current) return;
    setIsSharingScreen(false);
    releaseCallMediaLease();
    setMediaOwnerId(null);
    setMediaLeaseId(null);
  };

  const toggleScreenShare = async () => {
    const operation = operationRef.current;
    const cancelled = () => terminalRef.current || operation !== operationRef.current || !mountedRef.current;
    if (cancelled() || videoOnlyRef.current) return;
    if (isSharingScreen) {
      await restoreCameraTrack();
      return;
    }
    if (!videoSenderRef.current || !screenVideoSenderRef.current || !navigator.mediaDevices?.getDisplayMedia) {
      setPermissionError('연결 후 화면 공유를 사용할 수 있습니다.');
      return;
    }
    const ownsCurrentLease = mediaOwnerId === userRef.current?.id
      && Boolean(mediaLeaseId && mediaLeaseRef.current?.leaseId === mediaLeaseId);
    if (mediaOwnerId && !ownsCurrentLease) {
      setPermissionError('현재 화면 공유 권한은 상대방 또는 다른 통화 창이 사용 중입니다.');
      return;
    }
    if (screenShareBusyRef.current) return;
    screenShareBusyRef.current = true;
    setScreenShareBusy(true);
    let display: MediaStream | null = null;
    let leaseClaimed = false;
    try {
      display = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true });
      if (cancelled()) {
        display.getTracks().forEach((track) => track.stop());
        return;
      }
      const screenTrack = display.getVideoTracks()[0];
      if (!screenTrack) {
        display.getTracks().forEach((track) => track.stop());
        setPermissionError('공유할 화면을 찾지 못했습니다. 다시 선택해주세요.');
        return;
      }
      const callId = callRef.current?.callId;
      const ownerId = userRef.current?.id;
      const token = await getFreshSessionToken();
      if (!callId || !ownerId || !token) throw new Error('통화 권한을 확인하지 못했습니다. 다시 연결해주세요.');
      const leaseId = crypto.randomUUID();
      const systemAudioTrack = display.getAudioTracks()[0] || null;
      const claimed = await updateCallMediaLease(callId, ownerId, token, 'screen', Boolean(systemAudioTrack), leaseId);
      if (cancelled()) {
        if (claimed) {
          mediaLeaseRef.current = { callId, ownerId, leaseId };
          releaseCallMediaLease();
        }
        display.getTracks().forEach((track) => track.stop());
        return;
      }
      if (!claimed) {
        display.getTracks().forEach((track) => track.stop());
        setPermissionError('화면 공유 권한을 얻지 못했습니다. 상대방이 공유 중이거나 통화가 종료되었습니다.');
        return;
      }
      leaseClaimed = true;
      mediaLeaseRef.current = { callId, ownerId, leaseId };
      mediaLeaseUpdatedAtRef.current = Date.now();
      setMediaOwnerId(ownerId);
      setMediaLeaseId(leaseId);
      screenTrackRef.current = screenTrack;
      screenAudioTrackRef.current = systemAudioTrack;
      setScreenAudioEnabled(Boolean(systemAudioTrack));
      screenTrack.onended = () => { void restoreCameraTrack(); };
      await screenVideoSenderRef.current.replaceTrack(screenTrack);
      if (cancelled()) return;
      if (systemAudioTrack && screenAudioSenderRef.current) {
        await screenAudioSenderRef.current.replaceTrack(systemAudioTrack);
        if (cancelled()) return;
      }
      if (cancelled()) return;
      setIsSharingScreen(true);
      setPermissionError('');
    } catch (error) {
      if (leaseClaimed) await restoreCameraTrack();
      else display?.getTracks().forEach((track) => track.stop());
      if (cancelled()) return;
      if (error instanceof DOMException && error.name === 'NotAllowedError') return;
      setPermissionError('화면 공유를 시작하지 못했습니다. 브라우저 권한을 확인해주세요.');
    } finally {
      screenShareBusyRef.current = false;
      if (mountedRef.current) setScreenShareBusy(false);
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
    if (localScreenVideoRef.current) localScreenVideoRef.current.srcObject = null;
    if (sharedAudioRef.current) {
      sharedAudioRef.current.pause();
      sharedAudioRef.current.srcObject = null;
      sharedAudioRef.current.muted = true;
    }
    audioSenderRef.current = null;
    screenAudioSenderRef.current = null;
    screenAudioTransceiverRef.current = null;
    screenVideoSenderRef.current = null;
    screenVideoTransceiverRef.current = null;
    setIsSharingScreen(false);
    setScreenAudioEnabled(false);
    setScreenAudioListening(false);
    setHasRemoteScreenAudio(false);
    setMediaOwnerId(null);
    setMediaLeaseId(null);
    remotePlaybackEnabledRef.current = false;
    setPlaybackBlocked(false);
    releaseCallMediaLease();
    remoteStreamRef.current?.getTracks().forEach((track) => track.stop());
    remoteStreamRef.current = null;
    remoteScreenStreamRef.current?.getTracks().forEach((track) => track.stop());
    remoteScreenStreamRef.current = null;
    remoteScreenAudioStreamRef.current?.getTracks().forEach((track) => track.stop());
    remoteScreenAudioStreamRef.current = null;
    if (localScreenVideoRef.current) localScreenVideoRef.current.srcObject = null;
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
      setHasRemoteScreen(false);
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
    if (callKind === 'game' && (!targetUserId || !gameType || !gameRoomId)) {
      setPermissionError('실제 대전방의 상대와 게임방 정보를 확인한 뒤 영상 통화를 시작해주세요.');
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
    if (callKind === 'random' && !canPhotoMatch(user.profilePhotos)) {
      setPermissionError('랜덤 매칭을 시작하려면 공개 프로필 사진을 3장 이상 등록해주세요.');
      setStatus('공개 사진 3장 필요');
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
    setHasRemoteScreen(false);
    setRemoteSharingScreen(false);
    setRemoteSystemAudio(false);
    setHasRemoteScreenAudio(false);
    setScreenAudioEnabled(false);
    setScreenAudioListening(false);
    setMediaOwnerId(null);
    setMediaLeaseId(null);
    setPlaybackBlocked(false);
    remotePlaybackEnabledRef.current = false;
    setStatus(targetedCall ? '수락한 상대에게 연결하는 중' : '다른 인증 회원을 찾는 중');
    setIsMatching(true);
    queueNeedsResetRef.current = false;
    const gameQueueDetails = callKind === 'game' && (gameType === 'tetris' || gameType === 'brickBreaker')
      ? { gameType, gameRoomId }
      : {};
    queueProfileRef.current = { id: user.id, name: videoAlias, image: user.image, profilePhotos: user.profilePhotos, country: user.country || 'Global', age: user.age, gender: user.gender || '', genderPreference: matchGenderPreference, ageMin, ageMax, isSubscribed: Boolean(user.isSubscribed), targetUserId: targetUserId || undefined, queueKind: callKind, ...gameQueueDetails };
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
         ...gameQueueDetails,
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

  const startMatchEffect = useEffectEvent(() => { void startMatch(); });

  useEffect(() => {
    if (!autoStart || autoStartAttemptedRef.current || !user || callKind !== 'friend' || !targetUserId || !compactMode || active || isStarting || hasEnded) return;
    autoStartAttemptedRef.current = true;
    startMatchEffect();
  }, [autoStart, callKind, targetUserId, compactMode, user, active, isStarting, hasEnded, startMatchEffect]);

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

  function endMatch(message = '통화가 종료되었습니다.', notifyParent = true) {
    if (terminalRef.current) return;
    terminalRef.current = true;
    operationRef.current += 1;
    startingRef.current = false;
    stopPollRef.current?.();
    stopPollRef.current = null;
    const currentCall = callRef.current;
    remotePlaybackEnabledRef.current = false;
    releaseCallMediaLease();
    if (mountedRef.current) {
    setIsStarting(false);
    setHasEnded(true);
    setActive(false);
    setIsMatching(false);
      setIsConnected(false);
      setHasRemoteVideo(false);
      setHasRemoteScreen(false);
      setRemoteSharingScreen(false);
      setRemoteSystemAudio(false);
      setHasRemoteScreenAudio(false);
      setScreenAudioEnabled(false);
      setScreenAudioListening(false);
      setMediaOwnerId(null);
      setMediaLeaseId(null);
      setScreenShareBusy(false);
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
    screenShareBusyRef.current = false;
    if (localScreenVideoRef.current) localScreenVideoRef.current.srcObject = null;
    if (sharedAudioRef.current) {
      sharedAudioRef.current.pause();
      sharedAudioRef.current.srcObject = null;
      sharedAudioRef.current.muted = true;
    }
    videoSenderRef.current = null;
    audioSenderRef.current = null;
    screenAudioSenderRef.current = null;
    screenAudioTransceiverRef.current = null;
    screenVideoSenderRef.current = null;
    screenVideoTransceiverRef.current = null;
    if (mountedRef.current) setIsSharingScreen(false);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    if (sidebarVideoRef.current) sidebarVideoRef.current.srcObject = null;
    remoteStreamRef.current?.getTracks().forEach((track) => track.stop());
    remoteStreamRef.current = null;
    remoteScreenStreamRef.current?.getTracks().forEach((track) => track.stop());
    remoteScreenStreamRef.current = null;
    remoteScreenAudioStreamRef.current?.getTracks().forEach((track) => track.stop());
    remoteScreenAudioStreamRef.current = null;
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
       const outgoing = createOutgoingStream();
        outgoing?.getTracks().forEach((track) => {
          if (videoOnlyRef.current && track.kind === 'audio') { track.stop(); return; }
          const sender = connection.addTrack(track, outgoing);
          if (track.kind === 'video') videoSenderRef.current = sender;
          if (track.kind === 'audio') audioSenderRef.current = sender;
        });
        screenAudioTransceiverRef.current = connection.addTransceiver('audio', { direction: 'sendrecv' });
        screenAudioSenderRef.current = screenAudioTransceiverRef.current.sender;
        screenVideoTransceiverRef.current = connection.addTransceiver('video', { direction: 'sendrecv' });
       screenVideoSenderRef.current = screenVideoTransceiverRef.current.sender;
       signalingRef.current = createRtcSignaling(connection, call.initiator, async (signal) => {
         const token = await getFreshSessionToken();
         if (!alive()) return;
         if (!token) throw new Error('로그인 세션이 만료되었습니다. 다시 로그인해주세요.');
         await mergeDocument('webrtcCalls', call.callId, call.initiator
           ? { callId: call.callId, callerId: user.id, calleeId: call.peer.userId, ...signal }
           : signal, token);
         if (!alive()) signalEnded(call.callId);
       }, alive);
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
          const isScreen = event.track.kind === 'video' && event.transceiver === screenVideoTransceiverRef.current;
          const isScreenAudio = event.track.kind === 'audio' && event.transceiver === screenAudioTransceiverRef.current;
          const remoteStream = isScreen
            ? remoteScreenStreamRef.current || new MediaStream()
            : isScreenAudio
              ? remoteScreenAudioStreamRef.current || new MediaStream()
              : remoteStreamRef.current || new MediaStream();
          mergeRemoteTrack(remoteStream, event.track, videoOnlyRef.current);
          if (isScreen) remoteScreenStreamRef.current = remoteStream;
          else if (isScreenAudio) remoteScreenAudioStreamRef.current = remoteStream;
          else remoteStreamRef.current = remoteStream;
           const playback = () => {
             if (!alive()) return;
             if (isScreen) {
               setHasRemoteScreen(remoteStream.getVideoTracks().some((track) => track.readyState === 'live' && !track.muted));
               return;
             }
             if (isScreenAudio) {
               setHasRemoteScreenAudio(remoteStream.getAudioTracks().some((track) => track.readyState === 'live' && !track.muted));
               return;
             }
             setHasRemoteVideo(remoteStream.getVideoTracks().some((track) => track.readyState === 'live' && !track.muted));
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
          const makePeer = (profile: WebrtcQueueProfile): QueueEntry => ({
            id: profile.id,
            userId: profile.id,
            name: profile.name,
            image: profile.image,
            profilePhotos: profile.profilePhotos,
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
           const updatedAt = Date.parse(call.mediaUpdatedAt || '');
           const leaseActive = call.mediaMode === 'screen' && Number.isFinite(updatedAt) && Date.now() - updatedAt < CALL_MEDIA_LEASE_MS;
           const ownerId = leaseActive ? call.mediaOwnerId || null : null;
           const remoteScreen = Boolean(ownerId && ownerId !== user.id);
           setMediaOwnerId(ownerId);
           setMediaLeaseId(ownerId ? call.mediaLeaseId || null : null);
           setRemoteSharingScreen(remoteScreen);
           setRemoteSystemAudio(remoteScreen && call.systemAudio === true);
         }
         if (call?.status === 'ended') {
           closeCallForRematch('상대가 연결을 종료했습니다. 다른 상대를 자동으로 찾는 중');
           return;
         }
         const now = Date.now();
         const mediaLease = mediaLeaseRef.current;
          if (screenTrackRef.current && mediaLease && now - mediaLeaseUpdatedAtRef.current >= CALL_MEDIA_LEASE_MS / 3) {
           try {
              const renewed = await updateCallMediaLease(mediaLease.callId, mediaLease.ownerId, token, 'screen', Boolean(screenAudioTrackRef.current?.enabled), mediaLease.leaseId);
             if (stale()) return;
             if (!renewed) throw new Error('Lease unavailable');
             if (mediaLeaseRef.current === mediaLease) mediaLeaseUpdatedAtRef.current = Date.now();
           } catch {
             if (stale()) return;
             setPermissionError('화면 공유 권한을 갱신하지 못해 화면 공유를 중지했습니다.');
             await restoreCameraTrack();
             if (stale()) return;
           }
         }
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

  const toggleTogetherListen = async () => {
    const outgoingAudio = screenAudioTrackRef.current;
    if (isSharingScreen && outgoingAudio) {
      const lease = mediaLeaseRef.current;
      if (!lease) return;
      const next = !outgoingAudio.enabled;
      outgoingAudio.enabled = next;
      setScreenAudioEnabled(next);
      try {
        const token = await getFreshSessionToken();
        if (!token) throw new Error('다시 로그인해주세요.');
        const renewed = await updateCallMediaLease(lease.callId, lease.ownerId, token, 'screen', next, lease.leaseId);
        if (!renewed) throw new Error('화면 공유 권한이 만료되었습니다.');
        if (mediaLeaseRef.current === lease) mediaLeaseUpdatedAtRef.current = Date.now();
      } catch {
        if (mountedRef.current && !terminalRef.current) {
          await restoreCameraTrack();
          setPermissionError('화면 공유 권한을 갱신하지 못해 공유를 중지했습니다.');
        }
      }
      return;
    }

    const audio = sharedAudioRef.current;
    const stream = remoteScreenAudioStreamRef.current;
    if (!audio || !stream) return;
    if (screenAudioListening) {
      audio.muted = true;
      audio.pause();
      setScreenAudioListening(false);
      return;
    }
    audio.srcObject = stream;
    audio.muted = false;
    try {
      await audio.play();
      if (mountedRef.current && !terminalRef.current) {
        setScreenAudioListening(true);
        setPermissionError('');
      }
    } catch {
      audio.muted = true;
      setPermissionError('브라우저가 오디오 재생을 막았습니다. 함께듣기를 다시 눌러주세요.');
    }
  };

  const toggleFullscreen = async (stage: HTMLElement | null) => {
    if (!stage || !fullscreenSupported) return;
    try {
      if (document.fullscreenElement === stage) await document.exitFullscreen();
      else await stage.requestFullscreen();
    } catch {
      setPermissionError('전체 화면을 사용할 수 없습니다. 브라우저 권한을 확인해주세요.');
    }
  };

  const toggleCompactFullscreen = () => toggleFullscreen(compactStageRef.current);

  const retryRemotePlayback = async () => {
    const stream = remoteStreamRef.current;
    const screen = remoteScreenStreamRef.current;
    const operation = operationRef.current;
    const attempts = [
      ...(stream ? [playCallMedia(remoteVideoRef.current, stream, videoOnlyRef.current)] : []),
      ...(screen ? [playCallMedia(sidebarVideoRef.current, screen, true)] : []),
    ];
    if (!attempts.length) return;
    const played = (await Promise.all(attempts)).every(Boolean);
    if (mountedRef.current && !terminalRef.current && operation === operationRef.current) {
      remotePlaybackEnabledRef.current = played;
      setPlaybackBlocked(!played);
    }
  };

  useEffect(() => {
    const video = localScreenVideoRef.current;
    const track = screenTrackRef.current;
    if (!video || !track) return;
    video.srcObject = new MediaStream([track]);
    void video.play().catch(() => undefined);
    return () => {
      video.pause();
      video.srcObject = null;
    };
  }, [compactMode, isSharingScreen]);

  useEffect(() => {
    const audio = sharedAudioRef.current;
    if (!audio) return;
    const remoteAudioAvailable = !isSharingScreen && remoteSharingScreen && remoteSystemAudio && hasRemoteScreenAudio;
    if (screenAudioListening && !remoteAudioAvailable) {
      audio.pause();
      audio.muted = true;
      audio.srcObject = null;
      setScreenAudioListening(false);
    } else if (!screenAudioListening) {
      audio.pause();
      audio.muted = true;
    }
  }, [hasRemoteScreenAudio, isSharingScreen, remoteSharingScreen, remoteSystemAudio, screenAudioListening]);

  useEffect(() => {
    const stream = remoteStreamRef.current;
    if (!stream || !remoteVideoRef.current) return;
    remoteVideoRef.current.srcObject = stream;
    remoteVideoRef.current.muted = videoOnlyRef.current;
    if (remotePlaybackEnabledRef.current) {
      const operation = operationRef.current;
      void playCallMedia(remoteVideoRef.current, stream, videoOnlyRef.current).then((played) => {
        if (mountedRef.current && !terminalRef.current && operation === operationRef.current) setPlaybackBlocked(!played);
      });
    } else if (hasRemoteVideo) setPlaybackBlocked(true);
  }, [hasRemoteVideo, compactMode]);

  useEffect(() => {
    const stream = remoteScreenStreamRef.current;
    if (!stream || !sidebarVideoRef.current) return;
    sidebarVideoRef.current.srcObject = stream;
    if (remotePlaybackEnabledRef.current) {
      const operation = operationRef.current;
      void playCallMedia(sidebarVideoRef.current, stream, true).then((played) => {
        if (mountedRef.current && !terminalRef.current && operation === operationRef.current) setPlaybackBlocked(!played);
      });
    } else if (hasRemoteScreen) setPlaybackBlocked(true);
  }, [hasRemoteScreen, compactMode]);

  const sharedScreenVisible = isSharingScreen || remoteSharingScreen || hasRemoteScreen;
  const visiblePeerPhotos = getVisibleMatchPhotos(user?.profilePhotos, peer?.profilePhotos);
  const callModeLabel = callKind === 'friend' ? t('친구 통화', 'Friend call') : callKind === 'game' ? t('게임 통화', 'Game call') : t('랜덤 채팅', 'Random chat');
  const screenShareDisabled = !isConnected || videoOnly || screenShareBusy || (!isSharingScreen && Boolean(mediaOwnerId));
  const canToggleTogetherListen = !videoOnly && (isSharingScreen
    ? screenAudioTrackRef.current?.readyState === 'live'
    : remoteSharingScreen && remoteSystemAudio && hasRemoteScreenAudio);

  if (compactMode) {
    return (
      <div ref={compactStageRef} className="gyopo-compact-call h-full min-h-0 w-full overflow-hidden bg-[#050914] text-white">
        <audio ref={sharedAudioRef} className="sr-only" aria-label="공유 화면 오디오" />
        <div className="relative flex h-full min-h-0 flex-col">
          <div className="compact-call-header flex shrink-0 items-center justify-between gap-2 border-b border-white/10 bg-transparent px-3 py-2">
            <div className="min-w-0">
              <div className="truncate text-[10px] font-black uppercase tracking-[0.18em] text-cyan-200">{callKind === 'friend' ? 'FRIEND' : 'GAME'} {videoOnly ? 'CAMERA ONLY' : 'VOICE + VIDEO'}</div>
             <div className="truncate text-xs font-bold text-slate-300">{peer?.name || t('상대방 연결 대기', 'Waiting for your friend')}</div>
            </div>
            <span className="flex shrink-0 items-center gap-1.5"><span className={`px-2 py-1 text-[10px] font-black ${isConnected ? 'bg-emerald-300/15 text-emerald-200' : 'bg-amber-300/15 text-amber-200'}`}>{hasEnded ? 'ENDED' : permissionError ? 'CHECK' : isConnected ? 'CONNECTED' : active || isStarting ? 'CONNECTING' : 'READY'}</span>{isConnected && <span className="font-mono text-[11px] font-black text-cyan-100">{formatCallDuration(callElapsed)}</span>}</span>
          </div>
          {visiblePeerPhotos.length > 0 && <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-white/10 bg-white/[.03] px-3 py-2" aria-label={t('상대 공개 프로필 사진', 'Friend profile photos')}><span className="shrink-0 text-[9px] font-bold text-slate-400">{t('상대 사진', 'Photos')}</span>{visiblePeerPhotos.map((photo, index) => <img key={`${photo}-${index}`} src={photo} alt={t(`상대 공개 사진 ${index + 1}`, `Friend photo ${index + 1}`)} loading="lazy" className="h-9 w-9 shrink-0 rounded-md object-cover" />)}</div>}

          <div className={`compact-call-stage relative ${sharedScreenVisible ? 'has-shared-screen' : ''}`}>
            {sharedScreenVisible && <div className="compact-call-shared-screen">
               <span className="compact-call-video-label">{isSharingScreen ? t('내 화면 공유', 'Your shared screen') : t('상대 화면 공유', 'Friend shared screen')}</span>
              <video ref={isSharingScreen ? localScreenVideoRef : sidebarVideoRef} muted playsInline />
               {!isSharingScreen && !hasRemoteScreen && <div className="compact-call-placeholder" role="status">{t('상대 화면 연결 중', 'Connecting to shared screen')}</div>}
            </div>}
            <div className="compact-call-camera-row">
              <div className="compact-call-video-tile">
                 <span className="compact-call-video-label">{t('내 카메라', 'Your camera')}</span>
                <video ref={videoRef} muted autoPlay playsInline className={flip ? 'scale-x-[-1]' : ''} />
                 {(!active || !streamRef.current) && <div className="compact-call-placeholder">{t('카메라 시작 후 내 영상이 표시됩니다.', 'Your video appears when the camera starts.')}</div>}
              </div>
              <div className="compact-call-video-tile">
                 <span className="compact-call-video-label">{t('상대 카메라', 'Friend camera')}</span>
                <video ref={remoteVideoRef} muted={videoOnly} playsInline className={hasRemoteVideo ? 'opacity-100' : 'opacity-0'} />
                  {!hasRemoteVideo && <div className="compact-call-placeholder" role="status">{hasEnded ? t('통화가 종료되었습니다.', 'Call ended.') : (active || isStarting || isMatching) ? displayStatus : t('상대방 연결을 기다리는 중입니다.', 'Waiting for your friend to connect.')}</div>}
                 {playbackBlocked && (hasRemoteVideo || hasRemoteScreen) && <button type="button" onClick={() => void retryRemotePlayback()} className="absolute inset-x-2 bottom-2 z-10 bg-cyan-300 px-2 py-2 text-[10px] font-black text-slate-950">{t('상대 영상 재생', 'Play friend video')}</button>}
              </div>
            </div>
          </div>

          {permissionError && !hasEnded && <div className="call-permission-error px-3 py-1.5 text-[10px]" role="alert"><span>{permissionError}</span>{!active && <button type="button" onClick={startMatchFromUi} disabled={isStarting}>{t('권한 확인 후 다시 시도', 'Check permissions and retry')}</button>}</div>}
          <div className="call-compact-controls grid shrink-0 grid-cols-5 gap-1 border-t border-white/10 bg-[#10182b] p-2">
            {!active ? <button type="button" onClick={startMatchFromUi} disabled={isStarting || hasEnded} className="col-span-5 flex min-h-11 items-center justify-center gap-2 bg-cyan-300 px-2 text-xs font-black text-slate-950 disabled:opacity-50"><Camera size={14} />{isStarting ? t('카메라 연결 중...', 'Starting camera...') : videoOnly ? t('카메라 시작', 'Start camera') : t('카메라·마이크 시작', 'Start camera & mic')}</button> : <>
              <button type="button" onClick={toggleMicrophone} disabled={videoOnly} aria-label={audioEnabled ? t('마이크 끄기', 'Mute microphone') : t('마이크 켜기', 'Unmute microphone')} className="flex min-h-11 flex-col items-center justify-center gap-0.5 bg-white/5 px-1 text-[9px] font-black disabled:opacity-40">{audioEnabled ? <Mic size={13} /> : <MicOff size={13} />}{videoOnly ? t('마이크 차단', 'Mic off') : audioEnabled ? t('마이크 켬', 'Mic on') : t('음소거', 'Muted')}</button>
              <button type="button" onClick={() => void toggleScreenShare()} disabled={screenShareDisabled} aria-pressed={sharedScreenVisible} title={mediaOwnerId && !isSharingScreen ? t('다른 참여자가 화면 공유 중입니다', 'Someone else is sharing a screen') : isSharingScreen ? t('화면 공유 중지', 'Stop sharing') : t('화면을 함께 보기', 'Share screen')} className="flex min-h-11 flex-col items-center justify-center gap-0.5 bg-cyan-300/10 px-1 text-[9px] font-black text-cyan-100 disabled:opacity-40"><MonitorUp size={13} />{isSharingScreen ? t('공유 중지', 'Stop sharing') : remoteSharingScreen ? t('상대 공유 중', 'Friend sharing') : screenShareBusy ? t('선택 중', 'Selecting') : t('함께보기', 'Share screen')}</button>
              <button type="button" onClick={() => void toggleTogetherListen()} disabled={!canToggleTogetherListen} aria-pressed={isSharingScreen ? screenAudioEnabled : screenAudioListening} title={isSharingScreen ? t('공유 오디오 송출 켜기 또는 끄기', 'Toggle shared audio') : t('공유 탭 오디오 재생', 'Play shared tab audio')} className="flex min-h-11 flex-col items-center justify-center gap-0.5 bg-white/5 px-1 text-[9px] font-black disabled:opacity-40"><Headphones size={13} />{isSharingScreen ? screenAudioEnabled ? t('함께듣기 켬', 'Audio on') : t('함께듣기 끔', 'Audio off') : screenAudioListening ? t('함께듣는 중', 'Listening') : t('함께듣기', 'Listen together')}</button>
              <button type="button" onClick={toggleCompactFullscreen} disabled={!fullscreenSupported} aria-pressed={isFullscreen} aria-label={isFullscreen ? t('전체 화면 종료', 'Exit full screen') : t('전체 화면', 'Full screen')} title={fullscreenSupported ? (isFullscreen ? t('전체 화면 종료', 'Exit full screen') : t('전체 화면', 'Full screen')) : t('이 브라우저에서 전체 화면을 사용할 수 없습니다', 'Full screen is not supported in this browser')} className="call-fullscreen-toggle flex min-h-11 flex-col items-center justify-center gap-0.5 bg-white/5 px-1 text-[9px] font-black disabled:opacity-40">{isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}{isFullscreen ? t('축소', 'Exit') : t('전체 화면', 'Full screen')}</button>
              <button type="button" onClick={() => endMatch()} disabled={hasEnded} className="flex min-h-11 flex-col items-center justify-center gap-0.5 bg-rose-500/90 px-1 text-[9px] font-black text-white disabled:opacity-40"><VideoOff size={13} />{t('종료', 'End')}</button>
              </>}
          </div>
          <p className="call-compact-note px-3 pb-2">{t('화면 공유는 클릭 후 시작됩니다. Chrome에서는 탭을 고른 뒤 탭 오디오 공유를 켜세요. DRM 영상은 검은 화면 또는 무음으로 제한될 수 있습니다.', 'Choose a screen to share. In Chrome, select a tab and enable tab audio. DRM video may appear black or play without sound.')}</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {showRandomConsent && <div className="fixed inset-0 z-[90] grid place-items-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="random-chat-consent-title"><div className="random-chat-consent w-full max-w-lg p-6"><div className="flex items-start gap-3"><ShieldAlert size={22} className="mt-0.5 shrink-0 text-amber-200" /><div><h2 id="random-chat-consent-title" className="text-lg font-black text-white">랜덤 화상채팅 이용 안내</h2><p className="mt-3 text-sm leading-6 text-slate-300">만 18세 이상만 이용할 수 있습니다. 실명·전화번호·주소·외부 연락처·링크를 공유하지 말고, 불쾌하거나 위험한 상황에서는 즉시 종료·신고·차단해주세요. 안전수칙에 동의하면 카메라와 마이크 연결을 시작합니다.</p></div></div><div className="mt-6 flex gap-2"><button type="button" onClick={rejectRandomConsent} className="flex-1 border border-white/10 bg-white/[.06] py-3 text-sm font-black text-slate-300">거절하고 이전 화면</button><button type="button" onClick={acceptRandomConsent} className="flex-1 bg-cyan-300 py-3 text-sm font-black text-slate-950">동의하고 시작</button></div></div></div>}
    <div className="webrtc-page min-h-[calc(100vh-64px)] bg-[#080d1c] px-4 py-8 text-white">
      <audio ref={sharedAudioRef} className="sr-only" aria-label="공유 화면 오디오" />
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
            <div className="min-w-0">
              <section ref={desktopStageRef} className="webrtc-stage relative overflow-hidden rounded-2xl border border-white/10 bg-black shadow-2xl">
                {sharedScreenVisible && <div className="webrtc-stage-shared-screen">
                  <span className="webrtc-stage-label">{isSharingScreen ? '내 화면 공유' : '상대 화면 공유'}</span>
                  <video ref={isSharingScreen ? localScreenVideoRef : sidebarVideoRef} muted playsInline />
                  {!isSharingScreen && !hasRemoteScreen && <div className="webrtc-stage-placeholder">상대 화면 연결 중</div>}
                </div>}
                <div className={`webrtc-stage-camera-row ${sharedScreenVisible ? 'has-shared-screen' : ''}`}>
                  <div className="webrtc-stage-camera-tile">
                    <span className="webrtc-stage-label">내 카메라</span>
                    <video ref={videoRef} muted autoPlay playsInline className={flip ? 'scale-x-[-1]' : ''} />
                    {(!active || !streamRef.current) && <div className="webrtc-stage-placeholder">{active ? '내 카메라 연결 중' : '카메라·마이크 시작 후 내 영상이 표시됩니다.'}</div>}
                  </div>
                  <div className="webrtc-stage-camera-tile">
                    <span className="webrtc-stage-label">상대 카메라</span>
                    <video ref={remoteVideoRef} muted={videoOnly} playsInline className={hasRemoteVideo ? 'opacity-100' : 'opacity-0'} />
                    {!hasRemoteVideo && <div className="webrtc-stage-placeholder">{active || isStarting || isMatching ? displayStatus : t('상대 연결 대기 중', 'Waiting for your friend to connect')}</div>}
                  </div>
                </div>
                {(isConnected || hasRemoteVideo) && <div className="webrtc-stage-status"><span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />{displayStatus}{remoteSharingScreen && <span className="border-l border-white/20 pl-2 text-cyan-200">함께보기{remoteSystemAudio ? ' · 시스템 오디오' : ''}</span>}</div>}
                <button type="button" onClick={() => void toggleFullscreen(desktopStageRef.current)} disabled={!fullscreenSupported} aria-label={isFullscreen ? '전체 화면 종료' : '전체 화면'} title={fullscreenSupported ? (isFullscreen ? '전체 화면 종료' : '전체 화면') : '이 브라우저에서 전체 화면을 사용할 수 없습니다'} className="webrtc-stage-fullscreen">{isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>
                {playbackBlocked && (hasRemoteVideo || hasRemoteScreen) && <button type="button" onClick={() => void retryRemotePlayback()} className="absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 rounded-lg bg-cyan-300 px-4 py-3 text-sm font-bold text-slate-950">상대 영상/소리 재생</button>}
              </section>

              <div className="webrtc-mobile-controls mt-3 rounded-xl border border-white/10 bg-[#10182b] p-3">
                <div className="mb-3 flex items-center justify-between gap-2 text-xs">
                  <span className="truncate font-bold text-slate-200">{active || isStarting || isMatching ? displayStatus : t('카메라와 마이크를 준비하세요', 'Prepare your camera and microphone')}</span>
                  <label className="flex shrink-0 items-center gap-1.5 text-[11px] font-bold text-slate-300"><input type="checkbox" checked={flip} onChange={(event) => setFlip(event.target.checked)} className="h-3.5 w-3.5 accent-cyan-400" /> 좌우 반전</label>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {!active ? <button onClick={startMatchFromUi} disabled={isStarting || hasEnded} className="col-span-2 flex min-h-11 items-center justify-center gap-2 rounded-lg bg-cyan-400 px-3 py-2 text-sm font-black text-slate-950 disabled:opacity-50"><PhoneCall size={16} /> LIVE CHAT 시작</button> : <button onClick={() => void endMatch()} disabled={hasEnded} className="col-span-2 flex min-h-11 items-center justify-center gap-2 rounded-lg bg-red-500 px-3 py-2 text-sm font-black text-white disabled:opacity-40"><VideoOff size={16} /> 연결 종료</button>}
                  <button type="button" onClick={toggleMicrophone} disabled={!active || videoOnly} aria-label={audioEnabled ? '마이크 끄기' : '마이크 켜기'} className="flex min-h-11 items-center justify-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2 text-xs font-black disabled:opacity-40">{audioEnabled ? <Mic size={14} /> : <MicOff size={14} />}{audioEnabled ? '마이크 켬' : '음소거'}</button>
                  <button type="button" onClick={() => void toggleScreenShare()} disabled={screenShareDisabled} aria-pressed={sharedScreenVisible} className="flex min-h-11 items-center justify-center gap-1 rounded-lg border border-cyan-300/20 bg-cyan-300/10 px-2 text-xs font-black text-cyan-100 disabled:opacity-40"><MonitorUp size={14} />{isSharingScreen ? '공유 중지' : remoteSharingScreen ? '상대 공유 중' : '함께보기'}</button>
                  <button type="button" onClick={() => void toggleTogetherListen()} disabled={!canToggleTogetherListen} aria-pressed={isSharingScreen ? screenAudioEnabled : screenAudioListening} className="flex min-h-11 items-center justify-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2 text-xs font-black disabled:opacity-40"><Headphones size={14} />{isSharingScreen ? screenAudioEnabled ? '함께듣기 켬' : '함께듣기 끔' : screenAudioListening ? '함께듣는 중' : '함께듣기'}</button>
                  <button type="button" onClick={() => void toggleFullscreen(desktopStageRef.current)} disabled={!fullscreenSupported} aria-pressed={isFullscreen} aria-label={isFullscreen ? '전체 화면 종료' : '전체 화면'} title={fullscreenSupported ? (isFullscreen ? '전체 화면 종료' : '전체 화면') : '이 브라우저에서 전체 화면을 사용할 수 없습니다'} className="call-fullscreen-toggle flex min-h-11 items-center justify-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2 text-xs font-black disabled:opacity-40">{isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}{isFullscreen ? '축소' : '전체 화면'}</button>
                </div>
              </div>
            </div>

            <aside className="space-y-5">
              <section aria-label="영상 통화 시작" className="hidden sm:block border border-cyan-300/30 bg-cyan-300/[.08] p-4">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[10px] font-black uppercase tracking-[.18em] text-cyan-200">{callKind === 'random' ? 'RANDOM MATCH' : callKind === 'friend' ? 'FRIEND CALL' : 'GAME CALL'}</div>
                    <h2 className="mt-1 font-black text-white">{callModeLabel}</h2>
                    <p className="mt-1 text-xs leading-5 text-slate-400">{callKind === 'random' ? '시작을 누르면 안전 안내를 먼저 확인합니다.' : '카메라와 마이크를 확인하고 통화에 참여하세요.'}</p>
                  </div>
                  <span className="shrink-0 border border-white/10 bg-white/[.04] px-2 py-1 text-[10px] font-bold text-slate-300">{hasEnded ? 'ENDED' : isConnected ? 'CONNECTED' : isMatching ? 'MATCHING' : active ? 'CONNECTING' : 'READY'}</span>
                </div>
                <button type="button" onClick={active ? () => void endMatch() : startMatchFromUi} disabled={isStarting || hasEnded} className={`flex min-h-11 w-full items-center justify-center gap-2 px-3 py-2 text-sm font-black disabled:opacity-50 ${active ? 'bg-rose-500 text-white' : 'bg-cyan-300 text-slate-950'}`}>
                  {active ? <VideoOff size={16} aria-hidden="true" /> : <PhoneCall size={16} aria-hidden="true" />}
                  {active ? '연결 종료' : isStarting ? '카메라 연결 중...' : callKind === 'random' ? 'LIVE CHAT 시작' : `${callModeLabel} 시작`}
                </button>
              </section>
              {visiblePeerPhotos.length > 0 && <section className="border border-cyan-300/20 bg-[#111a2d] p-4"><div className="mb-3 flex items-center justify-between gap-2"><h2 className="font-black">상대 공개 사진</h2><span className="text-[10px] font-bold text-cyan-200">{visiblePeerPhotos.length}장 표시</span></div><div className="grid grid-cols-3 gap-2">{visiblePeerPhotos.map((photo, index) => <img key={`${photo}-${index}`} src={photo} alt={`상대 공개 사진 ${index + 1}`} loading="lazy" className="aspect-square w-full object-cover" />)}</div></section>}
              <section aria-label="화상 채팅" className="border border-cyan-300/20 bg-[#111a2d] p-4">
               <div className="mb-3 flex items-center justify-between gap-2"><h2 className="font-black">화상 채팅</h2><span className="truncate text-[10px] font-bold text-cyan-200">{status}</span></div>
               <div className="max-h-60 space-y-2 overflow-y-auto">{chatMessages.length === 0 ? <p className="py-5 text-center text-sm text-slate-500">상대와 연결되면 메시지를 보낼 수 있습니다.</p> : chatMessages.map((message) => <div key={`side-${message.id}`} className="border border-white/10 bg-white/[0.05] p-3 text-xs"><div className="mb-1 text-[10px] font-bold text-cyan-300">{message.user}</div><div className="break-words text-slate-200">{message.text}</div></div>)}</div>
               {permissionError && !hasEnded && <div role="alert" className="mt-3 border border-amber-300/20 bg-amber-500/10 p-3 text-xs font-bold text-amber-100">{permissionError}{!active && <button type="button" onClick={startMatchFromUi} disabled={isStarting} className="mt-2 block border border-amber-200/30 px-3 py-2 disabled:opacity-50">권한 확인 후 다시 시도</button>}</div>}
               {chatError && <p role="alert" className="mt-2 text-xs font-bold text-rose-300">{chatError}</p>}
               {user && activeCallId && <><p className="mt-2 text-[10px] text-slate-500">채팅과 AI 답변은 통화방에 저장되어 양쪽에 표시됩니다.</p><form onSubmit={sendVideoChat} className="mt-2 flex gap-2"><input value={chatInput} onChange={(event) => setChatInput(event.target.value)} placeholder="메시지 또는 AI 질문..." className="min-w-0 flex-1 border border-white/10 bg-black/20 px-3 py-2 text-xs text-white outline-none" /><button type="button" onClick={() => void askSharedAi()} className="border border-violet-300/30 bg-violet-300/10 px-3 text-[11px] font-black text-violet-100">AI 함께</button><button className="bg-cyan-400 px-3 text-xs font-black text-slate-950">전송</button></form></>}
             </section>
             <section className="rounded-[2rem] border border-white/10 bg-[#111a2d] p-5"><div className="mb-4 flex items-center justify-between"><span className="font-black">카메라 설정</span><span className="text-xs text-slate-500">상대 화면에도 적용</span></div><label className="flex cursor-pointer items-center justify-between rounded-xl bg-white/[0.04] p-3 text-sm font-bold"><span>내 화면 좌우 반전</span><input type="checkbox" checked={flip} onChange={(event) => setFlip(event.target.checked)} className="h-4 w-4 accent-cyan-400" /></label><div className="mt-4 flex items-start gap-2 text-xs leading-5 text-slate-500"><CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-300" />내 영상과 상대방에게 전송되는 영상 모두에 적용됩니다.</div></section>
             <section className="rounded-[2rem] border border-cyan-300/20 bg-[#111a2d] p-5"><div className="mb-4 flex items-center justify-between"><span className="font-black">LIVE CHAT 필터 / Filters</span><span className="text-xs font-bold text-cyan-300">18–60</span></div><label className="block text-xs font-bold text-slate-400">찾고 싶은 상대 / Gender<select value={genderPreference} onChange={(event) => setGenderPreference(event.target.value as GenderPreference)} className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm font-bold text-white outline-none"><option value="any">모두 / Any</option><option value="male">남성 / Male</option><option value="female">여성 / Female</option></select></label><div className="mt-4 grid grid-cols-2 gap-2"><label className="text-xs font-bold text-slate-400">최소 나이 / Min<select value={ageMin} onChange={(event) => setAgeMin(Number(event.target.value))} className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm font-bold text-white outline-none">{Array.from({ length: 43 }, (_, index) => index + 18).map((value) => <option key={value} value={value}>{value}</option>)}</select></label><label className="text-xs font-bold text-slate-400">최대 나이 / Max<select value={ageMax} onChange={(event) => setAgeMax(Number(event.target.value))} className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm font-bold text-white outline-none">{Array.from({ length: 43 }, (_, index) => index + 18).map((value) => <option key={value} value={value}>{value}</option>)}</select></label></div><p className="mt-3 text-xs leading-5 text-slate-500">랜덤 화상 매칭은 18–60세 범위에서만 연결합니다. 친구 통화는 서로 지정한 상대에게 직접 연결됩니다.</p></section>
             <section className="rounded-[2rem] border border-white/10 bg-[#111a2d] p-5 text-sm text-slate-400"><div className="mb-2 flex items-center gap-2 font-black text-white"><RefreshCcw size={16} className="text-cyan-300" /> 자동 연결 안내</div><p>연결이 끊기거나 상대가 나가면 연결 종료를 누르지 않아도 다음 인증 회원을 계속 찾습니다.</p></section>
           </aside>
          </div>
        </div>
     </div>
    </>
  );
}
