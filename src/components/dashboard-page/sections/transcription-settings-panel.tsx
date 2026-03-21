import { type Dispatch, type FormEvent, type SetStateAction } from "react";

import { type UiLanguage } from "@/lib/ui-language";

import {
  DASHSCOPE_DEFAULT_MODEL,
  MANUAL_SECRET_INPUT_PROPS,
  PROVIDERS,
  configuredLabel,
  providerLabel,
  type DashboardTranslate,
  type TranscriptionFormState,
  type TranscriptionProviderName,
  type TranscriptionSettingsStatus,
} from "../dashboard-page-support";

type TranscriptionSettingsPanelProps = {
  isAuthenticated: boolean;
  language: UiLanguage;
  onClearTranscription: (provider: TranscriptionProviderName) => Promise<void>;
  onRefreshTranscriptionStatus: () => Promise<void>;
  onSaveTranscription: (
    event: FormEvent<HTMLFormElement>,
    provider: TranscriptionProviderName,
  ) => Promise<void>;
  onSetDefaultProvider: (provider: TranscriptionProviderName | null) => Promise<void>;
  setTranscriptionForm: Dispatch<SetStateAction<TranscriptionFormState>>;
  t: DashboardTranslate;
  transcriptionError: string;
  transcriptionForm: TranscriptionFormState;
  transcriptionLoading: string | null;
  transcriptionStatus: TranscriptionSettingsStatus | null;
};

export function TranscriptionSettingsPanel({
  isAuthenticated,
  language,
  onClearTranscription,
  onRefreshTranscriptionStatus,
  onSaveTranscription,
  onSetDefaultProvider,
  setTranscriptionForm,
  t,
  transcriptionError,
  transcriptionForm,
  transcriptionLoading,
  transcriptionStatus,
}: TranscriptionSettingsPanelProps) {
  const providerMap = new Map(
    (transcriptionStatus?.providers ?? []).map((item) => [item.provider, item]),
  );

  return (
    <details className="minimal-details">
      <summary>{t("配置实时转录", "Configure Realtime Transcription")}</summary>

      {!isAuthenticated ? (
        <div className="details-content">
          <p className="panel-tip">
            {t(
              "登录后可分别保存不同转录平台的 Key，并设置自己的默认实时转录工具。",
              "Sign in to store different transcription provider keys separately and choose your default realtime transcription tool.",
            )}
          </p>
        </div>
      ) : (
        <div className="details-content">
          <p className="panel-tip">
            {t("默认转录工具", "Default provider")}:{" "}
            {transcriptionStatus?.defaultProvider
              ? providerLabel(transcriptionStatus.defaultProvider, language)
              : t("未设置", "Not selected")}
            。
            {t(
              "房主在用户 Key 模式（true / full）下，必须同时拥有完整的 LiveKit 配置和默认转录工具配置，否则开启语音实时转录时会直接报错。平台 Key 与用户自己的 Key 不会混合使用。",
              "When user-key mode is enabled (true / full), the room owner must have both a complete LiveKit setup and a configured default transcription provider, otherwise live voice transcription fails immediately. Platform keys and user keys are never mixed.",
            )}
          </p>

          <div className="key-form-actions">
            <button
              type="button"
              className="ghost-btn"
              disabled={transcriptionLoading !== null}
              onClick={() => void onRefreshTranscriptionStatus()}
            >
              {t("刷新状态", "Refresh status")}
            </button>
            <button
              type="button"
              className="ghost-btn"
              disabled={transcriptionLoading !== null || !transcriptionStatus?.defaultProvider}
              onClick={() => void onSetDefaultProvider(null)}
            >
              {t("清除默认值", "Clear default")}
            </button>
          </div>

          {PROVIDERS.map((provider) => {
            const providerStatus = providerMap.get(provider);
            const isDefault = transcriptionStatus?.defaultProvider === provider;

            return (
              <section
                key={provider}
                className="key-status-grid"
                style={{ gap: "12px", background: "var(--card)", border: "1px solid var(--line)" }}
              >
                <div>
                  <h4 style={{ margin: 0 }}>{providerLabel(provider, language)}</h4>
                  <p className="panel-tip" style={{ marginTop: "6px" }}>
                    {t("当前状态", "Current status")}: {configuredLabel(Boolean(providerStatus?.configured), language)}
                  </p>
                  <p className="panel-tip" style={{ marginTop: "6px" }}>
                    API Key: {providerStatus?.credentialMask ?? t("未配置", "Not configured")}
                  </p>
                  {provider === "dashscope" ? (
                    <p className="panel-tip" style={{ marginTop: "6px" }}>
                      {t("默认模型", "Default model")}: {DASHSCOPE_DEFAULT_MODEL}
                    </p>
                  ) : null}
                </div>

                <form
                  className="key-form"
                  onSubmit={(event) => void onSaveTranscription(event, provider)}
                  autoComplete="off"
                >
                  <input
                    {...MANUAL_SECRET_INPUT_PROPS}
                    type="password"
                    name={`${provider}-api-key`}
                    value={transcriptionForm[provider]}
                    onChange={(event) =>
                      setTranscriptionForm((current) => ({ ...current, [provider]: event.target.value }))
                    }
                    placeholder={provider === "dashscope" ? "DASHSCOPE_API_KEY" : "DEEPGRAM_API_KEY"}
                  />

                  {provider === "dashscope" ? (
                    <p className="panel-tip" style={{ marginTop: 0 }}>
                      {t(
                        "请输入百炼 API Key，通常以 sk- 开头。",
                        "Use a DashScope API key, which usually starts with sk-.",
                      )}
                    </p>
                  ) : null}

                  <div className="key-form-actions">
                    <button type="submit" className="primary-btn" disabled={transcriptionLoading !== null}>
                      {transcriptionLoading === `save:${provider}`
                        ? t("保存中...", "Saving...")
                        : t("保存配置", "Save Settings")}
                    </button>
                    <button
                      type="button"
                      className="ghost-btn"
                      disabled={transcriptionLoading !== null}
                      onClick={() => void onClearTranscription(provider)}
                    >
                      {transcriptionLoading === `clear:${provider}`
                        ? t("清空中...", "Clearing...")
                        : t("清空", "Clear")}
                    </button>
                    <button
                      type="button"
                      className={isDefault ? "primary-btn" : "ghost-btn"}
                      disabled={transcriptionLoading !== null || !providerStatus?.configured}
                      onClick={() => void onSetDefaultProvider(provider)}
                    >
                      {transcriptionLoading === `default:${provider}`
                        ? t("保存中...", "Saving...")
                        : isDefault
                          ? t("默认工具", "Default")
                          : t("设为默认", "Set default")}
                    </button>
                  </div>
                </form>
              </section>
            );
          })}

          {transcriptionError ? <p className="form-error">{transcriptionError}</p> : null}
        </div>
      )}
    </details>
  );
}
