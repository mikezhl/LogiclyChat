import { type UiLanguage } from "@/lib/ui-language";

import {
  formatSeconds,
  formatTokens,
  formatVoiceUsage,
  type DashboardTranslate,
  type UsageSummary,
} from "../dashboard-page-support";

type UsageStatsPanelProps = {
  isAuthenticated: boolean;
  language: UiLanguage;
  t: DashboardTranslate;
  usageSummary: UsageSummary | null;
};

export function UsageStatsPanel({
  isAuthenticated,
  language,
  t,
  usageSummary,
}: UsageStatsPanelProps) {
  return (
    <details className="minimal-details">
      <summary>{t("使用量统计", "Usage Stats")}</summary>

      {!isAuthenticated ? (
        <div className="details-content">
          <p className="panel-tip">{t("登录后可查看累计消耗统计。", "Sign in to view your accumulated usage.")}</p>
        </div>
      ) : (
        <div className="details-content">
          <p className="panel-tip">
            {t(
              "仅统计房主名下房间产生的消耗。房间参与者不会累计自己的 Key 或平台用量。",
              "Only usage generated under rooms you own is counted. Participants do not accumulate their own or platform usage.",
            )}
          </p>

          <div className="usage-summary-grid">
            <section className="usage-summary-column" style={{ minWidth: 0 }}>
              <h4>{t("语音", "Voice")}</h4>
              <div className="key-status-grid">
                <span>
                  {t("自有 Key", "Own Key")}: {formatSeconds(usageSummary?.voice.userSeconds ?? 0, language)}
                </span>
                <span>
                  {t("平台 Key", "Platform Key")}: {formatVoiceUsage(usageSummary?.voice.platformSeconds ?? 0, language)}
                  {" / "}
                  {usageSummary?.voice.platformLimitSeconds == null
                    ? t("无限制", "No limit")
                    : formatVoiceUsage(usageSummary.voice.platformLimitSeconds, language)}
                </span>
                <span>
                  {t("剩余", "Remaining")}:{" "}
                  {usageSummary?.voice.platformRemainingSeconds == null
                    ? t("无限制", "No limit")
                    : formatVoiceUsage(usageSummary.voice.platformRemainingSeconds, language)}
                </span>
                <span>
                  {t("配额状态", "Quota Status")}:{" "}
                  {usageSummary?.voice.platformExceeded ? t("已超限", "Exceeded") : t("可用", "Available")}
                </span>
              </div>
            </section>

            <section className="usage-summary-column" style={{ minWidth: 0 }}>
              <h4>{t("LLM", "LLM")}</h4>
              <div className="key-status-grid">
                <span>
                  {t("自有 Key", "Own Key")}: {formatTokens(usageSummary?.llm.userTokens ?? 0, language)}
                </span>
                <span>
                  {t("平台 Key", "Platform Key")}: {formatTokens(usageSummary?.llm.platformTokens ?? 0, language)}
                  {" / "}
                  {usageSummary?.llm.platformLimitTokens == null
                    ? t("无限制", "No limit")
                    : formatTokens(usageSummary.llm.platformLimitTokens, language)}
                </span>
                <span>
                  {t("剩余", "Remaining")}:{" "}
                  {usageSummary?.llm.platformRemainingTokens == null
                    ? t("无限制", "No limit")
                    : formatTokens(usageSummary.llm.platformRemainingTokens, language)}
                </span>
                <span>
                  {t("配额状态", "Quota Status")}:{" "}
                  {usageSummary?.llm.platformExceeded ? t("已超限", "Exceeded") : t("可用", "Available")}
                </span>
              </div>
            </section>
          </div>
        </div>
      )}
    </details>
  );
}
