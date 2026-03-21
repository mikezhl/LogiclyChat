import { prisma } from "@/lib/prisma";
import { RoomAccessError } from "@/lib/rooms";

export const ROOM_META_HEARTBEAT_INTERVAL_MS = 5_000;
export const ROOM_OWNER_PRESENCE_TIMEOUT_MS = 15_000;
export const ROOM_PARTICIPANT_PRESENCE_TIMEOUT_MS = ROOM_OWNER_PRESENCE_TIMEOUT_MS;

export type RoomOwnerPresence = {
  active: boolean;
  lastSeenAt: Date | null;
  timeoutMs: number;
};

export function isRoomParticipantActive(
  lastSeenAt: Date | null | undefined,
  timeoutMs = ROOM_PARTICIPANT_PRESENCE_TIMEOUT_MS,
) {
  return lastSeenAt !== null && lastSeenAt !== undefined && Date.now() - lastSeenAt.getTime() <= timeoutMs;
}

export async function touchRoomParticipantHeartbeat(roomRefId: string, userId: string) {
  const now = new Date();

  await prisma.roomParticipant.upsert({
    where: {
      roomRefId_userId: {
        roomRefId,
        userId,
      },
    },
    update: {
      lastSeenAt: now,
    },
    create: {
      roomRefId,
      userId,
      joinedAt: now,
      lastSeenAt: now,
    },
  });

  return now;
}

export async function getRoomOwnerPresence(
  roomRefId: string,
  ownerUserId: string | null | undefined,
): Promise<RoomOwnerPresence> {
  if (!ownerUserId) {
    return {
      active: false,
      lastSeenAt: null,
      timeoutMs: ROOM_OWNER_PRESENCE_TIMEOUT_MS,
    };
  }

  const membership = await prisma.roomParticipant.findUnique({
    where: {
      roomRefId_userId: {
        roomRefId,
        userId: ownerUserId,
      },
    },
    select: {
      lastSeenAt: true,
    },
  });

  const lastSeenAt = membership?.lastSeenAt ?? null;
  const active = isRoomParticipantActive(lastSeenAt, ROOM_OWNER_PRESENCE_TIMEOUT_MS);

  return {
    active,
    lastSeenAt,
    timeoutMs: ROOM_OWNER_PRESENCE_TIMEOUT_MS,
  };
}

export async function assertRoomOwnerActiveOrThrow(
  room: {
    id: string;
    createdById: string | null;
  },
  currentUserId: string,
) {
  if (!room.createdById || room.createdById === currentUserId) {
    return;
  }

  const ownerPresence = await getRoomOwnerPresence(room.id, room.createdById);
  if (ownerPresence.active) {
    return;
  }

  throw new RoomAccessError(409, "room owner is offline and the room is unavailable");
}
