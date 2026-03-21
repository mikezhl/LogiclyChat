import { useCallback, useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track } from "livekit-client";

import { decodeLivekitChatMessageEvent, LIVEKIT_CHAT_MESSAGE_TOPIC } from "@/lib/livekit-chat-event";
import {
  decodeLivekitTranscriptionStatusEvent,
  LIVEKIT_TRANSCRIPTION_STATUS_TOPIC,
} from "@/lib/livekit-transcription-status-event";
import { type ChatMessage } from "@/lib/chat-types";
import { type RoomSpeakerMode } from "@/lib/room-speaker";
import { type UiLanguage } from "@/lib/ui-language";

import {
  createInitialRoomMetaState,
  findLatestRoomNameFromMessages,
  getIdleTranscriptionState,
  getOwnerOfflineError,
  getPublishedMicrophoneTrackSid,
  hasConnectedTranscriberParticipant,
  hasPublishedMicrophoneTrack,
  mergeMessages,
  ROOM_CONNECTION_IDLE_TIMEOUT_MS,
  ROOM_META_POLL_INTERVAL_MS,
  TRANSCRIBER_PARTICIPANT_TIMEOUT_MS,
  TRANSCRIPTION_ATTACHMENT_TIMEOUT_MS,
  type MessagesResponse,
  type RoomConnectionState,
  type RoomMetaResponse,
  type RoomMetaState,
  type RoomPageTranslate,
  type TokenResponse,
  type TranscriptionState,
} from "./room-page-support";

type PrepareMicrophoneForCallRef = {
  current: (() => Promise<string>) | null;
};

type UseRoomSessionArgs = {
  initialRoomName: string | null;
  language: UiLanguage;
  prepareMicrophoneForCallRef: PrepareMicrophoneForCallRef;
  roomId: string;
  t: RoomPageTranslate;
};

export function useRoomSession({
  initialRoomName,
  language,
  prepareMicrophoneForCallRef,
  roomId,
  t,
}: UseRoomSessionArgs) {
  const roomRef = useRef<Room | null>(null);
  const audioContainerRef = useRef<HTMLDivElement>(null);
  const warmupRequestedRef = useRef(false);
  const latestMessageCreatedAtRef = useRef<string | null>(null);
  const inactivityTimerRef = useRef<number | null>(null);

  const voiceProviderRef = useRef(createInitialRoomMetaState(initialRoomName).providers.voice);
  const micEnabledRef = useRef(false);
  const participantIdentityRef = useRef("");
  const speakerModeRef = useRef<RoomSpeakerMode>("self");
  const pendingVoiceRestartAfterSpeakerSwitchRef = useRef(false);
  const voiceCallStartingRef = useRef(false);
  const attachedTranscriptionParticipantsRef = useRef(new Map<string, string | null>());
  const transcriptionAttachmentWaiterRef = useRef<{
    participantIdentity: string;
    expectedTrackSid: string | null;
    resolve: () => void;
    reject: (error: Error) => void;
    timeoutId: number;
  } | null>(null);
  const previousOwnerActiveRef = useRef(false);

  const [roomMeta, setRoomMeta] = useState<RoomMetaState>(() =>
    createInitialRoomMetaState(initialRoomName),
  );
  const [connectionState, setConnectionState] = useState<RoomConnectionState>("disconnected");
  const [micEnabled, setMicEnabled] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [roomError, setRoomError] = useState("");
  const [sendingText, setSendingText] = useState(false);
  const [endingRoom, setEndingRoom] = useState(false);
  const [analysisTogglePending, setAnalysisTogglePending] = useState(false);
  const [speakerMode, setSpeakerMode] = useState<RoomSpeakerMode>("self");
  const [speakerSwitchPending, setSpeakerSwitchPending] = useState(false);
  const [transcriptionState, setTranscriptionState] = useState<TranscriptionState>("idle");
  const [voiceCallStarting, setVoiceCallStarting] = useState(false);
  const [hasAutoConnectAttempted, setHasAutoConnectAttempted] = useState(false);

  const upsertMessages = useCallback((incoming: ChatMessage[]) => {
    if (incoming.length === 0) {
      return;
    }

    setMessages((current) => {
      const merged = mergeMessages(current, incoming);
      const latest = merged[merged.length - 1];
      latestMessageCreatedAtRef.current = latest ? latest.createdAt : null;
      return merged;
    });
  }, []);

  const clearPendingTranscriptionAttachmentWaiter = useCallback((error?: Error) => {
    const waiter = transcriptionAttachmentWaiterRef.current;
    if (!waiter) {
      return;
    }

    window.clearTimeout(waiter.timeoutId);
    transcriptionAttachmentWaiterRef.current = null;
    if (error) {
      waiter.reject(error);
      return;
    }
    waiter.resolve();
  }, []);

  const createInterruptedTranscriptionStartError = useCallback(
    () => new Error(t("上一次转录启动已被中断。", "A previous transcription start was interrupted.")),
    [t],
  );

  const resetTranscriptionAttachmentState = useCallback(
    (error?: Error) => {
      attachedTranscriptionParticipantsRef.current.clear();
      clearPendingTranscriptionAttachmentWaiter(
        error ?? createInterruptedTranscriptionStartError(),
      );
    },
    [clearPendingTranscriptionAttachmentWaiter, createInterruptedTranscriptionStartError],
  );

  const markParticipantTranscriptionAttached = useCallback(
    (participantIdentity: string, trackSid: string | null) => {
      attachedTranscriptionParticipantsRef.current.set(participantIdentity, trackSid);
      if (
        transcriptionAttachmentWaiterRef.current?.participantIdentity === participantIdentity &&
        (transcriptionAttachmentWaiterRef.current.expectedTrackSid === null ||
          transcriptionAttachmentWaiterRef.current.expectedTrackSid === trackSid)
      ) {
        clearPendingTranscriptionAttachmentWaiter();
      }
    },
    [clearPendingTranscriptionAttachmentWaiter],
  );

  const markParticipantTranscriptionDetached = useCallback(
    (participantIdentity: string, trackSid: string | null) => {
      const attachedTrackSid =
        attachedTranscriptionParticipantsRef.current.get(participantIdentity);
      if (attachedTrackSid === undefined) {
        return;
      }

      if (trackSid !== null && attachedTrackSid !== null && attachedTrackSid !== trackSid) {
        return;
      }

      attachedTranscriptionParticipantsRef.current.delete(participantIdentity);
    },
    [],
  );

  const waitForParticipantTranscriptionAttachment = useCallback(
    (participantIdentity: string, expectedTrackSid: string | null, timeoutMs: number) =>
      new Promise<void>((resolve, reject) => {
        const attachedTrackSid =
          attachedTranscriptionParticipantsRef.current.get(participantIdentity);
        if (
          attachedTrackSid !== undefined &&
          (expectedTrackSid === null || attachedTrackSid === expectedTrackSid)
        ) {
          resolve();
          return;
        }

        clearPendingTranscriptionAttachmentWaiter(createInterruptedTranscriptionStartError());

        const timeoutId = window.setTimeout(() => {
          if (transcriptionAttachmentWaiterRef.current?.participantIdentity !== participantIdentity) {
            return;
          }
          transcriptionAttachmentWaiterRef.current = null;
          reject(
            new Error(
              t(
                "转录引擎没有及时附着到当前麦克风，请重试。",
                "Transcription did not attach to the active microphone in time. Please retry.",
              ),
            ),
          );
        }, timeoutMs);

        transcriptionAttachmentWaiterRef.current = {
          participantIdentity,
          expectedTrackSid,
          resolve,
          reject,
          timeoutId,
        };
      }),
    [clearPendingTranscriptionAttachmentWaiter, createInterruptedTranscriptionStartError, t],
  );

  const releaseVoiceRuntimeIfIdle = useCallback(
    async (options?: { keepalive?: boolean }) => {
      const participantIdentity = participantIdentityRef.current.trim();
      if (!participantIdentity) {
        return;
      }

      try {
        await fetch(`/api/rooms/${encodeURIComponent(roomId)}/voice`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            participantIdentity,
          }),
          keepalive: options?.keepalive,
        });
      } catch {
        // Ignore cleanup failures; retry happens on the next lifecycle transition.
      }
    },
    [roomId],
  );

  const clearConnectionIdleTimer = useCallback(() => {
    if (inactivityTimerRef.current !== null) {
      window.clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = null;
    }
  }, []);

  const disableLocalMicrophone = useCallback(async (room?: Room | null) => {
    const targetRoom = room ?? roomRef.current;
    if (!targetRoom) {
      return;
    }

    micEnabledRef.current = false;
    setMicEnabled(false);

    await targetRoom.localParticipant.setMicrophoneEnabled(false);

    const microphoneTracks = [...targetRoom.localParticipant.audioTrackPublications.values()]
      .filter((publication) => publication.source === Track.Source.Microphone)
      .map((publication) => publication.track)
      .filter((track): track is NonNullable<typeof track> => Boolean(track));

    await Promise.allSettled(
      microphoneTracks.map(async (track) => {
        await targetRoom.localParticipant.unpublishTrack(track, true).catch(() => undefined);
        track.stop();
      }),
    );
  }, []);

  const syncVoiceSessionState = useCallback((room?: Room | null) => {
    const targetRoom = room ?? roomRef.current;
    const voiceProvider = voiceProviderRef.current;

    if (!targetRoom) {
      setMicEnabled(false);
      setTranscriptionState(getIdleTranscriptionState(voiceProvider));
      return;
    }

    const localVoiceActive = hasPublishedMicrophoneTrack(targetRoom.localParticipant);
    const remoteVoiceActive = [...targetRoom.remoteParticipants.values()].some((participant) =>
      hasPublishedMicrophoneTrack(participant),
    );
    const hasActiveVoiceSession = localVoiceActive || remoteVoiceActive;
    const localMicrophoneTrackSid = getPublishedMicrophoneTrackSid(targetRoom.localParticipant);
    const localParticipantIdentity = participantIdentityRef.current.trim();
    const localTranscriptionAttached =
      Boolean(localParticipantIdentity) &&
      Boolean(localMicrophoneTrackSid) &&
      attachedTranscriptionParticipantsRef.current.get(localParticipantIdentity) ===
        localMicrophoneTrackSid;
    const roomTranscriptionReady = attachedTranscriptionParticipantsRef.current.size > 0;

    setMicEnabled(localVoiceActive);
    if (!voiceProvider.transcriberEnabled || !voiceProvider.transcription.ready) {
      setTranscriptionState("disabled");
      return;
    }

    if (voiceCallStartingRef.current) {
      setTranscriptionState(localVoiceActive && localTranscriptionAttached ? "ready" : "starting");
      return;
    }

    if (!hasActiveVoiceSession) {
      setTranscriptionState("idle");
      return;
    }

    setTranscriptionState(
      localVoiceActive
        ? localTranscriptionAttached
          ? "ready"
          : "starting"
        : roomTranscriptionReady
          ? "ready"
          : "starting",
    );
  }, [attachedTranscriptionParticipantsRef]);

  const disconnectRoom = useCallback(
    (options?: { updateState?: boolean }) => {
      const updateState = options?.updateState ?? true;

      clearConnectionIdleTimer();
      const activeRoom = roomRef.current;
      roomRef.current = null;
      participantIdentityRef.current = "";
      voiceCallStartingRef.current = false;
      setVoiceCallStarting(false);
      resetTranscriptionAttachmentState();
      void disableLocalMicrophone(activeRoom).catch(() => undefined);
      activeRoom?.disconnect();

      if (audioContainerRef.current) {
        audioContainerRef.current.innerHTML = "";
      }

      if (!updateState) {
        return;
      }

      setConnectionState("disconnected");
      setMicEnabled(false);
      setTranscriptionState(getIdleTranscriptionState(voiceProviderRef.current));
    },
    [clearConnectionIdleTimer, disableLocalMicrophone, resetTranscriptionAttachmentState],
  );

  const armConnectionIdleTimer = useCallback(() => {
    clearConnectionIdleTimer();

    if (!roomRef.current || roomMeta.status === "ENDED") {
      return;
    }

    inactivityTimerRef.current = window.setTimeout(() => {
      setRoomError(
        t(
          "3分钟未发言，房间连接已断开，请重新连接。",
          "Disconnected after 3 minutes of inactivity. Reconnect to continue.",
        ),
      );
      if (micEnabledRef.current) {
        void releaseVoiceRuntimeIfIdle();
      }
      disconnectRoom();
    }, ROOM_CONNECTION_IDLE_TIMEOUT_MS);
  }, [clearConnectionIdleTimer, disconnectRoom, releaseVoiceRuntimeIfIdle, roomMeta.status, t]);

  const fetchRoomMeta = useCallback(async () => {
    const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/meta`, {
      cache: "no-store",
    });
    const payload = (await response.json()) as RoomMetaResponse;
    if (!response.ok) {
      throw new Error(payload.error ?? t("加载房间元数据失败", "Failed to load room metadata"));
    }

    setRoomMeta({
      roomName: payload.room.roomName,
      status: payload.room.status,
      analysisEnabled: payload.room.analysisEnabled,
      endedAt: payload.room.endedAt,
      isCreator: payload.room.isCreator,
      ownerPresence: payload.room.ownerPresence,
      providers: payload.providers,
      features: payload.features,
    });
  }, [roomId, t]);

  const fetchMessages = useCallback(
    async (since?: string | null) => {
      const endpoint = new URL(
        `/api/rooms/${encodeURIComponent(roomId)}/messages`,
        window.location.origin,
      );
      if (since) {
        endpoint.searchParams.set("since", since);
      }

      const response = await fetch(endpoint.toString(), { cache: "no-store" });
      const payload = (await response.json()) as MessagesResponse;
      if (!response.ok) {
        throw new Error(payload.error ?? t("获取消息失败", "Failed to fetch messages"));
      }

      upsertMessages(payload.messages);
    },
    [roomId, t, upsertMessages],
  );

  const waitForTranscriberParticipantConnected = useCallback(
    (room: Room, timeoutMs: number) =>
      new Promise<void>((resolve, reject) => {
        if (hasConnectedTranscriberParticipant(room)) {
          resolve();
          return;
        }

        const cleanup = () => {
          window.clearTimeout(timeoutId);
          room.off(RoomEvent.ParticipantConnected, handleParticipantConnected);
          room.off(RoomEvent.Disconnected, handleRoomDisconnected);
        };

        const timeoutId = window.setTimeout(() => {
          cleanup();
          reject(
            new Error(
              t(
                "转录引擎没有及时加入房间，请重试。",
                "The transcriber did not join the room in time. Please retry.",
              ),
            ),
          );
        }, timeoutMs);

        const handleParticipantConnected = () => {
          if (!hasConnectedTranscriberParticipant(room)) {
            return;
          }

          cleanup();
          resolve();
        };

        const handleRoomDisconnected = () => {
          cleanup();
          reject(
            new Error(
              t(
                "启动转录时房间连接中断。",
                "The room disconnected while starting transcription.",
              ),
            ),
          );
        };

        room.on(RoomEvent.ParticipantConnected, handleParticipantConnected);
        room.on(RoomEvent.Disconnected, handleRoomDisconnected);
      }),
    [t],
  );

  const connectRoom = useCallback(async () => {
    const ownerActive = roomMeta.isCreator || roomMeta.ownerPresence.active;
    if (
      roomRef.current ||
      connectionState !== "disconnected" ||
      roomMeta.status === "ENDED" ||
      !ownerActive
    ) {
      return;
    }

    setRoomError("");
    setConnectionState("connecting");
    resetTranscriptionAttachmentState();
    let room: Room | null = null;

    try {
      const tokenRes = await fetch("/api/livekit/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomId,
          connectionMode: "data",
          speakerMode: speakerModeRef.current,
        }),
      });
      const tokenPayload = (await tokenRes.json()) as TokenResponse;
      if (!tokenRes.ok) {
        throw new Error(tokenPayload.error ?? t("获取 LiveKit Token 失败", "Failed to fetch LiveKit token"));
      }

      voiceProviderRef.current = tokenPayload.providers.voice;
      setRoomMeta((current) => ({
        ...current,
        providers: tokenPayload.providers,
      }));

      room = new Room({
        adaptiveStream: true,
        dynacast: true,
      });

      room.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind !== Track.Kind.Audio || !audioContainerRef.current) {
          return;
        }

        const element = track.attach();
        element.autoplay = true;
        audioContainerRef.current.appendChild(element);
      });

      room.on(RoomEvent.TrackUnsubscribed, (track) => {
        if (track.kind !== Track.Kind.Audio) {
          return;
        }
        track.detach().forEach((element) => element.remove());
      });

      room.on(RoomEvent.Disconnected, () => {
        if (roomRef.current !== room) {
          return;
        }

        if (micEnabledRef.current) {
          void releaseVoiceRuntimeIfIdle();
        }
        void fetchRoomMeta().catch(() => undefined);
        disconnectRoom();
      });
      room.on(RoomEvent.ParticipantConnected, () => {
        if (roomRef.current === room) {
          syncVoiceSessionState(room);
        }
      });
      room.on(RoomEvent.ParticipantDisconnected, () => {
        if (roomRef.current === room) {
          syncVoiceSessionState(room);
        }
      });
      room.on(RoomEvent.TrackPublished, () => {
        if (roomRef.current === room) {
          syncVoiceSessionState(room);
        }
      });
      room.on(RoomEvent.TrackUnpublished, () => {
        if (roomRef.current === room) {
          syncVoiceSessionState(room);
        }
      });
      room.on(RoomEvent.TrackMuted, () => {
        if (roomRef.current === room) {
          syncVoiceSessionState(room);
        }
      });
      room.on(RoomEvent.TrackUnmuted, () => {
        if (roomRef.current === room) {
          syncVoiceSessionState(room);
        }
      });
      room.on(RoomEvent.LocalTrackPublished, () => {
        if (roomRef.current === room) {
          syncVoiceSessionState(room);
        }
      });
      room.on(RoomEvent.LocalTrackUnpublished, () => {
        if (roomRef.current === room) {
          syncVoiceSessionState(room);
        }
      });
      room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        if (roomRef.current !== room) {
          return;
        }

        if (speakers.some((participant) => participant.isLocal)) {
          armConnectionIdleTimer();
        }
      });
      room.on(RoomEvent.MediaDevicesError, (error) => {
        if (roomRef.current !== room) {
          return;
        }
        setRoomError(error instanceof Error ? error.message : t("麦克风设备不可用", "Microphone device error"));
      });
      room.on(RoomEvent.DataReceived, (payload, _participant, _kind, topic) => {
        if (topic === LIVEKIT_TRANSCRIPTION_STATUS_TOPIC) {
          const event = decodeLivekitTranscriptionStatusEvent(payload);
          if (!event || event.roomId !== roomId) {
            return;
          }

          if (event.status === "attached") {
            markParticipantTranscriptionAttached(event.participantIdentity, event.trackSid);
          } else {
            markParticipantTranscriptionDetached(event.participantIdentity, event.trackSid);
          }

          if (roomRef.current === room) {
            syncVoiceSessionState(room);
          }
          return;
        }

        if (topic !== LIVEKIT_CHAT_MESSAGE_TOPIC) {
          return;
        }

        const event = decodeLivekitChatMessageEvent(payload);
        if (!event || event.roomId !== roomId) {
          return;
        }

        upsertMessages([event.message]);
        if (event.message.type === "transcript" && roomRef.current === room) {
          if (
            event.message.participantId &&
            event.message.participantId !== participantIdentityRef.current.trim()
          ) {
            markParticipantTranscriptionAttached(event.message.participantId, null);
          }
          syncVoiceSessionState(room);
        }
      });

      await room.connect(tokenPayload.livekitUrl, tokenPayload.token);
      await room.localParticipant.setCameraEnabled(false);
      await room.localParticipant.setMicrophoneEnabled(false);

      roomRef.current = room;
      participantIdentityRef.current = tokenPayload.identity;
      setConnectionState("connected");
      syncVoiceSessionState(room);
      armConnectionIdleTimer();
      void fetchMessages(latestMessageCreatedAtRef.current).catch(() => undefined);
    } catch (error) {
      room?.disconnect();
      pendingVoiceRestartAfterSpeakerSwitchRef.current = false;
      setSpeakerSwitchPending(false);
      setRoomError(error instanceof Error ? error.message : t("连接房间失败", "Failed to connect room"));
      disconnectRoom();
    }
  }, [
    armConnectionIdleTimer,
    connectionState,
    disconnectRoom,
    fetchMessages,
    fetchRoomMeta,
    latestMessageCreatedAtRef,
    markParticipantTranscriptionAttached,
    markParticipantTranscriptionDetached,
    releaseVoiceRuntimeIfIdle,
    resetTranscriptionAttachmentState,
    roomId,
    roomMeta.isCreator,
    roomMeta.ownerPresence.active,
    roomMeta.status,
    syncVoiceSessionState,
    t,
    upsertMessages,
  ]);

  const ensureVoiceRuntime = useCallback(async (room: Room) => {
    const tokenRes = await fetch("/api/livekit/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roomId,
        connectionMode: "voice",
        speakerMode: speakerModeRef.current,
      }),
    });
    const tokenPayload = (await tokenRes.json()) as TokenResponse;
    if (!tokenRes.ok) {
      throw new Error(tokenPayload.error ?? t("启动语音通道失败", "Failed to prepare voice runtime"));
    }

    voiceProviderRef.current = tokenPayload.providers.voice;
    setRoomMeta((current) => ({
      ...current,
      providers: tokenPayload.providers,
    }));

    if (!tokenPayload.transcriberEnabled) {
      resetTranscriptionAttachmentState();
      setTranscriptionState("disabled");
      return {
        transcriberEnabled: false,
      };
    }

    resetTranscriptionAttachmentState();
    setTranscriptionState("starting");
    await waitForTranscriberParticipantConnected(room, TRANSCRIBER_PARTICIPANT_TIMEOUT_MS);
    return {
      transcriberEnabled: true,
    };
  }, [resetTranscriptionAttachmentState, roomId, t, waitForTranscriberParticipantConnected]);

  const startVoiceCall = useCallback(async () => {
    const activeRoom = roomRef.current;
    const ownerActive = roomMeta.isCreator || roomMeta.ownerPresence.active;
    if (
      !activeRoom ||
      connectionState !== "connected" ||
      roomMeta.status === "ENDED" ||
      !ownerActive ||
      micEnabled ||
      transcriptionState === "starting"
    ) {
      return;
    }

    const prepareMicrophoneForCall = prepareMicrophoneForCallRef.current;
    if (!prepareMicrophoneForCall) {
      setRoomError(t("麦克风准备尚未就绪。", "Microphone setup is not ready."));
      return;
    }

    setRoomError("");
    setTranscriptionState("starting");
    voiceCallStartingRef.current = true;
    setVoiceCallStarting(true);
    resetTranscriptionAttachmentState();
    let shouldReleaseVoiceRuntime = false;
    let microphoneEnabledDuringAttempt = false;

    try {
      const preparedMicId = await prepareMicrophoneForCall();
      shouldReleaseVoiceRuntime = true;
      const runtimeState = await ensureVoiceRuntime(activeRoom);
      await activeRoom.switchActiveDevice("audioinput", preparedMicId);

      await activeRoom.localParticipant.setMicrophoneEnabled(true);
      microphoneEnabledDuringAttempt = true;

      if (runtimeState.transcriberEnabled) {
        const localParticipantIdentity =
          participantIdentityRef.current.trim() || activeRoom.localParticipant.identity.trim();
        if (!localParticipantIdentity) {
          throw new Error(
            t(
              "无法确定当前参与者身份，无法验证转录状态。",
              "Could not determine the current participant identity to verify transcription readiness.",
            ),
          );
        }

        const localMicrophoneTrackSid = getPublishedMicrophoneTrackSid(activeRoom.localParticipant);
        if (!localMicrophoneTrackSid) {
          throw new Error(
            t(
              "当前麦克风轨道未能成功发布，无法启动转录。",
              "The microphone track did not publish successfully, so transcription could not start.",
            ),
          );
        }

        await waitForParticipantTranscriptionAttachment(
          localParticipantIdentity,
          localMicrophoneTrackSid,
          TRANSCRIPTION_ATTACHMENT_TIMEOUT_MS,
        );
      }

      if (roomRef.current === activeRoom) {
        syncVoiceSessionState(activeRoom);
        armConnectionIdleTimer();
      }
    } catch (error) {
      resetTranscriptionAttachmentState(
        error instanceof Error ? error : createInterruptedTranscriptionStartError(),
      );
      if (microphoneEnabledDuringAttempt || hasPublishedMicrophoneTrack(activeRoom.localParticipant)) {
        await disableLocalMicrophone(activeRoom).catch(() => undefined);
      }
      if (roomRef.current === activeRoom) {
        syncVoiceSessionState(activeRoom);
        armConnectionIdleTimer();
      }
      if (shouldReleaseVoiceRuntime) {
        await releaseVoiceRuntimeIfIdle().catch(() => undefined);
      }
      setTranscriptionState(getIdleTranscriptionState(voiceProviderRef.current));
      setRoomError(error instanceof Error ? error.message : t("开启通话失败", "Failed to start call"));
    } finally {
      voiceCallStartingRef.current = false;
      setVoiceCallStarting(false);
      if (roomRef.current === activeRoom) {
        syncVoiceSessionState(activeRoom);
      }
    }
  }, [
    armConnectionIdleTimer,
    connectionState,
    createInterruptedTranscriptionStartError,
    disableLocalMicrophone,
    ensureVoiceRuntime,
    micEnabled,
    prepareMicrophoneForCallRef,
    releaseVoiceRuntimeIfIdle,
    resetTranscriptionAttachmentState,
    roomMeta.isCreator,
    roomMeta.ownerPresence.active,
    roomMeta.status,
    syncVoiceSessionState,
    t,
    transcriptionState,
    waitForParticipantTranscriptionAttachment,
  ]);

  const leaveVoiceCall = useCallback(async () => {
    const activeRoom = roomRef.current;
    if (!activeRoom || connectionState !== "connected" || !micEnabled) {
      return;
    }

    setRoomError("");
    try {
      voiceCallStartingRef.current = false;
      setVoiceCallStarting(false);
      resetTranscriptionAttachmentState();
      await disableLocalMicrophone(activeRoom);
      if (roomRef.current === activeRoom) {
        syncVoiceSessionState(activeRoom);
        armConnectionIdleTimer();
      }
      await releaseVoiceRuntimeIfIdle();
    } catch (error) {
      setRoomError(error instanceof Error ? error.message : t("退出通话失败", "Failed to leave call"));
    }
  }, [
    armConnectionIdleTimer,
    connectionState,
    disableLocalMicrophone,
    micEnabled,
    releaseVoiceRuntimeIfIdle,
    resetTranscriptionAttachmentState,
    syncVoiceSessionState,
    t,
  ]);

  const switchSpeakerMode = useCallback(async () => {
    if (
      !roomMeta.features.speakerSwitchEnabled ||
      speakerSwitchPending ||
      roomMeta.status === "ENDED"
    ) {
      return;
    }

    const nextSpeakerMode: RoomSpeakerMode = speakerModeRef.current === "self" ? "bot" : "self";
    const shouldReconnect = Boolean(roomRef.current) || connectionState !== "disconnected";
    const shouldResumeVoice = micEnabledRef.current;

    setRoomError("");
    setSpeakerMode(nextSpeakerMode);

    if (!shouldReconnect) {
      return;
    }

    setSpeakerSwitchPending(true);
    pendingVoiceRestartAfterSpeakerSwitchRef.current = shouldResumeVoice;

    if (shouldResumeVoice && roomRef.current) {
      try {
        voiceCallStartingRef.current = false;
        setVoiceCallStarting(false);
        resetTranscriptionAttachmentState();
        await disableLocalMicrophone(roomRef.current);
        await releaseVoiceRuntimeIfIdle();
      } catch {
        // Best-effort cleanup before reconnecting as the other speaker.
      }
    }

    setHasAutoConnectAttempted(false);
    disconnectRoom();
  }, [
    connectionState,
    disableLocalMicrophone,
    disconnectRoom,
    releaseVoiceRuntimeIfIdle,
    resetTranscriptionAttachmentState,
    roomMeta.features.speakerSwitchEnabled,
    roomMeta.status,
    speakerSwitchPending,
  ]);

  const toggleRealtimeAnalysis = useCallback(async () => {
    if (!roomMeta.isCreator || analysisTogglePending || roomMeta.status === "ENDED") {
      return;
    }

    setAnalysisTogglePending(true);
    setRoomError("");
    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/analysis`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: !roomMeta.analysisEnabled,
        }),
      });
      const payload = (await response.json()) as {
        room?: { analysisEnabled: boolean };
        error?: string;
      };
      if (!response.ok || !payload.room) {
        throw new Error(payload.error ?? t("更新分析开关失败", "Failed to update analysis toggle"));
      }
      const nextRoom = payload.room;

      setRoomMeta((current) => ({
        ...current,
        analysisEnabled: nextRoom.analysisEnabled,
      }));
    } catch (error) {
      setRoomError(
        error instanceof Error ? error.message : t("更新分析开关失败", "Failed to update analysis toggle"),
      );
    } finally {
      setAnalysisTogglePending(false);
    }
  }, [analysisTogglePending, roomId, roomMeta.analysisEnabled, roomMeta.isCreator, roomMeta.status, t]);

  const endConversation = useCallback(async () => {
    if (!roomMeta.isCreator || roomMeta.status === "ENDED") {
      return;
    }

    setEndingRoom(true);
    setRoomError("");
    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/end`, {
        method: "POST",
      });
      const payload = (await response.json()) as {
        room?: { status: "ACTIVE" | "ENDED"; endedAt: string | null };
        error?: string;
      };
      if (!response.ok || !payload.room) {
        throw new Error(payload.error ?? t("结束房间失败", "Failed to end room"));
      }
      const nextRoom = payload.room;

      setRoomMeta((current) => ({
        ...current,
        status: nextRoom.status,
        endedAt: nextRoom.endedAt,
      }));
      voiceCallStartingRef.current = false;
      setVoiceCallStarting(false);
      resetTranscriptionAttachmentState();
      await disableLocalMicrophone(roomRef.current).catch(() => undefined);
      disconnectRoom();
      void fetchMessages(latestMessageCreatedAtRef.current).catch(() => undefined);
    } catch (error) {
      setRoomError(error instanceof Error ? error.message : t("结束房间失败", "Failed to end room"));
    } finally {
      setEndingRoom(false);
    }
  }, [
    disableLocalMicrophone,
    disconnectRoom,
    fetchMessages,
    resetTranscriptionAttachmentState,
    roomId,
    roomMeta.isCreator,
    roomMeta.status,
    t,
  ]);

  const sendTextMessage = useCallback(
    async (rawContent: string) => {
      const ownerActive = roomMeta.isCreator || roomMeta.ownerPresence.active;
      if (roomMeta.status === "ENDED" || !ownerActive) {
        if (!ownerActive) {
          setRoomError(getOwnerOfflineError(language));
        }
        return false;
      }

      const content = rawContent.trim();
      if (!content) {
        return false;
      }

      setSendingText(true);
      try {
        const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content,
            speakerMode: speakerModeRef.current,
          }),
        });
        const payload = (await response.json()) as { message?: ChatMessage; error?: string };
        if (!response.ok || !payload.message) {
          throw new Error(payload.error ?? t("发送消息失败", "Failed to send message"));
        }

        upsertMessages([payload.message]);
        armConnectionIdleTimer();
        return true;
      } catch (error) {
        setRoomError(error instanceof Error ? error.message : t("发送消息失败", "Failed to send message"));
        return false;
      } finally {
        setSendingText(false);
      }
    },
    [
      armConnectionIdleTimer,
      language,
      roomId,
      roomMeta.isCreator,
      roomMeta.ownerPresence.active,
      roomMeta.status,
      t,
      upsertMessages,
    ],
  );

  useEffect(() => {
    setHasAutoConnectAttempted(false);
    latestMessageCreatedAtRef.current = null;
    setMessages([]);
    setRoomError("");
    void Promise.all([fetchRoomMeta(), fetchMessages(null)]).catch((error) => {
      setRoomError(error instanceof Error ? error.message : t("加载房间数据失败", "Failed to load room data"));
    });
  }, [fetchMessages, fetchRoomMeta, t]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void fetchRoomMeta().catch(() => undefined);
    }, ROOM_META_POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [fetchRoomMeta]);

  useEffect(() => {
    micEnabledRef.current = micEnabled;
  }, [micEnabled]);

  useEffect(() => {
    speakerModeRef.current = speakerMode;
  }, [speakerMode]);

  useEffect(() => {
    voiceProviderRef.current = roomMeta.providers.voice;
    if (roomRef.current) {
      if (transcriptionState === "starting") {
        return;
      }
      syncVoiceSessionState(roomRef.current);
      return;
    }

    setTranscriptionState(getIdleTranscriptionState(roomMeta.providers.voice));
  }, [roomMeta.providers.voice, syncVoiceSessionState, transcriptionState]);

  useEffect(() => {
    if (roomMeta.status === "ENDED" && connectionState !== "disconnected") {
      disconnectRoom();
    }
  }, [connectionState, disconnectRoom, roomMeta.status]);

  useEffect(() => {
    if (!speakerSwitchPending || connectionState !== "connected") {
      return;
    }

    if (!pendingVoiceRestartAfterSpeakerSwitchRef.current) {
      setSpeakerSwitchPending(false);
      return;
    }

    pendingVoiceRestartAfterSpeakerSwitchRef.current = false;
    void startVoiceCall().finally(() => {
      setSpeakerSwitchPending(false);
    });
  }, [connectionState, speakerSwitchPending, startVoiceCall]);

  useEffect(() => {
    if (!speakerSwitchPending) {
      return;
    }

    const ownerActive = roomMeta.isCreator || roomMeta.ownerPresence.active;
    if (roomMeta.status !== "ENDED" && ownerActive) {
      return;
    }

    pendingVoiceRestartAfterSpeakerSwitchRef.current = false;
    setSpeakerSwitchPending(false);
  }, [
    roomMeta.isCreator,
    roomMeta.ownerPresence.active,
    roomMeta.status,
    speakerSwitchPending,
  ]);

  useEffect(() => {
    const ownerActive = roomMeta.isCreator || roomMeta.ownerPresence.active;
    if (ownerActive && !previousOwnerActiveRef.current) {
      setHasAutoConnectAttempted(false);
    }
    previousOwnerActiveRef.current = ownerActive;
  }, [roomMeta.isCreator, roomMeta.ownerPresence.active]);

  useEffect(() => {
    if (hasAutoConnectAttempted) {
      return;
    }
    if (roomMeta.status === "ENDED") {
      return;
    }
    if (!roomMeta.isCreator && !roomMeta.ownerPresence.active) {
      return;
    }
    if (connectionState !== "disconnected") {
      return;
    }

    setHasAutoConnectAttempted(true);
    void connectRoom();
  }, [
    connectRoom,
    connectionState,
    hasAutoConnectAttempted,
    roomMeta.isCreator,
    roomMeta.ownerPresence.active,
    roomMeta.status,
  ]);

  useEffect(() => {
    if (roomMeta.status === "ENDED" || roomMeta.isCreator || roomMeta.ownerPresence.active) {
      return;
    }

    setRoomError(getOwnerOfflineError(language));
    if (connectionState !== "disconnected") {
      if (micEnabledRef.current) {
        void releaseVoiceRuntimeIfIdle();
      }
      disconnectRoom();
    }
  }, [
    connectionState,
    disconnectRoom,
    language,
    releaseVoiceRuntimeIfIdle,
    roomMeta.isCreator,
    roomMeta.ownerPresence.active,
    roomMeta.status,
  ]);

  useEffect(() => {
    const inferredRoomName = findLatestRoomNameFromMessages(messages);
    if (!inferredRoomName) {
      return;
    }

    setRoomMeta((current) =>
      current.roomName === inferredRoomName
        ? current
        : {
            ...current,
            roomName: inferredRoomName,
          },
    );
  }, [messages]);

  useEffect(() => {
    return () => {
      if (micEnabledRef.current) {
        void releaseVoiceRuntimeIfIdle();
      }
      voiceCallStartingRef.current = false;
      setVoiceCallStarting(false);
      disconnectRoom({ updateState: false });
    };
  }, [disconnectRoom, releaseVoiceRuntimeIfIdle]);

  useEffect(() => {
    const handlePageHide = () => {
      if (micEnabledRef.current) {
        void releaseVoiceRuntimeIfIdle({ keepalive: true });
      }
      voiceCallStartingRef.current = false;
      setVoiceCallStarting(false);
      disconnectRoom({ updateState: false });
    };

    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [disconnectRoom, releaseVoiceRuntimeIfIdle]);

  useEffect(() => {
    if (warmupRequestedRef.current) {
      return;
    }
    if (roomMeta.status === "ENDED") {
      return;
    }
    if (!roomMeta.isCreator && !roomMeta.ownerPresence.active) {
      return;
    }

    warmupRequestedRef.current = true;
    void fetch(`/api/rooms/${encodeURIComponent(roomId)}/warmup`, {
      method: "POST",
    }).catch(() => undefined);
  }, [roomId, roomMeta.isCreator, roomMeta.ownerPresence.active, roomMeta.status]);

  return {
    analysisTogglePending,
    audioContainerRef,
    connectRoom,
    connectionState,
    endConversation,
    endingRoom,
    hasAutoConnectAttempted,
    leaveVoiceCall,
    messages,
    micEnabled,
    roomError,
    roomMeta,
    roomRef,
    sendTextMessage,
    sendingText,
    setRoomError,
    speakerMode,
    speakerSwitchPending,
    startVoiceCall,
    switchSpeakerMode,
    toggleRealtimeAnalysis,
    transcriptionState,
    voiceCallStarting,
  };
}
