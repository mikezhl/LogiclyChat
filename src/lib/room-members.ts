import {
  ROOM_PARTICIPANT_PRESENCE_TIMEOUT_MS,
  isRoomParticipantActive,
} from "@/lib/room-presence";
import { prisma } from "@/lib/prisma";
import { RoomAccessError } from "@/lib/rooms";

export const ROOM_PARTICIPATION_ERROR =
  "only the first two room members can participate; later members are read-only";
const ROOM_ACTIVE_DEBATER_LIMIT = 2;

export type RoomDebateSlot = "A" | "B" | null;

export type RoomMemberSnapshot = {
  userId: string;
  username: string;
  joinedAt: Date;
  lastSeenAt: Date | null;
  isOwner: boolean;
  isOnline: boolean;
  debateSlot: RoomDebateSlot;
  canParticipate: boolean;
};

export async function listRoomMembers(
  roomRefId: string,
  ownerUserId: string | null | undefined,
): Promise<RoomMemberSnapshot[]> {
  const participants = await prisma.roomParticipant.findMany({
    where: {
      roomRefId,
    },
    include: {
      user: {
        select: {
          username: true,
        },
      },
    },
    orderBy: [{ joinedAt: "asc" }, { id: "asc" }],
  });

  const debateSlotByUserId = new Map<string, RoomDebateSlot>();
  participants.slice(0, ROOM_ACTIVE_DEBATER_LIMIT).forEach((participant, index) => {
    debateSlotByUserId.set(participant.userId, index === 0 ? "A" : "B");
  });

  return participants
    .map((participant) => {
      const debateSlot = debateSlotByUserId.get(participant.userId) ?? null;

      return {
        userId: participant.userId,
        username: participant.user.username,
        joinedAt: participant.joinedAt,
        lastSeenAt: participant.lastSeenAt,
        isOwner: Boolean(ownerUserId) && participant.userId === ownerUserId,
        isOnline: isRoomParticipantActive(
          participant.lastSeenAt,
          ROOM_PARTICIPANT_PRESENCE_TIMEOUT_MS,
        ),
        debateSlot,
        canParticipate: debateSlot !== null,
      };
    })
    .sort((left, right) => {
      if (left.isOwner !== right.isOwner) {
        return left.isOwner ? -1 : 1;
      }

      const joinedAtDelta = left.joinedAt.getTime() - right.joinedAt.getTime();
      if (joinedAtDelta !== 0) {
        return joinedAtDelta;
      }

      return left.userId.localeCompare(right.userId);
    });
}

export async function getRoomParticipationSnapshot(
  roomRefId: string,
  ownerUserId: string | null | undefined,
  userId: string,
) {
  const members = await listRoomMembers(roomRefId, ownerUserId);
  const currentUser = members.find((member) => member.userId === userId) ?? null;

  return {
    members,
    currentUser,
    canParticipate: currentUser?.canParticipate ?? false,
  };
}

export async function assertRoomUserCanParticipate(
  roomRefId: string,
  ownerUserId: string | null | undefined,
  userId: string,
) {
  const participation = await getRoomParticipationSnapshot(roomRefId, ownerUserId, userId);
  if (participation.canParticipate) {
    return participation;
  }

  throw new RoomAccessError(403, ROOM_PARTICIPATION_ERROR);
}
