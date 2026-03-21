import { type UiLanguage } from "@/lib/ui-language";

import { type DashboardTranslate } from "./dashboard-page-support";
import { AuthModal } from "./sections/auth-modal";
import { DashboardHeader } from "./sections/dashboard-header";
import { LivekitSettingsPanel } from "./sections/livekit-settings-panel";
import { LlmSettingsPanel } from "./sections/llm-settings-panel";
import { RoomActionsCard } from "./sections/room-actions-card";
import { RoomHistoryPanel } from "./sections/room-history-panel";
import { TranscriptionSettingsPanel } from "./sections/transcription-settings-panel";
import { UsageStatsPanel } from "./sections/usage-stats-panel";
import { type DashboardState } from "./use-dashboard-state";

type DashboardPageViewProps = {
  heroSubtitle: string;
  isZh: boolean;
  language: UiLanguage;
  onToggleLanguage: () => void;
  showUserProviderSettings: boolean;
  state: DashboardState;
  t: DashboardTranslate;
};

export function DashboardPageView({
  heroSubtitle,
  isZh,
  language,
  onToggleLanguage,
  showUserProviderSettings,
  state,
  t,
}: DashboardPageViewProps) {
  return (
    <>
      <main className="dashboard-page minimal-page">
        <section className="minimal-shell">
          <DashboardHeader
            heroSubtitle={heroSubtitle}
            isAuthenticated={state.isAuthenticated}
            isZh={isZh}
            onLogout={state.handleLogout}
            onOpenLogin={state.openLoginModal}
            onOpenRegister={state.openRegisterModal}
            onToggleLanguage={onToggleLanguage}
            t={t}
            user={state.user}
          />

          <RoomActionsCard
            onCreateRoom={state.handleCreateRoom}
            onJoinRoom={state.handleJoinRoom}
            onRoomIdToJoinChange={state.setRoomIdToJoin}
            roomActionError={state.roomActionError}
            roomActionLoading={state.roomActionLoading}
            roomIdToJoin={state.roomIdToJoin}
            t={t}
          />

          <section className="minimal-details-wrap">
            <RoomHistoryPanel
              createdRooms={state.createdRooms}
              dashboardLoading={state.dashboardLoading}
              hasHistory={state.hasHistory}
              isAuthenticated={state.isAuthenticated}
              joinedRooms={state.joinedRooms}
              language={language}
              onRefresh={state.refreshDashboard}
              t={t}
            />

            <UsageStatsPanel
              isAuthenticated={state.isAuthenticated}
              language={language}
              t={t}
              usageSummary={state.usageSummary}
            />

            {showUserProviderSettings ? (
              <>
                <LivekitSettingsPanel
                  isAuthenticated={state.isAuthenticated}
                  language={language}
                  livekitError={state.livekitError}
                  livekitForm={state.livekitForm}
                  livekitLoading={state.livekitLoading}
                  livekitStatus={state.livekitStatus}
                  onClearLivekit={state.clearLivekit}
                  onRefreshLivekitStatus={state.refreshLivekitStatus}
                  onSaveLivekit={state.saveLivekit}
                  setLivekitForm={state.setLivekitForm}
                  t={t}
                />

                <TranscriptionSettingsPanel
                  isAuthenticated={state.isAuthenticated}
                  language={language}
                  onClearTranscription={state.clearTranscription}
                  onRefreshTranscriptionStatus={state.refreshTranscriptionStatus}
                  onSaveTranscription={state.saveTranscription}
                  onSetDefaultProvider={state.setDefaultProvider}
                  setTranscriptionForm={state.setTranscriptionForm}
                  t={t}
                  transcriptionError={state.transcriptionError}
                  transcriptionForm={state.transcriptionForm}
                  transcriptionLoading={state.transcriptionLoading}
                  transcriptionStatus={state.transcriptionStatus}
                />

                <LlmSettingsPanel
                  isAuthenticated={state.isAuthenticated}
                  language={language}
                  llmError={state.llmError}
                  llmForm={state.llmForm}
                  llmKeyStatus={state.llmKeyStatus}
                  llmLoading={state.llmLoading}
                  onClearLlm={state.clearLlm}
                  onRefreshLlmStatus={state.refreshLlmStatus}
                  onSaveLlm={state.saveLlm}
                  setLlmForm={state.setLlmForm}
                  t={t}
                />
              </>
            ) : null}
          </section>
        </section>
      </main>

      {state.authMode ? (
        <AuthModal
          authError={state.authError}
          authForm={state.authForm}
          authLoading={state.authLoading}
          authMode={state.authMode}
          authNextPath={state.authNextPath}
          authTitle={state.authTitle}
          onClose={state.closeAuthModal}
          onSubmit={state.handleAuthSubmit}
          setAuthForm={state.setAuthForm}
          setAuthMode={state.setAuthMode}
          t={t}
        />
      ) : null}
    </>
  );
}
