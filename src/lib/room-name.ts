export function normalizeRoomName(name?: string | null): string | null {
  const normalized = name?.trim().replace(/\s+/g, " ");
  return normalized && normalized.length > 0 ? normalized.slice(0, 80) : null;
}

export function getRoomDisplayName(roomName: string | null | undefined, roomId: string): string {
  return normalizeRoomName(roomName) ?? roomId;
}

export function getRoomNameFromAnalysisPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const focus = (payload as { focus?: unknown }).focus;
  return typeof focus === "string" ? normalizeRoomName(focus) : null;
}

export function getRoomNameFromAnalysisContent(content: string): string | null {
  try {
    return getRoomNameFromAnalysisPayload(JSON.parse(content) as unknown);
  } catch {
    return null;
  }
}
