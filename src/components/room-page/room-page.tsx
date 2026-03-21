"use client";

import { type FormEvent, type KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";

import { getRoomDisplayName } from "@/lib/room-name";
import { useUiLanguage } from "@/lib/use-ui-language";

import { RoomPageView } from "./room-page-view";
import {
  buildAnalysisViewState,
  type ActiveStatusTooltipState,
  type RoomPageClientProps,
} from "./room-page-support";
import { useRoomMicrophone } from "./use-room-microphone";
import { useRoomSession } from "./use-room-session";

export default function RoomPageClient({
  roomId,
  initialRoomName,
  userId,
  username,
}: RoomPageClientProps) {
  const { language } = useUiLanguage();
  const isZh = language === "zh";
  const t = useCallback((zh: string, en: string) => (isZh ? zh : en), [isZh]);

  const prepareMicrophoneForCallRef = useRef<(() => Promise<string>) | null>(null);
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollAnchorRef = useRef<HTMLDivElement>(null);

  const [chatInput, setChatInput] = useState("");
  const [rawMessageId, setRawMessageId] = useState<string | null>(null);
  const [showEndRoomConfirm, setShowEndRoomConfirm] = useState(false);
  const [showSwitchConfirm, setShowSwitchConfirm] = useState(false);
  const [hasConfirmedSwitchOnce, setHasConfirmedSwitchOnce] = useState(false);
  const [showMobileAnalysis, setShowMobileAnalysis] = useState(false);
  const [copied, setCopied] = useState(false);
  const [activeStatusTooltip, setActiveStatusTooltip] = useState<ActiveStatusTooltipState>(null);

  const {
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
  } = useRoomSession({
    initialRoomName,
    language,
    prepareMicrophoneForCallRef,
    roomId,
    t,
  });

  const {
    closeMicSelector,
    micDevices,
    micSelectorOpen,
    micVolume,
    prepareMicrophoneForCall,
    selectedMicId,
    selectMic,
    toggleMicSelector,
  } = useRoomMicrophone({
    connectionState,
    micEnabled,
    onError: setRoomError,
    roomRef,
    t,
  });

  useEffect(() => {
    prepareMicrophoneForCallRef.current = prepareMicrophoneForCall;
  }, [prepareMicrophoneForCall]);

  useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const input = chatInputRef.current;
    if (!input) {
      return;
    }

    const minHeight = 64;
    const maxHeight = 168;
    input.style.height = "auto";
    const nextHeight = Math.max(input.scrollHeight, minHeight);
    input.style.height = `${Math.min(nextHeight, maxHeight)}px`;
    input.style.overflowY = nextHeight > maxHeight ? "auto" : "hidden";
  }, [chatInput]);

  const copyRoomId = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(roomId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore clipboard failures.
    }
  }, [roomId]);

  const submitTextMessage = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const didSend = await sendTextMessage(chatInput);
      if (didSend) {
        setChatInput("");
      }
    },
    [chatInput, sendTextMessage],
  );

  const handleChatInputKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
        return;
      }

      event.preventDefault();
      if (
        sendingText ||
        roomMeta.status === "ENDED" ||
        (!roomMeta.isCreator && !roomMeta.ownerPresence.active) ||
        !roomMeta.currentUserCanParticipate
      ) {
        return;
      }

      event.currentTarget.form?.requestSubmit();
    },
    [
      roomMeta.currentUserCanParticipate,
      roomMeta.isCreator,
      roomMeta.ownerPresence.active,
      roomMeta.status,
      sendingText,
    ],
  );

  const isEnded = roomMeta.status === "ENDED";
  const ownerActive = roomMeta.isCreator || roomMeta.ownerPresence.active;
  const canConnectRoom = !isEnded && ownerActive;
  const roomInteractionBlocked = isEnded || !ownerActive || !roomMeta.currentUserCanParticipate;
  const isAudienceReadOnly = canConnectRoom && !roomMeta.currentUserCanParticipate;
  const isInitialConnectionPending =
    connectionState === "disconnected" && !hasAutoConnectAttempted && canConnectRoom;
  const roomConnectionStatusClass = isInitialConnectionPending ? "connecting" : connectionState;
  const roomDisplayName = getRoomDisplayName(roomMeta.roomName, roomId);
  const canLeaveVoiceCall = micEnabled && !voiceCallStarting;
  const startingCallButtonLabel = t("启动中", "Starting");
  const callButtonClassName =
    canLeaveVoiceCall || voiceCallStarting ? "primary-btn" : "ghost-btn";
  const analysisViewState = buildAnalysisViewState(messages, userId);

  return (
    <RoomPageView
      activeStatusTooltip={activeStatusTooltip}
      analysisTogglePending={analysisTogglePending}
      analysisViewState={analysisViewState}
      audioContainerRef={audioContainerRef}
      callButtonClassName={callButtonClassName}
      canLeaveVoiceCall={canLeaveVoiceCall}
      chatInput={chatInput}
      chatInputRef={chatInputRef}
      canConnectRoom={canConnectRoom}
      canParticipate={roomMeta.currentUserCanParticipate}
      connectionState={connectionState}
      copied={copied}
      endingRoom={endingRoom}
      isAudienceReadOnly={isAudienceReadOnly}
      isCreator={roomMeta.isCreator}
      isEnded={isEnded}
      isInitialConnectionPending={isInitialConnectionPending}
      isZh={isZh}
      language={language}
      messages={messages}
      micDevices={micDevices}
      micEnabled={micEnabled}
      micSelectorOpen={micSelectorOpen}
      micVolume={micVolume}
      onChatInputChange={setChatInput}
      onChatInputKeyDown={handleChatInputKeyDown}
      onCloseEndRoomConfirm={() => setShowEndRoomConfirm(false)}
      onCloseMicSelector={closeMicSelector}
      onCloseMobileAnalysis={() => setShowMobileAnalysis(false)}
      onCloseSwitchConfirm={() => setShowSwitchConfirm(false)}
      onConfirmEndRoom={() => {
        setShowEndRoomConfirm(false);
        void endConversation();
      }}
      onConfirmSwitch={() => {
        setShowSwitchConfirm(false);
        setHasConfirmedSwitchOnce(true);
        void switchSpeakerMode();
      }}
      onConnectRoom={() => {
        void connectRoom();
      }}
      onCloseActiveStatusTooltip={() => setActiveStatusTooltip(null)}
      onConnectionStatusClick={() =>
        setActiveStatusTooltip(activeStatusTooltip === "connection" ? null : "connection")
      }
      onCopyRoomId={() => {
        void copyRoomId();
      }}
      onLeaveVoiceCall={() => {
        void leaveVoiceCall();
      }}
      onOpenEndRoomConfirm={() => setShowEndRoomConfirm(true)}
      onOpenMobileAnalysis={() => setShowMobileAnalysis(true)}
      onSelectMic={selectMic}
      onSpeakerSwitchAction={() => {
        if (hasConfirmedSwitchOnce) {
          void switchSpeakerMode();
          return;
        }
        setShowSwitchConfirm(true);
      }}
      onStartVoiceCall={() => {
        void startVoiceCall();
      }}
      onSubmitTextMessage={submitTextMessage}
      onToggleMicSelector={toggleMicSelector}
      onToggleRawMessage={setRawMessageId}
      onToggleRealtimeAnalysis={() => {
        void toggleRealtimeAnalysis();
      }}
      onTranscriptionStatusClick={() =>
        setActiveStatusTooltip(activeStatusTooltip === "transcription" ? null : "transcription")
      }
      overallInsights={analysisViewState.overallInsights}
      rawMessageId={rawMessageId}
      roomConnectionStatusClass={roomConnectionStatusClass}
      roomDisplayName={roomDisplayName}
      roomError={roomError}
      roomId={roomId}
      roomInteractionBlocked={roomInteractionBlocked}
      roomMeta={roomMeta}
      scores={analysisViewState.scores}
      scrollAnchorRef={scrollAnchorRef}
      selectedMicId={selectedMicId}
      sendingText={sendingText}
      showEndRoomConfirm={showEndRoomConfirm}
      showMobileAnalysis={showMobileAnalysis}
      showSwitchConfirm={showSwitchConfirm}
      speakerMode={speakerMode}
      speakerSwitchEnabled={roomMeta.features.speakerSwitchEnabled}
      speakerSwitchPending={speakerSwitchPending}
      startingCallButtonLabel={startingCallButtonLabel}
      suggestions={analysisViewState.suggestions}
      t={t}
      transcriptionState={transcriptionState}
      userId={userId}
      username={username}
      voiceCallStarting={voiceCallStarting}
    />
  );
}
