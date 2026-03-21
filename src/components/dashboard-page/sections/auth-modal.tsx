import { type Dispatch, type FormEvent, type SetStateAction } from "react";

import {
  type AuthFormState,
  type DashboardAuthMode,
  type DashboardTranslate,
} from "../dashboard-page-support";

type AuthModalProps = {
  authError: string;
  authForm: AuthFormState;
  authLoading: boolean;
  authMode: NonNullable<DashboardAuthMode>;
  authNextPath: string | null;
  authTitle: string;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  setAuthForm: Dispatch<SetStateAction<AuthFormState>>;
  setAuthMode: Dispatch<SetStateAction<DashboardAuthMode>>;
  t: DashboardTranslate;
};

export function AuthModal({
  authError,
  authForm,
  authLoading,
  authMode,
  authNextPath,
  authTitle,
  onClose,
  onSubmit,
  setAuthForm,
  setAuthMode,
  t,
}: AuthModalProps) {
  return (
    <div className="auth-modal-overlay" role="dialog" aria-modal="true">
      <section className="auth-modal">
        <header className="auth-modal-header">
          <h2>{authTitle}</h2>
          <button type="button" className="close-btn" onClick={onClose}>
            {t("关闭", "Close")}
          </button>
        </header>

        <div className="auth-switch-row">
          <button
            type="button"
            className={authMode === "login" ? "switch-btn active" : "switch-btn"}
            onClick={() => setAuthMode("login")}
          >
            {t("登录", "Sign In")}
          </button>
          <button
            type="button"
            className={authMode === "register" ? "switch-btn active" : "switch-btn"}
            onClick={() => setAuthMode("register")}
          >
            {t("注册", "Sign Up")}
          </button>
        </div>

        {authNextPath ? (
          <p className="panel-tip">
            {t("登录后将继续访问：", "After signing in, you will continue to: ")}
            {authNextPath}
          </p>
        ) : null}

        <form className="auth-form modal-auth-form" onSubmit={(event) => void onSubmit(event)}>
          <label htmlFor="auth-username">{t("用户名", "Username")}</label>
          <input
            id="auth-username"
            value={authForm.username}
            onChange={(event) => setAuthForm((current) => ({ ...current, username: event.target.value }))}
            placeholder={t("3-32 位：小写字母/数字/_", "3-32 chars: lowercase letters/numbers/_")}
            autoComplete="username"
          />

          <label htmlFor="auth-password">{t("密码", "Password")}</label>
          <input
            id="auth-password"
            type="password"
            value={authForm.password}
            onChange={(event) => setAuthForm((current) => ({ ...current, password: event.target.value }))}
            placeholder={t("至少 6 位", "At least 6 characters")}
            autoComplete={authMode === "login" ? "current-password" : "new-password"}
          />

          <button type="submit" className="primary-btn" disabled={authLoading}>
            {authLoading ? `${authTitle}${t("中...", "...")}` : authTitle}
          </button>
        </form>

        {authError ? <p className="form-error">{authError}</p> : null}
      </section>
    </div>
  );
}
