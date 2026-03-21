import { type Dispatch, type FormEvent, type SetStateAction } from "react";

import { type UiLanguage } from "@/lib/ui-language";

import {
  MANUAL_INPUT_PROPS,
  MANUAL_SECRET_INPUT_PROPS,
  configuredLabel,
  type DashboardTranslate,
  type LlmFormState,
  type LlmKeyStatus,
} from "../dashboard-page-support";

type LlmSettingsPanelProps = {
  isAuthenticated: boolean;
  language: UiLanguage;
  llmError: string;
  llmForm: LlmFormState;
  llmKeyStatus: LlmKeyStatus | null;
  llmLoading: boolean;
  onClearLlm: () => Promise<void>;
  onRefreshLlmStatus: () => Promise<void>;
  onSaveLlm: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  setLlmForm: Dispatch<SetStateAction<LlmFormState>>;
  t: DashboardTranslate;
};

export function LlmSettingsPanel({
  isAuthenticated,
  language,
  llmError,
  llmForm,
  llmKeyStatus,
  llmLoading,
  onClearLlm,
  onRefreshLlmStatus,
  onSaveLlm,
  setLlmForm,
  t,
}: LlmSettingsPanelProps) {
  return (
    <details className="minimal-details">
      <summary>{t("配置分析 LLM", "Configure Analysis LLM")}</summary>

      {!isAuthenticated ? (
        <div className="details-content">
          <p className="panel-tip">
            {t("登录后可单独保存你自己的分析 LLM 配置。", "Sign in to store your own analysis LLM settings separately.")}
          </p>
        </div>
      ) : (
        <div className="details-content">
          <p className="panel-tip">
            {t("当前状态", "Current status")}: {configuredLabel(Boolean(llmKeyStatus?.configured), language)}。
            {t(
              "这一组配置与 LiveKit/转录配置分开保存，仅在 `CONVERSATION_LLM_PROVIDER=openai-compatible` 时用于房间分析。",
              "This set is stored separately from LiveKit/transcription settings and is used for room analysis only when `CONVERSATION_LLM_PROVIDER=openai-compatible`.",
            )}
          </p>

          <div className="key-status-grid">
            <span>LLM URL: {llmKeyStatus?.baseUrlMask ?? t("未配置", "Not configured")}</span>
            <span>LLM API Key: {llmKeyStatus?.apiKeyMask ?? t("未配置", "Not configured")}</span>
            <span>LLM Model: {llmKeyStatus?.model ?? t("未配置", "Not configured")}</span>
          </div>

          <form className="key-form" onSubmit={(event) => void onSaveLlm(event)} autoComplete="off">
            <input
              {...MANUAL_INPUT_PROPS}
              type="url"
              inputMode="url"
              name="conversation-llm-base-url"
              value={llmForm.baseUrl}
              onChange={(event) => setLlmForm((current) => ({ ...current, baseUrl: event.target.value }))}
              placeholder={t(
                "CONVERSATION_LLM_OPENAI_BASE_URL（必填）",
                "CONVERSATION_LLM_OPENAI_BASE_URL (required)",
              )}
            />
            <input
              {...MANUAL_SECRET_INPUT_PROPS}
              type="password"
              name="conversation-llm-api-key"
              value={llmForm.apiKey}
              onChange={(event) => setLlmForm((current) => ({ ...current, apiKey: event.target.value }))}
              placeholder="CONVERSATION_LLM_OPENAI_API_KEY"
            />
            <input
              {...MANUAL_INPUT_PROPS}
              name="conversation-llm-model"
              value={llmForm.model}
              onChange={(event) => setLlmForm((current) => ({ ...current, model: event.target.value }))}
              placeholder="CONVERSATION_LLM_OPENAI_MODEL"
            />

            <div className="key-form-actions">
              <button type="submit" className="primary-btn" disabled={llmLoading}>
                {llmLoading ? t("保存中...", "Saving...") : t("保存配置", "Save Settings")}
              </button>
              <button type="button" className="ghost-btn" disabled={llmLoading} onClick={() => void onClearLlm()}>
                {t("清空", "Clear")}
              </button>
              <button
                type="button"
                className="ghost-btn"
                disabled={llmLoading}
                onClick={() => void onRefreshLlmStatus()}
              >
                {t("刷新状态", "Refresh status")}
              </button>
            </div>
          </form>

          {llmError ? <p className="form-error">{llmError}</p> : null}
        </div>
      )}
    </details>
  );
}
