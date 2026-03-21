import Link from "next/link";
import {
  type ChangeEvent,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
  useEffect,
  useRef,
} from "react";

import { type RoomSpeakerMode } from "@/lib/room-speaker";
import { type ChatMessage } from "@/lib/chat-types";
import { type UiLanguage } from "@/lib/ui-language";

import {
  formatTime,
  getAnalysisInsight,
  getAnalysisProviderDetails,
  getAnalysisProviderLabel,
  getAnalysisRoundScore,
  getVoiceProviderDetails,
  getVoiceProviderLabel,
  isOwnMessage,
  parseRealtimeAnalysisMessage,
  type ActiveStatusTooltipState,
  type AnalysisViewState,
  type RoomConnectionState,
  type RoomMetaState,
  type RoomPageTranslate,
  type TranscriptionState,
} from "./room-page-support";

type RoomPageViewProps = {
  activeStatusTooltip: ActiveStatusTooltipState;
  analysisTogglePending: boolean;
  analysisViewState: AnalysisViewState;
  audioContainerRef: RefObject<HTMLDivElement | null>;
  callButtonClassName: string;
  canLeaveVoiceCall: boolean;
  chatInput: string;
  chatInputRef: RefObject<HTMLTextAreaElement | null>;
  connectionState: RoomConnectionState;
  copied: boolean;
  currentSpeakerName: string;
  endingRoom: boolean;
  isCreator: boolean;
  isEnded: boolean;
  isInitialConnectionPending: boolean;
  isZh: boolean;
  language: UiLanguage;
  messages: ChatMessage[];
  micDevices: MediaDeviceInfo[];
  micEnabled: boolean;
  micSelectorOpen: boolean;
  micVolume: number;
  onChatInputChange: (value: string) => void;
  onChatInputKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onCloseEndRoomConfirm: () => void;
  onCloseMicSelector: () => void;
  onCloseMobileAnalysis: () => void;
  onCloseSwitchConfirm: () => void;
  onConfirmEndRoom: () => void;
  onConfirmSwitch: () => void;
  onConnectRoom: () => void;
  onCloseActiveStatusTooltip: () => void;
  onConnectionStatusClick: () => void;
  onCopyRoomId: () => void;
  onLeaveVoiceCall: () => void;
  onOpenEndRoomConfirm: () => void;
  onOpenMobileAnalysis: () => void;
  onSelectMic: (deviceId: string) => void;
  onSpeakerSwitchAction: () => void;
  onStartVoiceCall: () => void;
  onSubmitTextMessage: (event: FormEvent<HTMLFormElement>) => void;
  onToggleMicSelector: () => void;
  onToggleRawMessage: (nextId: string | null) => void;
  onToggleRealtimeAnalysis: () => void;
  onTranscriptionStatusClick: () => void;
  overallInsights: {
    own: string;
    other: string;
  };
  rawMessageId: string | null;
  roomConnectionStatusClass: string;
  roomDisplayName: string;
  roomError: string;
  roomId: string;
  roomInteractionBlocked: boolean;
  roomMeta: RoomMetaState;
  scores: {
    own: number;
    other: number;
  };
  scrollAnchorRef: RefObject<HTMLDivElement | null>;
  selectedMicId: string;
  sendingText: boolean;
  showEndRoomConfirm: boolean;
  showMobileAnalysis: boolean;
  showSpeakerIdentity: boolean;
  showSwitchConfirm: boolean;
  speakerMode: RoomSpeakerMode;
  speakerSwitchEnabled: boolean;
  speakerSwitchPending: boolean;
  startingCallButtonLabel: string;
  suggestions: {
    own: string[];
    other: string[];
  };
  t: RoomPageTranslate;
  transcriptionState: TranscriptionState;
  userId: string;
  username: string;
  voiceCallStarting: boolean;
};

type AnalysisMessageProps = {
  analysisViewState: AnalysisViewState;
  language: UiLanguage;
  message: ChatMessage;
  onToggleRawMessage: (nextId: string | null) => void;
  rawMessageId: string | null;
  t: RoomPageTranslate;
};

function AnalysisMessage({
  analysisViewState,
  language,
  message,
  onToggleRawMessage,
  rawMessageId,
  t,
}: AnalysisMessageProps) {
  try {
    const analysisView = analysisViewState.messageViews.get(message.id);
    const data = analysisView?.content ?? parseRealtimeAnalysisMessage(message);
    if (!data) {
      throw new Error("Not realtime");
    }

    const isRaw = rawMessageId === message.id;
    const ownSourceLabel = analysisView ? analysisView.ownSourceLabel : "A";
    const otherSourceLabel = analysisView ? analysisView.otherSourceLabel : "B";
    const otherRoundScore = getAnalysisRoundScore(data, otherSourceLabel);
    const ownRoundScore = getAnalysisRoundScore(data, ownSourceLabel);
    const otherCurrentRoundInsight = getAnalysisInsight(data, "currentRound", otherSourceLabel);
    const ownCurrentRoundInsight = getAnalysisInsight(data, "currentRound", ownSourceLabel);

    return (
      <div className="bubble analysis">
        {isRaw ? (
          <pre
            style={
              {
                fontSize: "0.75rem",
                overflowX: "auto",
                background: "rgba(0,0,0,0.03)",
                padding: "10px",
                borderRadius: "8px",
                color: "#000",
              } satisfies CSSProperties
            }
          >
            {JSON.stringify(data, null, 2)}
          </pre>
        ) : (
          <div className="analysis-grid">
            <div className="analysis-side-section">
              <div className="analysis-side-head">
                <div className="analysis-side-h">{t("对方", "Other Side")}</div>
                {otherRoundScore && (
                  <span className="analysis-delta-tag">
                    {otherRoundScore.delta >= 0 ? "+" : ""}
                    {otherRoundScore.delta}
                  </span>
                )}
              </div>
              <p className="analysis-insight">
                {otherCurrentRoundInsight || t("本轮无发言", "No activity this round")}
              </p>
              {otherRoundScore?.reason && (
                <span className="analysis-score-reason">{otherRoundScore.reason}</span>
              )}
            </div>

            <div className="analysis-side-section">
              <div className="analysis-side-head">
                <div className="analysis-side-h">{t("我方", "Our Side")}</div>
                {ownRoundScore && (
                  <span className="analysis-delta-tag">
                    {ownRoundScore.delta >= 0 ? "+" : ""}
                    {ownRoundScore.delta}
                  </span>
                )}
              </div>
              <p className="analysis-insight">
                {ownCurrentRoundInsight || t("本轮无发言", "No activity this round")}
              </p>
              {ownRoundScore?.reason && (
                <span className="analysis-score-reason">{ownRoundScore.reason}</span>
              )}
            </div>
          </div>
        )}

        <button
          className="raw-toggle"
          onClick={() => onToggleRawMessage(isRaw ? null : message.id)}
          type="button"
        >
          {isRaw ? t("查看精简版", "Minimal") : t("查看原文", "Raw JSON")}
        </button>
      </div>
    );
  } catch {
    return (
      <div className="bubble analysis">
        <header className="bubble-meta">
          <strong>{t("AI 分析", "AI Analysis")}</strong>
          <time dateTime={message.createdAt}>{formatTime(message.createdAt, language)}</time>
        </header>
        <p>{message.content}</p>
      </div>
    );
  }
}

function RoomSidebarPanel({
  analysisTogglePending,
  isZh,
  language,
  micDevices,
  micSelectorOpen,
  micVolume,
  onCloseMicSelector,
  onSelectMic,
  onToggleMicSelector,
  onToggleRealtimeAnalysis,
  overallInsights,
  roomMeta,
  scores,
  selectedMicId,
  suggestions,
  t,
}: Pick<
  RoomPageViewProps,
  | "analysisTogglePending"
  | "isZh"
  | "language"
  | "micDevices"
  | "micSelectorOpen"
  | "micVolume"
  | "onCloseMicSelector"
  | "onSelectMic"
  | "onToggleMicSelector"
  | "onToggleRealtimeAnalysis"
  | "overallInsights"
  | "roomMeta"
  | "scores"
  | "selectedMicId"
  | "suggestions"
  | "t"
>) {
  const selectedDevice = micDevices.find((device) => device.deviceId === selectedMicId);
  const selectedLabel = selectedDevice
    ? selectedDevice.label ||
      (isZh
        ? `麦克风 ${micDevices.indexOf(selectedDevice) + 1}`
        : `Microphone ${micDevices.indexOf(selectedDevice) + 1}`)
    : isZh
      ? "默认麦克风"
      : "Default microphone";

  return (
    <>
      <div className="sidebar-section">
        <h4>{t("实时比分", "Real-time Score")}</h4>
        <div className="score-card">
          <div className="score-box">
            <span className="label">{t("我方", "Our Side")}</span>
            <span
              className="value"
              style={{ color: scores.own >= scores.other ? "var(--primary)" : "inherit" }}
            >
              {scores.own}
            </span>
          </div>
          <div className="score-box">
            <span className="label">{t("对方", "Other Side")}</span>
            <span
              className="value"
              style={{ color: scores.other >= scores.own ? "var(--primary)" : "inherit" }}
            >
              {scores.other}
            </span>
          </div>
        </div>
      </div>

      <div className="sidebar-section">
        <h4>{t("双方观点", "Perspectives")}</h4>
        <div className="overall-insight-box">
          <div className="overall-insight-item">
            <strong>{t("我方", "Our Side")}</strong>
            <p className="analysis-insight" style={{ fontSize: "0.85rem" }}>
              {overallInsights.own || t("暂无洞察", "No insights yet")}
            </p>
          </div>
          <div style={{ height: "1px", background: "var(--line)" }} />
          <div className="overall-insight-item">
            <strong>{t("对方", "Other Side")}</strong>
            <p className="analysis-insight" style={{ fontSize: "0.85rem" }}>
              {overallInsights.other || t("暂无洞察", "No insights yet")}
            </p>
          </div>
        </div>
      </div>

      <div className="sidebar-section">
        <h4>{t("建议", "Suggestions")}</h4>
        <div className="overall-insight-box">
          <div className="overall-insight-item">
            <strong>{t("我方", "Our Side")}</strong>
            {suggestions.own.length > 0 ? (
              <div style={{ marginTop: "4px", fontSize: "0.85rem", color: "var(--muted)" }}>
                {suggestions.own.map((suggestion, index) => (
                  <p
                    key={`${suggestion}-${index}`}
                    className="analysis-insight"
                    style={{ margin: index === 0 ? 0 : "6px 0 0" }}
                  >
                    {suggestion}
                  </p>
                ))}
              </div>
            ) : (
              <p className="analysis-insight" style={{ fontSize: "0.85rem" }}>
                {t("暂无建议", "No suggestions yet")}
              </p>
            )}
          </div>
          <div style={{ height: "1px", background: "var(--line)" }} />
          <div className="overall-insight-item">
            <strong>{t("对方", "Other Side")}</strong>
            {suggestions.other.length > 0 ? (
              <div style={{ marginTop: "4px", fontSize: "0.85rem", color: "var(--muted)" }}>
                {suggestions.other.map((suggestion, index) => (
                  <p
                    key={`${suggestion}-${index}`}
                    className="analysis-insight"
                    style={{ margin: index === 0 ? 0 : "6px 0 0" }}
                  >
                    {suggestion}
                  </p>
                ))}
              </div>
            ) : (
              <p className="analysis-insight" style={{ fontSize: "0.85rem" }}>
                {t("暂无建议", "No suggestions yet")}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="sidebar-section" style={{ marginTop: "auto" }}>
        <h4>{t("服务状态", "Providers")}</h4>
        <div
          className="key-status-grid"
          style={{ fontSize: "0.75rem", gap: "8px", background: "transparent", padding: 0 }}
        >
          <div className="provider-tooltip">
            <div className="room-status provider-chip provider-chip-panel" tabIndex={0}>
              <div className="provider-chip-main">
                <span className="provider-chip-label">{t("语音与转录", "Voice & Transcription")}</span>
                <strong className="provider-chip-value">
                  {getVoiceProviderLabel(roomMeta.providers.voice, language)}
                </strong>
              </div>
            </div>
            <div className="provider-popover" role="tooltip">
              <div className="provider-popover-title">{t("语音与转录", "Voice & Transcription")}</div>
              {getVoiceProviderDetails(roomMeta.providers.voice, language).map((item) => (
                <div key={`voice-${item.label}`} className="provider-popover-row">
                  <span className="provider-popover-label">{item.label}</span>
                  <strong className="provider-popover-value">{item.value}</strong>
                </div>
              ))}
            </div>
          </div>

          <div className="mic-selector-wrap" style={{ position: "relative" }}>
            <button
              type="button"
              className="room-status provider-chip provider-chip-panel mic-selector-trigger"
              onClick={onToggleMicSelector}
              aria-expanded={micSelectorOpen}
              aria-label={isZh ? "选择麦克风" : "Select microphone"}
            >
              <span className="provider-chip-label mic-selector-label">{t("麦克风", "Microphone")}</span>
              <div className="provider-chip-main mic-selector-content">
                <strong className="provider-chip-value mic-selector-value" title={selectedLabel}>
                  {selectedLabel}
                </strong>
              </div>
              <span
                className="mic-vol-icon"
                style={{ "--mic-vol": micVolume } as CSSProperties}
                aria-hidden="true"
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              </span>
            </button>

            {micSelectorOpen && (
              <>
                <div
                  style={{ position: "fixed", inset: 0, zIndex: 98 }}
                  onClick={onCloseMicSelector}
                  aria-hidden="true"
                />
                <div className="mic-dropdown" role="listbox" aria-label={isZh ? "麦克风设备" : "Microphone devices"}>
                  <div className="mic-vol-bar-wrap">
                    <div className="mic-vol-bar-fill" style={{ width: `${Math.round(micVolume * 100)}%` }} />
                    <span className="mic-vol-label">
                      {isZh ? "实时音量" : "Level"}
                      <strong style={{ marginLeft: 6, fontVariantNumeric: "tabular-nums" }}>
                        {Math.round(micVolume * 100)}%
                      </strong>
                    </span>
                  </div>

                  <ul className="mic-device-list" role="group">
                    {micDevices.length === 0 ? (
                      <li className="mic-device-item mic-device-empty">
                        {isZh ? "未找到麦克风设备" : "No microphone found"}
                      </li>
                    ) : (
                      micDevices.map((device, index) => {
                        const label = device.label || (isZh ? `麦克风 ${index + 1}` : `Microphone ${index + 1}`);
                        const isActive = device.deviceId === selectedMicId;
                        return (
                          <li key={device.deviceId} role="option" aria-selected={isActive}>
                            <button
                              type="button"
                              className={`mic-device-item ${isActive ? "mic-device-active" : ""}`}
                              onClick={(event) => {
                                event.stopPropagation();
                                onSelectMic(device.deviceId);
                              }}
                            >
                              <span className="mic-device-check" aria-hidden="true">
                                {isActive ? (
                                  <svg
                                    width="14"
                                    height="14"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="3"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  >
                                    <polyline points="20 6 9 17 4 12" />
                                  </svg>
                                ) : null}
                              </span>
                              <span className="mic-device-label">{label}</span>
                            </button>
                          </li>
                        );
                      })
                    )}
                  </ul>
                </div>
              </>
            )}
          </div>

          <div className="provider-tooltip">
            <div className="room-status provider-chip provider-chip-panel" tabIndex={0}>
              <div className="provider-chip-main">
                <span className="provider-chip-label">{t("大模型分析", "LLM Analysis")}</span>
                <strong className="provider-chip-value">
                  {getAnalysisProviderLabel(roomMeta.providers.analysis, language)}
                </strong>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={roomMeta.analysisEnabled}
                aria-label={t("切换实时大模型分析", "Toggle realtime LLM analysis")}
                className={`provider-chip-switch ${roomMeta.analysisEnabled ? "active" : ""}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleRealtimeAnalysis();
                }}
                disabled={!roomMeta.isCreator || analysisTogglePending || roomMeta.status === "ENDED"}
              >
                <span className="provider-chip-switch-track">
                  <span className="provider-chip-switch-thumb" />
                </span>
                <span className="provider-chip-switch-text">
                  {analysisTogglePending
                    ? "..."
                    : roomMeta.analysisEnabled
                      ? t("开", "On")
                      : t("关", "Off")}
                </span>
              </button>
            </div>
            <div className="provider-popover" role="tooltip">
              <div className="provider-popover-title">{t("大模型分析", "LLM Analysis")}</div>
              {getAnalysisProviderDetails(roomMeta.providers.analysis, language).map((item) => (
                <div key={`analysis-${item.label}`} className="provider-popover-row">
                  <span className="provider-popover-label">{item.label}</span>
                  <strong className="provider-popover-value">{item.value}</strong>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export function RoomPageView({
  activeStatusTooltip,
  analysisTogglePending,
  analysisViewState,
  audioContainerRef,
  callButtonClassName,
  canLeaveVoiceCall,
  chatInput,
  chatInputRef,
  connectionState,
  copied,
  currentSpeakerName,
  endingRoom,
  isCreator,
  isEnded,
  isInitialConnectionPending,
  isZh,
  language,
  messages,
  micDevices,
  micEnabled,
  micSelectorOpen,
  micVolume,
  onChatInputChange,
  onChatInputKeyDown,
  onCloseEndRoomConfirm,
  onCloseMicSelector,
  onCloseMobileAnalysis,
  onCloseSwitchConfirm,
  onConfirmEndRoom,
  onConfirmSwitch,
  onConnectRoom,
  onCloseActiveStatusTooltip,
  onConnectionStatusClick,
  onCopyRoomId,
  onLeaveVoiceCall,
  onOpenEndRoomConfirm,
  onOpenMobileAnalysis,
  onSelectMic,
  onSpeakerSwitchAction,
  onStartVoiceCall,
  onSubmitTextMessage,
  onToggleMicSelector,
  onToggleRawMessage,
  onToggleRealtimeAnalysis,
  onTranscriptionStatusClick,
  overallInsights,
  rawMessageId,
  roomConnectionStatusClass,
  roomDisplayName,
  roomError,
  roomId,
  roomInteractionBlocked,
  roomMeta,
  scores,
  scrollAnchorRef,
  selectedMicId,
  sendingText,
  showEndRoomConfirm,
  showMobileAnalysis,
  showSpeakerIdentity,
  showSwitchConfirm,
  speakerMode,
  speakerSwitchEnabled,
  speakerSwitchPending,
  startingCallButtonLabel,
  suggestions,
  t,
  transcriptionState,
  userId,
  username,
  voiceCallStarting,
}: RoomPageViewProps) {
  const statusTooltipRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (activeStatusTooltip === null) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (statusTooltipRef.current?.contains(target)) {
        return;
      }

      onCloseActiveStatusTooltip();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [activeStatusTooltip, onCloseActiveStatusTooltip]);

  const sidebarContent = (
    <RoomSidebarPanel
      analysisTogglePending={analysisTogglePending}
      isZh={isZh}
      language={language}
      micDevices={micDevices}
      micSelectorOpen={micSelectorOpen}
      micVolume={micVolume}
      onCloseMicSelector={onCloseMicSelector}
      onSelectMic={onSelectMic}
      onToggleMicSelector={onToggleMicSelector}
      onToggleRealtimeAnalysis={onToggleRealtimeAnalysis}
      overallInsights={overallInsights}
      roomMeta={roomMeta}
      scores={scores}
      selectedMicId={selectedMicId}
      suggestions={suggestions}
      t={t}
    />
  );

  return (
    <main className="room-page">
      <section className="room-shell room-shell-chat">
        <header className="room-header">
          <div className="room-header-title">
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <h1>{roomDisplayName}</h1>

              <div
                ref={statusTooltipRef}
                style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}
              >
                <div style={{ position: "relative" }}>
                  <span className={`room-status ${roomConnectionStatusClass}`} onClick={onConnectionStatusClick}>
                    <span className="status-icon">C</span>
                    <span className="status-label-text">
                      {connectionState === "connected"
                        ? t("已连接", "Connected")
                        : connectionState === "connecting" || isInitialConnectionPending
                          ? t("连接中", "Connecting")
                          : t("断开", "Disconnected")}
                    </span>
                  </span>
                  {activeStatusTooltip === "connection" && (
                    <div className="status-tooltip">
                      {connectionState === "connected"
                        ? t("房间连接成功", "Room Connected")
                        : connectionState === "connecting" || isInitialConnectionPending
                          ? t("正在连接房间...", "Connecting to Room...")
                          : t("房间连接已断开", "Room Disconnected")}
                    </div>
                  )}
                </div>

                <div style={{ position: "relative" }}>
                  <span
                    className={`room-status transcription-status ${transcriptionState}`}
                    onClick={onTranscriptionStatusClick}
                  >
                    <span className="status-icon">T</span>
                    <span className="status-label-text">
                      {transcriptionState === "ready"
                        ? t("转录中", "Transcription On")
                        : transcriptionState === "starting"
                          ? t("启动中", "Starting")
                          : t("转录关", "Transcription Off")}
                    </span>
                  </span>
                  {activeStatusTooltip === "transcription" && (
                    <div className="status-tooltip">
                      {transcriptionState === "ready"
                        ? t("实时语音转录已开启", "Transcription Active")
                        : transcriptionState === "starting"
                          ? t("正在启动转录引擎...", "Starting Transcription...")
                          : t("语音转录未开启", "Transcription Disabled")}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="room-meta-row">
              <span className="room-header-code" onClick={onCopyRoomId} title={t("点击复制房间号", "Click to copy room ID")}> 
                {roomId}
                {copied && <span className="copy-tooltip">{t("已复制", "Copied")}</span>}
              </span>
              <span style={{ opacity: 0.5 }}>|</span>
              <span>@{username}</span>
              {showSpeakerIdentity && (
                <>
                  <span style={{ opacity: 0.5 }}>|</span>
                  <span>{currentSpeakerName}</span>
                </>
              )}
            </div>
          </div>

          <Link className="room-back-link" href="/" title={t("返回", "Back")}>
            <span className="desktop-only ghost-btn" style={{ height: "40px" }}>
              {t("返回", "Back")}
            </span>
            <span className="mobile-only-flex back-icon-btn">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
            </span>
          </Link>

          <div className="room-actions">
            <button
              type="button"
              className="ghost-btn mobile-only-flex"
              style={{ height: "40px" }}
              onClick={onOpenMobileAnalysis}
            >
              {t("详情", "Details")}
            </button>
            {speakerSwitchEnabled && (
              <button
                type="button"
                className="ghost-btn"
                style={{ height: "40px" }}
                onClick={onSpeakerSwitchAction}
                disabled={isEnded || connectionState === "connecting" || speakerSwitchPending}
              >
                {speakerSwitchPending
                  ? "..."
                  : speakerMode === "self"
                    ? t("切换", "Switch")
                    : t("退出切换", "Exit")}
              </button>
            )}
            {isCreator && (
              <button
                type="button"
                className="destructive-btn"
                style={{ height: "40px" }}
                onClick={onOpenEndRoomConfirm}
                disabled={endingRoom || isEnded}
              >
                {endingRoom ? "..." : t("结束房间", "End Room")}
              </button>
            )}
          </div>
        </header>

        {roomError && (
          <div className="room-error-box">
            <span style={{ fontSize: "1.2rem" }}>&bull;</span>
            {roomError}
          </div>
        )}

        <section className="chat-panel">
          <div className="chat-scroll">
            {messages.length === 0 ? (
              <p className="empty-chat">{t("暂无对话内容。", "Silence.")}</p>
            ) : (
              messages.map((message) => {
                if (message.type === "analysis") {
                  return (
                    <div key={message.id} className="message-row announcement">
                      <AnalysisMessage
                        analysisViewState={analysisViewState}
                        language={language}
                        message={message}
                        onToggleRawMessage={onToggleRawMessage}
                        rawMessageId={rawMessageId}
                        t={t}
                      />
                    </div>
                  );
                }

                const announcement = message.type === "summary";
                const own = announcement ? false : isOwnMessage(message, userId, username);
                return (
                  <div
                    key={message.id}
                    className={`message-row ${announcement ? "announcement" : own ? "self" : "other"}`}
                  >
                    <article
                      className={`bubble ${message.type} ${announcement ? "announcement" : own ? "self" : "other"}`}
                    >
                      <header className="bubble-meta">
                        <strong>
                          {announcement ? t("最终总结", "Final Summary") : own ? t("我", "Me") : message.senderName}
                        </strong>
                        <span className="bubble-source">
                          {message.type === "transcript" ? t("音", "V") : t("文", "T")}
                        </span>
                        <time dateTime={message.createdAt}>{formatTime(message.createdAt, language)}</time>
                      </header>
                      <p>{message.content}</p>
                    </article>
                  </div>
                );
              })
            )}
            <div ref={scrollAnchorRef} />
          </div>
        </section>

        <form className="chat-form room-chat-form" onSubmit={onSubmitTextMessage}>
          <textarea
            ref={chatInputRef}
            value={chatInput}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onChatInputChange(event.target.value)}
            onKeyDown={onChatInputKeyDown}
            placeholder={isEnded ? t("只读模式", "Read-only") : t("输入消息...", "Type a message...")}
            disabled={roomInteractionBlocked}
            rows={1}
          />
          <div className="room-chat-controls">
            {connectionState === "connected" ? (
              <button
                type="button"
                className={callButtonClassName}
                onClick={() => (canLeaveVoiceCall ? onLeaveVoiceCall() : onStartVoiceCall())}
                disabled={roomInteractionBlocked || voiceCallStarting}
                aria-busy={voiceCallStarting}
                data-busy-label={startingCallButtonLabel}
              >
                {micEnabled ? t("退出通话", "Leave") : t("通话", "Call")}
              </button>
            ) : !roomInteractionBlocked ? (
              <button
                type="button"
                className="ghost-btn"
                onClick={onConnectRoom}
                disabled={connectionState === "connecting"}
              >
                {t("重连", "Reconnect")}
              </button>
            ) : null}

            <button type="submit" className="primary-btn" disabled={sendingText || roomInteractionBlocked}>
              {t("发送", "Send")}
            </button>
          </div>
        </form>

        <div ref={audioContainerRef} className="audio-container" />
      </section>

      <aside className="room-sidebar">{sidebarContent}</aside>

      <div
        className={`mobile-analysis-overlay ${showMobileAnalysis ? "active" : ""}`}
        onClick={onCloseMobileAnalysis}
      />
      <div className={`mobile-analysis-drawer ${showMobileAnalysis ? "active" : ""}`}>
        <button className="drawer-close-btn" onClick={onCloseMobileAnalysis} type="button">
          ×
        </button>
        <h2 style={{ margin: "0 0 8px", fontSize: "1.4rem", fontWeight: 800 }}>
          {t("分析与统计", "Analysis & Stats")}
        </h2>
        {sidebarContent}
      </div>

      {showEndRoomConfirm && (
        <div className="auth-modal-overlay">
          <div className="auth-modal">
            <header className="auth-modal-header">
              <h2>{t("确认结束房间", "Confirm End Room")}</h2>
            </header>
            <div style={{ marginBottom: "24px", lineHeight: "1.6", color: "var(--muted)" }}>
              {t(
                "结束后将生成总结报告，房间将无法再进行对话，只能查看对话历史。是否确认结束？",
                "A summary report will be generated. The room will no longer allow new conversation and will be read-only. Are you sure you want to end?",
              )}
            </div>
            <div style={{ display: "flex", gap: "12px" }}>
              <button className="ghost-btn" style={{ flex: 1 }} onClick={onCloseEndRoomConfirm} type="button">
                {t("取消", "Cancel")}
              </button>
              <button className="destructive-btn" style={{ flex: 1 }} onClick={onConfirmEndRoom} type="button">
                {t("确认", "Confirm")}
              </button>
            </div>
          </div>
        </div>
      )}

      {showSwitchConfirm && (
        <div className="auth-modal-overlay">
          <div className="auth-modal">
            <header className="auth-modal-header">
              <h2>{t("确认切换身份", "Confirm Switch Identity")}</h2>
            </header>
            <div style={{ marginBottom: "24px", lineHeight: "1.6", color: "var(--muted)" }}>
              {t(
                "你将切换到你的模拟对手，你可以使用该模式测试，或者在同一设备上双人辩论。",
                "You will switch to your simulated opponent. You can use this mode for testing or for a two-person debate on the same device.",
              )}
            </div>
            <div style={{ display: "flex", gap: "12px" }}>
              <button className="ghost-btn" style={{ flex: 1 }} onClick={onCloseSwitchConfirm} type="button">
                {t("取消", "Cancel")}
              </button>
              <button className="primary-btn" style={{ flex: 1 }} onClick={onConfirmSwitch} type="button">
                {t("确认", "Confirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
