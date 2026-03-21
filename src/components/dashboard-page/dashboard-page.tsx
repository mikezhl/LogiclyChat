"use client";

import { useUiLanguage } from "@/lib/use-ui-language";

import { type DashboardPageClientProps } from "./dashboard-page-support";
import { DashboardPageView } from "./dashboard-page-view";
import { useDashboardState } from "./use-dashboard-state";

export default function DashboardPageClient(props: DashboardPageClientProps) {
  const { language, setLanguage } = useUiLanguage();
  const isZh = language === "zh";
  const t = (zh: string, en: string) => (isZh ? zh : en);
  const state = useDashboardState({ ...props, t });
  const showUserProviderSettings = props.initialUserProviderKeysMode !== "false";
  const heroSubtitle = state.isAuthenticated
    ? t(
        `你好，${state.user?.username}。可以直接创建或加入房间。`,
        `Hi, ${state.user?.username}. You can create or join a room right away.`,
      )
    : t(
        "一个实时的 AI 辩论/吵架辅助 + 分析 + 总结平台",
        "A real-time AI debate and argument copilot for assist, analysis, and summaries.",
      );

  return (
    <DashboardPageView
      heroSubtitle={heroSubtitle}
      isZh={isZh}
      language={language}
      onToggleLanguage={() => setLanguage(isZh ? "en" : "zh")}
      showUserProviderSettings={showUserProviderSettings}
      state={state}
      t={t}
    />
  );
}
