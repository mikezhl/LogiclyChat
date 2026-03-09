import DashboardPageClient from "@/components/dashboard-page-client";
import { getCurrentUser } from "@/lib/auth";
import { getUserLlmKeyStatus } from "@/lib/llm-provider-keys";
import { getUserKeyStatus } from "@/lib/provider-keys";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type HomePageSearchParams = {
  auth?: string;
  next?: string;
};

function toRoomSummary(room: {
  roomId: string;
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
    status: room.status,
    createdAt: room.createdAt.toISOString(),
    updatedAt: room.updatedAt.toISOString(),
    endedAt: room.endedAt?.toISOString() ?? null,
    participantCount: room._count.participants,
    messageCount: room._count.messages,
  };
}

function normalizeAuthMode(mode?: string) {
  if (mode === "login" || mode === "register") {
    return mode;
  }
  return null;
}

function normalizeNextPath(path?: string) {
  if (!path || !path.startsWith("/")) {
    return null;
  }
  return path;
}

type HomePageProps = {
  searchParams: Promise<HomePageSearchParams>;
};

export default async function HomePage({ searchParams }: HomePageProps) {
  const params = await searchParams;
  const user = await getCurrentUser();
  const initialAuthMode = user ? null : normalizeAuthMode(params?.auth);
  const initialNextPath = normalizeNextPath(params?.next);

  if (!user) {
    return (
      <DashboardPageClient
        initialUser={null}
        initialCreatedRooms={[]}
        initialJoinedRooms={[]}
        initialKeyStatus={null}
        initialLlmKeyStatus={null}
        initialAuthMode={initialAuthMode}
        initialNextPath={initialNextPath}
      />
    );
  }

  const [createdRooms, joinedRooms, keyStatus, llmKeyStatus] = await Promise.all([
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
    getUserKeyStatus(user.id),
    getUserLlmKeyStatus(user.id),
  ]);

  return (
    <DashboardPageClient
      initialUser={{
        id: user.id,
        username: user.username,
      }}
      initialCreatedRooms={createdRooms.map(toRoomSummary)}
      initialJoinedRooms={joinedRooms.map((entry) => ({
        ...toRoomSummary(entry.room),
        joinedAt: entry.joinedAt.toISOString(),
      }))}
      initialKeyStatus={keyStatus}
      initialLlmKeyStatus={llmKeyStatus}
      initialAuthMode={initialAuthMode}
      initialNextPath={initialNextPath}
    />
  );
}
