"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Camera,
  CircleStop,
  ImagePlus,
  MessageCircle,
  Mic,
  MonitorUp,
  Radio,
  RotateCcw,
  Send,
  Settings2,
} from "lucide-react";
import {
  createDocument,
  deleteDocument,
  getDocument,
  getSessionToken,
  mergeDocument,
  queryDocumentsWhere,
  type PortalUser,
} from "@/lib/firebase";
import { useGlobalStore } from "@/store/useGlobalStore";
import {
  createVideoCompositor,
  DEFAULT_VIDEO_EFFECTS,
  VIDEO_EFFECT_CONTROLS,
  type VideoEffects,
  type VideoCompositor,
} from "@/lib/videoEffects";
import {
  defaultRoomTitle,
  limitRoomTitle,
  LiveElapsed,
  writeLiveRoom,
} from "../liveRoomShared";
type ViewerSignal = {
  id: string;
  roomId: string;
  sessionId?: string;
  viewerId: string;
  hostId: string;
  status: "offer" | "answer" | "connected" | "ended";
  offer?: string;
  answer?: string;
  updatedAt?: string;
};
type LiveMessage = {
  id: string;
  roomId: string;
  sessionId?: string;
  authorId: string;
  user: string;
  text: string;
  createdAt: string;
};
const iceServers = [
  { urls: "stun:stun.cloudflare.com:3478" },
  { urls: "stun:stun.l.google.com:19302" },
  {
    urls: "turn:openrelay.metered.ca:80",
    username: process.env.NEXT_PUBLIC_TURN_USERNAME || "openrelayproject",
    credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL || "openrelayproject",
  },
  {
    urls: "turn:openrelay.metered.ca:443",
    username: process.env.NEXT_PUBLIC_TURN_USERNAME || "openrelayproject",
    credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL || "openrelayproject",
  },
  {
    urls: "turn:openrelay.metered.ca:443?transport=tcp",
    username: process.env.NEXT_PUBLIC_TURN_USERNAME || "openrelayproject",
    credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL || "openrelayproject",
  },
  {
    urls: "turns:openrelay.metered.ca:443?transport=tcp",
    username: process.env.NEXT_PUBLIC_TURN_USERNAME || "openrelayproject",
    credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL || "openrelayproject",
  },
];
const waitForIce = (peer: RTCPeerConnection) =>
  new Promise<void>((resolve) => {
    if (peer.iceGatheringState === "complete") return resolve();
    const finish = () => {
      if (peer.iceGatheringState === "complete") {
        peer.removeEventListener("icegatheringstatechange", finish);
        resolve();
      }
    };
    peer.addEventListener("icegatheringstatechange", finish);
    window.setTimeout(() => {
      peer.removeEventListener("icegatheringstatechange", finish);
      resolve();
    }, 4000);
  });
export default function LiveBroadcastPage() {
  const user = useGlobalStore((state) => state.user) as PortalUser | null;
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const thumbnailInputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const viewerPeersRef = useRef(new Map<string, RTCPeerConnection>());
  const viewerOffersRef = useRef(new Map<string, string>());
  const stopInFlightRef = useRef<Promise<void> | null>(null);
  const stopBroadcastRef = useRef<(publish?: boolean) => Promise<void>>(
    async () => undefined,
  );
  const roomRef = useRef("live-room-01");
  const sessionRef = useRef<string | null>(null);
  const [roomId, setRoomId] = useState("live-room-01");
  const [roomTitle, setRoomTitle] = useState("ROOM 1");
  const [filters, setFilters] = useState(DEFAULT_VIDEO_EFFECTS);
  const filtersRef = useRef(DEFAULT_VIDEO_EFFECTS);
  const compositorRef = useRef<VideoCompositor | null>(null);
  const mediaAbortRef = useRef<AbortController | null>(null);
  const mediaVersionRef = useRef(0);
  const startingRef = useRef(false);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [message, setMessage] = useState(
    "카메라를 켜고 방송 설정을 확인하세요.",
  );
  const [quality, setQuality] = useState("1080p");
  const [micOn, setMicOn] = useState(true);
  const [screenSharing, setScreenSharing] = useState(false);
  const [uploadedThumbnail, setUploadedThumbnail] = useState<string | null>(
    null,
  );
  const [chatMessages, setChatMessages] = useState<LiveMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [studioTab, setStudioTab] = useState<"chat" | "settings">("settings");
  useEffect(() => {
    const requested =
      new URLSearchParams(window.location.search).get("room") || "";
    const nextRoom = /^live-room-(0[1-9]|[12]\d|30)$/.test(requested)
      ? requested
      : "live-room-01";
    roomRef.current = nextRoom;
    setRoomId(nextRoom);
    setRoomTitle(defaultRoomTitle(nextRoom));
  }, []);
  const captureThumbnail = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (
      !video ||
      !canvas ||
      video.readyState < 2 ||
      !video.videoWidth ||
      !video.videoHeight
    )
      return undefined;
    const width = 640;
    canvas.width = width;
    canvas.height = Math.round((width * video.videoHeight) / video.videoWidth);
    const context = canvas.getContext("2d");
    if (!context) return undefined;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.72);
  };
  const publishRoom = async (
    status: "live" | "offline",
    thumbnail?: string,
    resetViewers = false,
  ) => {
    if (!user) {
      setMessage("방송하려면 먼저 로그인해주세요.");
      return false;
    }
    const token = getSessionToken();
    if (!token) {
      setMessage("로그인 세션이 만료되었습니다. 다시 로그인해주세요.");
      return false;
    }
    const offline = status === "offline";
    const roomData = {
      quality,
      ...(resetViewers
        ? {
            title: limitRoomTitle(
              roomTitle.trim() || defaultRoomTitle(roomRef.current),
            ),
            category: "교민 라이브",
          }
        : {}),
      ...(thumbnail !== undefined ? { thumbnail } : {}),
    };
    try {
      const time = await writeLiveRoom(
        roomRef.current,
        user,
        sessionRef.current,
        offline ? "stop" : resetViewers ? "start" : "update",
        roomData,
      );
      if (resetViewers) setStartedAt(time);
      return true;
    } catch {
      setMessage(
        "라이브 서버에 연결하지 못했습니다. Firebase 로그인과 방송 권한을 확인해주세요.",
      );
      return false;
    }
  };
  const saveTitle = async () => {
    if (!live || !user || !sessionRef.current) return;
    const title = limitRoomTitle(
      roomTitle.trim() || defaultRoomTitle(roomRef.current),
    );
    try {
      await writeLiveRoom(roomRef.current, user, sessionRef.current, "update", {
        title,
      });
      setRoomTitle(title);
      setMessage("방 제목을 저장했습니다.");
    } catch {
      setMessage(
        "제목을 저장하지 못했습니다. 현재 방송자 권한을 확인하고 다시 시도해주세요.",
      );
    }
  };
  useEffect(() => {
    filtersRef.current = filters;
    compositorRef.current?.setEffects(filters);
  }, [filters]);
  const replacePeerTrack = async (track: MediaStreamTrack) => {
    await Promise.all(
      [...viewerPeersRef.current.values()].map(async (peer) => {
        const sender = peer
          .getSenders()
          .find((item) => item.track?.kind === track.kind);
        await sender?.replaceTrack(track);
        if (track.kind === "video" && sender) {
          const parameters = sender.getParameters();
          parameters.encodings = parameters.encodings?.length
            ? parameters.encodings
            : [{}];
          parameters.encodings[0].maxBitrate = 8000000;
          parameters.encodings[0].maxFramerate = 60;
          parameters.degradationPreference = "maintain-resolution";
          await sender.setParameters(parameters).catch(() => undefined);
        }
      }),
    );
  };
  const checkRoomAvailability = async () => {
    if (!user) return false;
    const token = getSessionToken();
    if (!token) return false;
    const current = await getDocument<{
      hostId?: string | null;
      status?: "live" | "offline";
      updatedAt?: string;
    }>("liveRooms", roomRef.current, token).catch(() => null);
    if (!current || current.hostId === user.id || current.status !== "live")
      return true;
    const updatedAt = current.updatedAt
      ? new Date(current.updatedAt).getTime()
      : 0;
    if (Number.isFinite(updatedAt) && Date.now() - updatedAt > 20000)
      return true;
    setMessage(
      "이 방은 현재 다른 방송자가 방송 중입니다. 방송이 끝난 뒤 다시 입장해주세요.",
    );
    return false;
  };
  const startCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia)
      return setMessage("이 브라우저는 카메라를 지원하지 않습니다.");
    const version = ++mediaVersionRef.current;
    let acquired: MediaStream | null = null;
    try {
      const previousCamera = cameraStreamRef.current;
      const width =
        quality === "1080p" ? 1920 : quality === "480p" ? 854 : 1280;
      const height =
        quality === "1080p" ? 1080 : quality === "480p" ? 480 : 720;
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: width, max: width },
          height: { ideal: height, max: height },
          frameRate: { ideal: 60, max: 60 },
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      acquired = stream;
      if (version !== mediaVersionRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      let compositor = compositorRef.current;
      if (compositor) await compositor.setSource(stream);
      else {
        const controller = new AbortController();
        mediaAbortRef.current = controller;
        compositor = await createVideoCompositor(stream, filters, {
          signal: controller.signal,
        });
      }
      if (version !== mediaVersionRef.current) {
        if (compositor !== compositorRef.current) compositor.dispose();
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      compositorRef.current = compositor;
      compositor.setEffects(filtersRef.current);
      previousCamera?.getTracks().forEach((track) => {
        track.onended = null;
        track.stop();
      });
      screenStreamRef.current?.getTracks().forEach((track) => {
        track.onended = null;
        track.stop();
      });
      screenStreamRef.current = null;
      setScreenSharing(false);
      stream.getAudioTracks().forEach((track) => {
        track.enabled = micOn;
      });
      stream.getVideoTracks().forEach((track) => {
        track.onended = () => {
          setCameraReady(false);
          setMessage(
            "카메라가 꺼졌습니다. 카메라 다시 켜기를 눌러 재연결하세요.",
          );
        };
      });
      cameraStreamRef.current = stream;
      const outgoing = new MediaStream([
        compositor.videoTrack,
        ...stream.getAudioTracks(),
      ]);
      streamRef.current = outgoing;
      setCameraReady(true);
      if (videoRef.current) {
        videoRef.current.srcObject = outgoing;
        await videoRef.current.play().catch(() => undefined);
      }
      const videoTrack = compositor.videoTrack;
      const audioTrack = stream.getAudioTracks()[0];
      if (videoTrack) await replacePeerTrack(videoTrack);
      if (audioTrack) await replacePeerTrack(audioTrack);
      setMessage(
        live
          ? "카메라가 다시 연결되었습니다. 현재 LIVE 송출에 반영됩니다."
          : "카메라 준비 완료 · 방송 시작을 누르면 LIVE로 표시됩니다.",
      );
    } catch {
      acquired?.getTracks().forEach((track) => track.stop());
      if (version !== mediaVersionRef.current) return;
      setCameraReady(false);
      setMessage(
        "카메라 권한 또는 Canvas 영상 송출을 사용할 수 없습니다. 지원 브라우저에서 다시 시도해주세요.",
      );
    }
  };
  useEffect(() => {
    void startCamera();
  }, []);
  const handleThumbnailUpload = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 2000000)
      return setMessage("썸네일은 2MB 이하의 이미지로 올려주세요.");
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : null;
      if (!result) return;
      setUploadedThumbnail(result);
      setMessage("업로드한 썸네일을 방송방에 적용했습니다.");
      if (live) void publishRoom("live", result);
    };
    reader.readAsDataURL(file);
  };
  const toggleMic = () => {
    const nextValue = !micOn;
    streamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = nextValue;
    });
    setMicOn(nextValue);
    setMessage(nextValue ? "마이크가 켜졌습니다." : "마이크가 꺼졌습니다.");
  };
  const stopScreenShare = async () => {
    const screen = screenStreamRef.current;
    try {
      if (
        !cameraStreamRef.current
          ?.getVideoTracks()
          .some((track) => track.readyState === "live")
      ) {
        await startCamera();
        return;
      }
      await compositorRef.current?.setSource(cameraStreamRef.current);
      screen?.getTracks().forEach((track) => {
        track.onended = null;
        track.stop();
      });
      screenStreamRef.current = null;
      setScreenSharing(false);
    } catch {
      void stopBroadcastRef.current();
    }
  };
  const toggleScreenShare = async () => {
    if (screenSharing) return stopScreenShare();
    if (!navigator.mediaDevices?.getDisplayMedia)
      return setMessage("이 브라우저는 화면 공유를 지원하지 않습니다.");
    if (!streamRef.current) await startCamera();
    if (!streamRef.current) return;
    const version = ++mediaVersionRef.current;
    let acquired: MediaStream | null = null;
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });
      acquired = screenStream;
      if (version !== mediaVersionRef.current || !compositorRef.current) {
        screenStream.getTracks().forEach((track) => track.stop());
        return;
      }
      const screenTrack = screenStream.getVideoTracks()[0];
      if (!screenTrack) throw new Error("No screen video.");
      await compositorRef.current.setSource(screenStream);
      if (version !== mediaVersionRef.current) { screenStream.getTracks().forEach((track) => track.stop()); return; }
      screenStreamRef.current?.getTracks().forEach((track) => { track.onended = null; track.stop(); });
      screenStreamRef.current = screenStream;
      screenTrack.onended = () => {
        void stopScreenShare();
      };
      if (videoRef.current) videoRef.current.srcObject = streamRef.current;
      setScreenSharing(true);
      setMessage("화면을 공유하는 중입니다.");
    } catch {
      acquired?.getTracks().forEach((track) => track.stop());
      setMessage("화면 공유가 취소되었거나 권한이 없습니다.");
    }
  };
  const startBroadcast = async () => {
    if (startingRef.current || sessionRef.current || stopInFlightRef.current)
      return;
    startingRef.current = true;
    try {
      if (!user) return setMessage("방송하려면 먼저 로그인해주세요.");
      if (!(await checkRoomAvailability())) return;
      if (!streamRef.current) await startCamera();
      if (!streamRef.current) return;
      sessionRef.current = `${roomRef.current}-${crypto.randomUUID()}`;
      const startingSession = sessionRef.current;
      const version = mediaVersionRef.current;
      const published = await publishRoom(
        "live",
        uploadedThumbnail || captureThumbnail(),
        true,
      );
      if (!published) {
        setLive(false);
        sessionRef.current = null;
        return;
      }
      if (version !== mediaVersionRef.current || !streamRef.current) {
        await writeLiveRoom(roomRef.current, user, startingSession, 'stop').catch(() => undefined);
        return;
      }
      setLive(true);
      setMessage(
        "LIVE 방송 중 · 시청자에게 카메라와 썸네일을 송출하고 있습니다.",
      );
    } finally {
      startingRef.current = false;
    }
  };
  const stopBroadcast = async (publish = true) => {
    if (stopInFlightRef.current) return stopInFlightRef.current;
    const promise = (async () => {
      const sessionId = sessionRef.current;
      const token = getSessionToken();
      let released = !publish || !sessionId;
      mediaVersionRef.current += 1;
      mediaAbortRef.current?.abort();
      compositorRef.current?.dispose();
      compositorRef.current = null;
      setLive(false);
      viewerPeersRef.current.forEach((peer) => peer.close());
      viewerPeersRef.current.clear();
      viewerOffersRef.current.clear();
      screenStreamRef.current?.getTracks().forEach((track) => {
        track.onended = null;
        track.stop();
      });
      screenStreamRef.current = null;
      cameraStreamRef.current?.getTracks().forEach((track) => {
        track.onended = null;
        track.stop();
      });
      cameraStreamRef.current = null;
      streamRef.current?.getTracks().forEach((track) => {
        track.onended = null;
        track.stop();
      });
      streamRef.current = null;
      setCameraReady(false);
      if (publish && token && sessionId) {
        const [viewers, messages] = await Promise.all([
          queryDocumentsWhere<{
            roomId?: string;
            sessionId?: string;
          }>(
            "liveRoomViewers",
            [
              { field: "roomId", op: "EQUAL", value: roomRef.current },
              { field: "sessionId", op: "EQUAL", value: sessionId },
            ],
            token,
            200,
          ).catch(() => []),
          queryDocumentsWhere<{
            roomId?: string;
            sessionId?: string;
          }>(
            "liveRoomMessages",
            [
              { field: "roomId", op: "EQUAL", value: roomRef.current },
              { field: "sessionId", op: "EQUAL", value: sessionId },
            ],
            token,
            200,
          ).catch(() => []),
        ]);
        await Promise.allSettled([
          ...viewers.map((item) =>
            deleteDocument("liveRoomViewers", item.id, token),
          ),
          ...messages.map((item) =>
            deleteDocument("liveRoomMessages", item.id, token),
          ),
        ]);
        released = await publishRoom("offline");
      }
      setScreenSharing(false);
      setLive(false);
      sessionRef.current = null;
      setStartedAt(null);
      setRoomTitle(defaultRoomTitle(roomRef.current));
      setUploadedThumbnail(null);
      setMessage(
        released ? "방송이 종료되고 방 제목·썸네일·채팅이 초기화되었습니다." : "송출은 중지됐지만 서버 초기화를 확인하지 못했습니다. 방 상태를 확인해주세요.",
      );
    })();
    stopInFlightRef.current = promise;
    try {
      await promise;
    } finally {
      if (stopInFlightRef.current === promise) stopInFlightRef.current = null;
    }
  };
  useEffect(() => {
    stopBroadcastRef.current = stopBroadcast;
  }, [stopBroadcast]);
  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(
      () => void publishRoom("live", uploadedThumbnail || captureThumbnail()),
      5000,
    );
    return () => window.clearInterval(timer);
  }, [live, quality, user?.id, uploadedThumbnail]);
  useEffect(() => {
    if (!live || !user) return;
    let active = true;
    const monitorStartedAt = Date.now();
    const checkRoom = async () => {
      if (Date.now() - monitorStartedAt < 2500) return;
      const token = getSessionToken();
      if (!token || !sessionRef.current) return;
      let room;
      try { room = await getDocument<{
        status?: "live" | "offline";
        sessionId?: string | null;
      }>("liveRooms", roomRef.current, token); } catch { return; }
      if (
        !active ||
        (room?.status === "live" && room.sessionId === sessionRef.current)
      )
        return;
      await stopBroadcast(false);
      if (active)
        setMessage(
          "Master가 방송방을 종료해 카메라·채팅·썸네일을 초기화했습니다.",
        );
    };
    void checkRoom();
    const timer = window.setInterval(() => void checkRoom(), 1500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [live, user?.id]);
  useEffect(() => {
    const loadChat = async () => {
      if (!sessionRef.current) {
        setChatMessages([]);
        return;
      }
      const rows = await queryDocumentsWhere<LiveMessage>(
        "liveRoomMessages",
        [
          { field: "roomId", op: "EQUAL", value: roomId },
          { field: "sessionId", op: "EQUAL", value: sessionRef.current },
        ],
        getSessionToken(),
        40,
      ).catch(() => []);
      setChatMessages(
        rows
          .sort(
            (a, b) =>
              new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
          )
          .slice(-10),
      );
    };
    void loadChat();
    const timer = window.setInterval(() => void loadChat(), 1000);
    return () => window.clearInterval(timer);
  }, [roomId]);
  useEffect(() => {
    const preview = document.querySelector(".live-studio-preview .relative");
    if (!preview) return;
    let overlay = preview.querySelector<HTMLDivElement>(
      ".live-broadcast-chat-overlay",
    );
    if (!live || chatMessages.length === 0) {
      overlay?.remove();
      return;
    }
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.className = "live-broadcast-chat-overlay";
      overlay.setAttribute("aria-live", "polite");
      preview.appendChild(overlay);
    }
    overlay.replaceChildren(
      ...chatMessages.slice(-10).map((item) => {
        const row = document.createElement("div");
        const author = document.createElement("b");
        const text = document.createElement("span");
        row.className =
          item.authorId === user?.id ? "live-chat-own" : "live-chat-other";
        author.textContent = item.user;
        text.textContent = item.text;
        row.append(author, text);
        return row;
      }),
    );
    return () => overlay?.remove();
  }, [chatMessages, live]);
  useEffect(() => {
    const preview = document.querySelector(".live-studio-preview .relative");
    if (!preview) return;
    let composer = preview.querySelector<HTMLFormElement>(
      ".live-broadcast-chat-composer",
    );
    if (!live) {
      composer?.remove();
      return;
    }
    if (!composer) {
      composer = document.createElement("form");
      composer.className = "live-broadcast-chat-composer";
      const input = document.createElement("input");
      input.className = "live-room-input";
      input.placeholder = "시청자에게 답장하기";
      input.setAttribute("aria-label", "시청자에게 답장하기");
      const button = document.createElement("button");
      button.type = "submit";
      button.className = "live-room-send";
      button.setAttribute("aria-label", "방송자 메시지 보내기");
      button.innerHTML = '<span aria-hidden="true">↗</span>';
      composer.append(input, button);
      composer.addEventListener("submit", async (event) => {
        event.preventDefault();
        const text = input.value.trim();
        const token = getSessionToken();
        if (!user || !token || !sessionRef.current || !text) return;
        try {
          await createDocument(
            "liveRoomMessages",
            crypto.randomUUID(),
            {
              roomId: roomRef.current,
              sessionId: sessionRef.current,
              authorId: user.id,
              user: user.name,
              text,
              createdAt: new Date(),
            },
            token,
          );
          input.value = "";
        } catch {
          setMessage("채팅을 보내지 못했습니다. 잠시 후 다시 시도해주세요.");
        }
      });
      preview.appendChild(composer);
    }
    return () => composer?.remove();
  }, [live, user?.id]);
  useEffect(() => {
    if (!live || !user || !streamRef.current) return;
    const token = getSessionToken();
    if (!token) return;
    let active = true;
    const acceptViewers = async () => {
      const rows = await queryDocumentsWhere<ViewerSignal>(
        "liveRoomViewers",
        [
          { field: "roomId", op: "EQUAL", value: roomRef.current },
          { field: "sessionId", op: "EQUAL", value: sessionRef.current },
          { field: "hostId", op: "EQUAL", value: user.id },
        ],
        token,
        50,
      ).catch(() => []);
      const now = Date.now();
      const activeViewers = rows.filter(
        (viewer) =>
          viewer.status !== "ended" &&
          viewer.updatedAt &&
          now - new Date(viewer.updatedAt).getTime() < 15000,
      );
      if (!active || !sessionRef.current) return;
      await writeLiveRoom(roomRef.current, user, sessionRef.current, "update", {
        viewers: activeViewers.length,
      }).catch(() => undefined);
      for (const viewer of rows.filter(
        (item) => item.status === "offer" && item.offer,
      )) {
        if (!active || !viewer.offer) continue;
        const previousOffer = viewerOffersRef.current.get(viewer.id);
        if (
          previousOffer === viewer.offer &&
          viewerPeersRef.current.has(viewer.id)
        )
          continue;
        viewerPeersRef.current.get(viewer.id)?.close();
        viewerPeersRef.current.delete(viewer.id);
        viewerOffersRef.current.set(viewer.id, viewer.offer);
        const peer = new RTCPeerConnection({ iceServers });
        viewerPeersRef.current.set(viewer.id, peer);
        const stream = streamRef.current;
        if (!stream) {
          peer.close();
          viewerPeersRef.current.delete(viewer.id);
          continue;
        }
        stream.getTracks().forEach((track) => {
          track.contentHint = track.kind === "video" ? "motion" : "";
          peer.addTrack(track, stream);
        });
        await Promise.all(
          peer
            .getSenders()
            .filter((sender) => sender.track?.kind === "video")
            .map(async (sender) => {
              const parameters = sender.getParameters();
              parameters.encodings = parameters.encodings?.length
                ? parameters.encodings
                : [{}];
              parameters.encodings[0].maxBitrate = 3000000;
              parameters.encodings[0].maxFramerate = 30;
              parameters.degradationPreference = "maintain-resolution";
              await sender.setParameters(parameters).catch(() => undefined);
            }),
        );
        peer.onconnectionstatechange = () => {
          if (
            peer.connectionState === "failed" ||
            peer.connectionState === "closed"
          ) {
            peer.close();
            viewerPeersRef.current.delete(viewer.id);
            viewerOffersRef.current.delete(viewer.id);
          }
        };
        try {
          await peer.setRemoteDescription(
            JSON.parse(viewer.offer) as RTCSessionDescriptionInit,
          );
          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          await waitForIce(peer);
          await mergeDocument(
            "liveRoomViewers",
            viewer.id,
            {
              sessionId: sessionRef.current,
              status: "answer",
              answer: JSON.stringify(peer.localDescription),
              updatedAt: new Date(),
            },
            token,
          );
        } catch {
          peer.close();
          viewerPeersRef.current.delete(viewer.id);
        }
      }
    };
    void acceptViewers();
    const timer = window.setInterval(() => void acceptViewers(), 1500);
    return () => {
      active = false;
      window.clearInterval(timer);
      viewerPeersRef.current.forEach((peer) => peer.close());
      viewerPeersRef.current.clear();
      viewerOffersRef.current.clear();
    };
  }, [live, user?.id]);
  useEffect(
    () => () => {
      void stopBroadcastRef.current();
    },
    [],
  );
  const sendBroadcasterMessage = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user || !live || !sessionRef.current || !chatInput.trim()) return;
    const token = getSessionToken();
    if (!token) return;
    try {
      await createDocument(
        "liveRoomMessages",
        crypto.randomUUID(),
        {
          roomId: roomRef.current,
          sessionId: sessionRef.current,
          authorId: user.id,
          user: user.name,
          text: chatInput.trim(),
          createdAt: new Date(),
        },
        token,
      );
      setChatInput("");
    } catch {
      setMessage("채팅을 보내지 못했습니다. 잠시 후 다시 시도해주세요.");
    }
  };
  const updateFilter = (key: Exclude<keyof VideoEffects, 'mirror'>, value: number) =>
    setFilters((current) => ({ ...current, [key]: value }));
  const resetFilters = () => setFilters(DEFAULT_VIDEO_EFFECTS);
  return (
    <main className="live-broadcast-page min-h-screen bg-[#050812] px-3 py-5 text-white sm:px-6 lg:px-10">
      <div className="mx-auto max-w-[1500px]">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link
              href="/theater"
              className="mb-3 inline-flex items-center gap-2 text-xs font-black text-rose-200 hover:text-white"
            >
              <ArrowLeft size={14} /> LIVE ROOM으로 돌아가기
            </Link>
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.22em] text-rose-300">
              <Radio size={15} /> Broadcaster studio
            </div>
            <h1 className="mt-1 text-2xl font-black text-white">
              LIVE ROOM · 방송 설정
            </h1>
            <p className="mt-1 text-xs text-slate-500">
              {roomId} · {live ? "현재 송출 중" : "방송 전 카메라 미리보기"}
            </p>
          </div>
          <span className={`live-indicator ${live ? "is-live" : ""}`}>
            <span />
            {live ? "LIVE" : cameraReady ? "CAMERA READY" : "READY"}
          </span>
        </header>
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <section className="live-studio-preview">
            <div className="relative aspect-video overflow-hidden bg-black">
              <video
                ref={videoRef}
                muted
                playsInline
                className="h-full w-full object-cover"
              />
              <canvas ref={canvasRef} className="hidden" />
              {!cameraReady && (
                <div className="absolute inset-0 grid place-items-center text-center">
                  <div>
                    <Camera size={38} className="mx-auto text-rose-300" />
                    <p className="mt-3 text-sm font-black">카메라 미리보기</p>
                    <p className="mt-1 text-xs text-slate-500">
                      방송 전에 얼굴과 화면을 확인할 수 있습니다.
                    </p>
                  </div>
                </div>
              )}
              {live && (
                <div className="absolute left-3 top-3 live-indicator is-live">
                  <span />
                  LIVE <LiveElapsed startedAt={startedAt} />
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 p-3">
              {!cameraReady && <button
                type="button"
                onClick={() => void startCamera()}
                className="live-studio-button"
              >
                <Camera size={15} />
                카메라 다시 연결
              </button>}
              <button
                type="button"
                onClick={toggleMic}
                className="live-studio-button"
              >
                <Mic size={15} />
                {micOn ? "마이크 켜짐" : "마이크 꺼짐"}
              </button>
              <button
                type="button"
                onClick={() => void toggleScreenShare()}
                className="live-studio-button"
              >
                <MonitorUp size={15} />
                {screenSharing ? "화면 공유 중" : "화면 공유"}
              </button>
              <button
                type="button"
                onClick={() => thumbnailInputRef.current?.click()}
                className="live-studio-button"
              >
                <ImagePlus size={15} />
                썸네일 업로드
              </button>
              <input
                ref={thumbnailInputRef}
                type="file"
                accept="image/*"
                onChange={handleThumbnailUpload}
                className="hidden"
              />
              {live ? (
                <button
                  type="button"
                  onClick={() => void stopBroadcast()}
                  className="live-studio-stop"
                >
                  <CircleStop size={15} />
                  방송 종료
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void startBroadcast()}
                  className="live-studio-start"
                >
                  <Radio size={15} />
                  방송 시작
                </button>
              )}
            </div>
            <p className="border-t border-white/10 px-3 py-2 text-xs text-slate-400">
              {message}
            </p>
          </section>
          <aside className="live-studio-settings">
            <div
              className="flex gap-1 border-b border-white/10 pb-2"
              role="tablist"
            >
              <button
                type="button"
                role="tab"
                aria-selected={studioTab === "chat"}
                onClick={() => setStudioTab("chat")}
                className={`live-studio-tab ${studioTab === "chat" ? "is-active" : ""}`}
              >
                <MessageCircle size={14} />
                채팅 <span>{chatMessages.length}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={studioTab === "settings"}
                onClick={() => setStudioTab("settings")}
                className={`live-studio-tab ${studioTab === "settings" ? "is-active" : ""}`}
              >
                <Settings2 size={14} />
                방송 설정
              </button>
            </div>
            {studioTab === "chat" ? (
              <div className="live-studio-chat">
                <div className="flex items-center justify-between text-xs font-black">
                  <span>시청자와 실시간 대화</span>
                  <span className="text-slate-500">방송자 화면</span>
                </div>
                <div className="live-studio-chat-list">
                  {chatMessages.length ? (
                    chatMessages.map((item) => (
                      <div key={item.id} className="live-studio-chat-row">
                        <b>{item.user}</b>
                        <span>{item.text}</span>
                      </div>
                    ))
                  ) : (
                    <p className="py-12 text-center text-xs text-slate-600">
                      시청자 메시지가 여기에 표시됩니다.
                    </p>
                  )}
                </div>
                <form
                  onSubmit={sendBroadcasterMessage}
                  className="mt-3 flex gap-2"
                >
                  <input
                    value={chatInput}
                    onChange={(event) => setChatInput(event.target.value)}
                    className="live-room-input"
                    placeholder="시청자에게 답장하기"
                  />
                  <button
                    type="submit"
                    aria-label="방송자 메시지 보내기"
                    className="live-room-send"
                  >
                    <Send size={14} />
                  </button>
                </form>
              </div>
            ) : (
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-black">
                    <Settings2 size={16} className="text-rose-300" />
                    고급 방송 설정
                  </div>
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="text-xs text-slate-500 hover:text-white"
                  >
                    <RotateCcw size={14} />
                  </button>
                </div>
                <label className="mt-4 block text-xs font-bold text-slate-400">
                  방송 품질
                  <select
                    value={quality}
                    onChange={(event) => setQuality(event.target.value)}
                    className="live-studio-select"
                  >
                    <option>1080p</option>
                    <option>720p</option>
                    <option>480p</option>
                  </select>
                </label>
                <div className="mt-5 space-y-4">
                  <div className="flex items-center gap-2 text-xs font-black text-amber-200">
                    조도·색상
                  </div>
                  {VIDEO_EFFECT_CONTROLS.map(({ key, label, min, max }) => (
                    <label key={key} className="block text-xs text-slate-400">
                      {label}
                      <input
                        type="range"
                        min={min}
                        max={max}
                        value={filters[key]}
                        onChange={(event) =>
                          updateFilter(key, Number(event.target.value))
                        }
                        className="mt-2 w-full accent-rose-300"
                      />
                    </label>
                  ))}
                </div>
                <div className="mt-5 space-y-4">
                  <label className="block text-xs text-slate-400">
                    좌우 반전 · 시청자에게도 적용
                    <input
                      type="checkbox"
                      checked={filters.mirror}
                      onChange={(event) => setFilters((current) => ({ ...current, mirror: event.target.checked }))}
                      className="ml-2 accent-cyan-300"
                    />
                  </label>
                </div>
                <div className="mt-5 grid grid-cols-2 gap-2 text-[11px] text-slate-500">
                  <div className="border border-white/10 p-3">
                    모든 효과는 실제 송출 영상에 적용됩니다.
                  </div>
                  <div className="border border-white/10 p-3">
                    <Radio size={14} className="mb-1 text-rose-300" />
                    {quality} 요청 · 최대 30fps · 기기 성능에 따라 달라집니다.
                  </div>
                </div>
              </div>
            )}
          </aside>
          <section className="xl:col-span-2 rounded-2xl border border-rose-300/15 bg-white/[.03] p-4">
            <label className="block text-xs font-bold text-slate-300">
              방 제목
              <input
                value={roomTitle}
                onChange={(event) =>
                  setRoomTitle(limitRoomTitle(event.target.value))
                }
                className="live-studio-select mt-2"
              />
              <small className="mt-1 block text-[10px] text-slate-500">
                최대 10자 · 방송 중 저장하면 모든 시청자에게 반영됩니다.
              </small>
            </label>
            {live && <button type="button" onClick={() => void saveTitle()} className="live-studio-button">제목 저장</button>}
          </section>
        </div>
      </div>
    </main>
  );
}
