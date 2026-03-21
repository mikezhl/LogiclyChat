import { type DashboardTranslate, type UserInfo } from "../dashboard-page-support";

type DashboardHeaderProps = {
  heroSubtitle: string;
  isAuthenticated: boolean;
  isZh: boolean;
  onLogout: () => Promise<void>;
  onOpenLogin: () => void;
  onOpenRegister: () => void;
  onToggleLanguage: () => void;
  t: DashboardTranslate;
  user: UserInfo | null;
};

export function DashboardHeader({
  heroSubtitle,
  isAuthenticated,
  isZh,
  onLogout,
  onOpenLogin,
  onOpenRegister,
  onToggleLanguage,
  t,
  user,
}: DashboardHeaderProps) {
  return (
    <header className="minimal-header">
      <div>
        <h1>{t("急了么？", "Logicly Chat")}</h1>
        <p className="subtitle">{heroSubtitle}</p>
      </div>

      <div className="header-actions">
        <a
          href="https://github.com/mikezhl/LogiclyChat"
          target="_blank"
          rel="noopener noreferrer"
          className="github-icon-link"
          aria-label="GitHub"
          title="GitHub"
        >
          <svg className="github-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="#202123"
              d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"
            />
          </svg>
        </a>

        <button
          type="button"
          className="lang-toggle-btn"
          aria-label={t("切换到英文", "Switch to Chinese")}
          onClick={onToggleLanguage}
        >
          {isZh ? "EN" : "中"}
        </button>

        {isAuthenticated ? (
          <>
            <span className="user-chip">
              <span className="desktop-only">{user?.username}</span>
              <span className="mobile-only">
                {user?.username?.substring(0, 8)}
                {user?.username && user.username.length > 8 ? "..." : ""}
              </span>
            </span>
            <button type="button" className="ghost-btn" onClick={() => void onLogout()}>
              <span className="desktop-only">{t("退出登录", "Sign Out")}</span>
              <span className="mobile-only">{t("退出", "Out")}</span>
            </button>
          </>
        ) : (
          <>
            <button type="button" className="ghost-btn" onClick={onOpenLogin}>
              {t("登录", "Sign In")}
            </button>
            <button type="button" className="primary-btn" onClick={onOpenRegister}>
              {t("注册", "Sign Up")}
            </button>
          </>
        )}
      </div>
    </header>
  );
}
