"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useUiLanguage } from "@/lib/use-ui-language";

type AuthPageClientProps = {
  mode: "login" | "register";
};

type AuthResponse = {
  error?: string;
};

function normalizeNextPath(raw: string | null) {
  if (!raw || !raw.startsWith("/")) {
    return "/";
  }
  return raw;
}

export default function AuthPageClient({ mode }: AuthPageClientProps) {
  const router = useRouter();
  const { language, setLanguage } = useUiLanguage();
  const isZh = language === "zh";
  const t = (zh: string, en: string) => (isZh ? zh : en);
  const toggleLanguage = () => setLanguage(isZh ? "en" : "zh");

  const searchParams = useSearchParams();
  const nextPath = useMemo(() => normalizeNextPath(searchParams.get("next")), [searchParams]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const title = mode === "login" ? t("登录", "Sign In") : t("注册", "Sign Up");
  const submitEndpoint = mode === "login" ? "/api/auth/login" : "/api/auth/register";
  const switchHref = mode === "login" ? `/register?next=${encodeURIComponent(nextPath)}` : `/login?next=${encodeURIComponent(nextPath)}`;
  const switchLabel =
    mode === "login" ? t("还没有账号？去注册", "No account yet? Sign up") : t("已有账号？去登录", "Have an account? Sign in");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const response = await fetch(submitEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const payload = (await response.json()) as AuthResponse;
      if (!response.ok) {
        throw new Error(payload.error ?? `${title}${t("失败", " failed")}`);
      }

      router.replace(nextPath);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : `${title}${t("失败", " failed")}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="header-actions" style={{ justifyContent: "flex-end", marginTop: 0, marginBottom: 16 }}>
          <button
            type="button"
            className="lang-toggle-btn"
            aria-label={t("切换到英文", "Switch to Chinese")}
            onClick={toggleLanguage}
          >
            {isZh ? "EN" : "中"}
          </button>
        </div>
        <h1>{title}</h1>
        <p>{t("使用用户名和密码继续。", "Continue with your username and password.")}</p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label htmlFor="username">{t("用户名", "Username")}</label>
          <input
            id="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder={t("3-32 位，小写字母/数字/_", "3-32 chars, lowercase letters/numbers/_")}
            autoComplete="username"
          />

          <label htmlFor="password">{t("密码", "Password")}</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={t("至少 6 位", "At least 6 characters")}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
          />

          <button type="submit" disabled={loading}>
            {loading ? `${title}${t("中...", "...")}` : title}
          </button>
        </form>

        {error ? <p className="form-error">{error}</p> : null}

        <p className="auth-switch">
          <Link href={switchHref}>{switchLabel}</Link>
        </p>
      </section>
    </main>
  );
}
