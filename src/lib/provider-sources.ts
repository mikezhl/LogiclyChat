export type KeySource = "user" | "system" | "unavailable";

export function isConfiguredSource(source: KeySource) {
  return source === "user" || source === "system";
}
