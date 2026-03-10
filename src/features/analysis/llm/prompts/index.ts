import realtimeDefaultPrompt from "./realtime/default";
import summaryDefaultPrompt from "./summary/default";

export type PromptMode = "realtime" | "summary";

const promptRegistry: Record<PromptMode, Record<string, string>> = {
  realtime: {
    default_cn: realtimeDefaultPrompt,
  },
  summary: {
    default_cn: summaryDefaultPrompt,
  },
};

const promptAliases: Record<PromptMode, Record<string, string>> = {
  realtime: {
    default: "default_cn",
    coach: "default_cn",
    coach_cn: "default_cn",
  },
  summary: {
    default: "default_cn",
    strategic: "default_cn",
    strategic_cn: "default_cn",
  },
};

const defaultPromptStyles: Record<PromptMode, string> = {
  realtime: "default_cn",
  summary: "default_cn",
};

function normalizeStyle(raw: string | null | undefined) {
  const normalized = raw?.trim().toLowerCase();
  if (!normalized) {
    return "";
  }

  return normalized.replace(/[^a-z0-9_-]/g, "");
}

export type PromptResolution = {
  style: string;
  prompt: string;
  fallbackUsed: boolean;
};

export function resolvePromptTemplate(mode: PromptMode, requestedStyle: string | null | undefined): PromptResolution {
  const registry = promptRegistry[mode];
  const aliases = promptAliases[mode];
  const normalizedStyle = normalizeStyle(requestedStyle);
  const style = registry[normalizedStyle]
    ? normalizedStyle
    : aliases[normalizedStyle] ?? defaultPromptStyles[mode];
  const prompt = registry[style];

  return {
    style,
    prompt,
    fallbackUsed: normalizedStyle !== style,
  };
}
