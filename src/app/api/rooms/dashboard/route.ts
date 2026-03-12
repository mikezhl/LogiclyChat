import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { getUserUsageSummary } from "@/lib/usage-stats";

export const runtime = "nodejs";

function toRoomSummary(room: {
  roomId: string;
  name: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  endedAt: Date | null;
  _count: {
    participants: number;
    messages: number;
  };
}) {
  return {
    roomId: room.roomId,
    roomName: room.name,
    status: room.status,
    createdAt: room.createdAt.toISOString(),
    updatedAt: room.updatedAt.toISOString(),
    endedAt: room.endedAt?.toISOString() ?? null,
    participantCount: room._count.participants,
    messageCount: room._count.messages,
  };
}

export async function GET() {
  try {
    const { user, unauthorizedResponse } = await requireApiUser();
    if (!user) {
      return unauthorizedResponse!;
    }

    const [createdRooms, joinedMemberships, usage] = await Promise.all([
      prisma.room.findMany({
        where: {
          createdById: user.id,
        },
        include: {
          _count: {
            select: {
              participants: true,
              messages: true,
            },
          },
        },
        orderBy: {
          updatedAt: "desc",
        },
      }),
      prisma.roomParticipant.findMany({
        where: {
          userId: user.id,
          room: {
            createdById: {
              not: user.id,
            },
          },
        },
        include: {
          room: {
            include: {
              _count: {
                select: {
                  participants: true,
                  messages: true,
                },
              },
            },
          },
        },
        orderBy: {
          lastSeenAt: "desc",
        },
      }),
      getUserUsageSummary(user.id),
    ]);

    return NextResponse.json({
      createdRooms: createdRooms.map(toRoomSummary),
      joinedRooms: joinedMemberships.map((membership) => ({
        ...toRoomSummary(membership.room),
        joinedAt: membership.joinedAt.toISOString(),
      })),
      usage,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch dashboard rooms";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
