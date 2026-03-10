export type RoomSpeakerMode = "self" | "bot";

const BOT_SPEAKER_SUFFIX = "Bot";

export function resolveRoomSpeakerMode(value?: string | null): RoomSpeakerMode {
  return value === "bot" ? "bot" : "self";
}

export function getRoomSpeakerDisplayName(username: string, mode: RoomSpeakerMode): string {
  return mode === "bot" ? `${username}${BOT_SPEAKER_SUFFIX}` : username;
}

export function getRoomSpeakerParticipantIdentity(userId: string, mode: RoomSpeakerMode): string {
  const baseIdentity = `user-${userId}`;
  return mode === "bot" ? `${baseIdentity}:bot` : baseIdentity;
}

export function buildRoomSpeakerProfile({
  userId,
  username,
  mode,
}: {
  userId: string;
  username: string;
  mode: RoomSpeakerMode;
}) {
  return {
    mode,
    displayName: getRoomSpeakerDisplayName(username, mode),
    participantIdentity: getRoomSpeakerParticipantIdentity(userId, mode),
    senderUserId: mode === "self" ? userId : null,
  };
}
