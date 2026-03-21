import { type Dispatch, type FormEvent, type SetStateAction } from "react";

import { type UiLanguage } from "@/lib/ui-language";

import {
  MANUAL_INPUT_PROPS,
  MANUAL_SECRET_INPUT_PROPS,
  configuredLabel,
  type DashboardTranslate,
  type LivekitFormState,
  type LivekitStatus,
} from "../dashboard-page-support";

type LivekitSettingsPanelProps = {
  isAuthenticated: boolean;
  language: UiLanguage;
  livekitError: string;
  livekitForm: LivekitFormState;
  livekitLoading: boolean;
  livekitStatus: LivekitStatus | null;
  onClearLivekit: () => Promise<void>;
  onRefreshLivekitStatus: () => Promise<void>;
  onSaveLivekit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  setLivekitForm: Dispatch<SetStateAction<LivekitFormState>>;
  t: DashboardTranslate;
};

export function LivekitSettingsPanel({
  isAuthenticated,
  language,
  livekitError,
  livekitForm,
  livekitLoading,
  livekitStatus,
  onClearLivekit,
  onRefreshLivekitStatus,
  onSaveLivekit,
  setLivekitForm,
  t,
}: LivekitSettingsPanelProps) {
  return (
    <details className="minimal-details">
      <summary>{t("配置 LiveKit 通话", "Configure LiveKit Transport")}</summary>

      {!isAuthenticated ? (
        <div className="details-content">
          <p className="panel-tip">
            {t(
              "登录后可单独保存你自己的 LiveKit 通话配置。",
              "Sign in to store your own LiveKit transport settings separately.",
            )}
          </p>
        </div>
      ) : (
        <div className="details-content">
          <p className="panel-tip">
            {t("当前状态", "Current status")}: {configuredLabel(Boolean(livekitStatus?.configured), language)}。
            {t(
              "这一组配置只负责 LiveKit 通话接入，与实时转录平台分开保存。启用用户 Key 模式时，房主必须同时具备完整的 LiveKit 与默认转录工具配置，系统不会混用平台和个人 Key。",
              "These credentials only cover LiveKit transport and are stored separately from realtime transcription providers. In user-key modes, the room owner must have both a complete LiveKit bundle and a configured default transcription provider. Platform and personal keys are never mixed.",
            )}
          </p>

          <div className="key-status-grid">
            <span>LiveKit URL: {livekitStatus?.livekitUrlMask ?? t("未配置", "Not configured")}</span>
            <span>LiveKit API Key: {livekitStatus?.livekitApiKeyMask ?? t("未配置", "Not configured")}</span>
            <span>
              LiveKit API Secret: {livekitStatus?.livekitApiSecretMask ?? t("未配置", "Not configured")}
            </span>
          </div>

          <form className="key-form" onSubmit={(event) => void onSaveLivekit(event)} autoComplete="off">
            <input
              {...MANUAL_INPUT_PROPS}
              type="url"
              inputMode="url"
              name="livekit-url"
              value={livekitForm.livekitUrl}
              onChange={(event) =>
                setLivekitForm((current) => ({ ...current, livekitUrl: event.target.value }))
              }
              placeholder={t("LIVEKIT_URL（必填）", "LIVEKIT_URL (required)")}
            />
            <input
              {...MANUAL_INPUT_PROPS}
              name="livekit-api-key"
              value={livekitForm.livekitApiKey}
              onChange={(event) =>
                setLivekitForm((current) => ({ ...current, livekitApiKey: event.target.value }))
              }
              placeholder="LIVEKIT_API_KEY"
            />
            <input
              {...MANUAL_SECRET_INPUT_PROPS}
              type="password"
              name="livekit-api-secret"
              value={livekitForm.livekitApiSecret}
              onChange={(event) =>
                setLivekitForm((current) => ({ ...current, livekitApiSecret: event.target.value }))
              }
              placeholder="LIVEKIT_API_SECRET"
            />

            <div className="key-form-actions">
              <button type="submit" className="primary-btn" disabled={livekitLoading}>
                {livekitLoading ? t("保存中...", "Saving...") : t("保存配置", "Save Settings")}
              </button>
              <button type="button" className="ghost-btn" disabled={livekitLoading} onClick={() => void onClearLivekit()}>
                {t("清空", "Clear")}
              </button>
              <button
                type="button"
                className="ghost-btn"
                disabled={livekitLoading}
                onClick={() => void onRefreshLivekitStatus()}
              >
                {t("刷新状态", "Refresh status")}
              </button>
            </div>
          </form>

          {livekitError ? <p className="form-error">{livekitError}</p> : null}
        </div>
      )}
    </details>
  );
}
