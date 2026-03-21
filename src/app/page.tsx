import DashboardPageClient from "@/components/dashboard-page/dashboard-page";
import { getCurrentUser } from "@/lib/auth";
import { getUserTranscriptionSettingsStatus } from "@/features/transcription/core/user-settings";
import { getUserProviderKeysMode } from "@/lib/env";
import { getUserLlmKeyStatus } from "@/lib/llm-provider-keys";
import { getUserLivekitCredentialStatus } from "@/lib/livekit-credentials";
import { prisma } from "@/lib/prisma";
import { getUserUsageSummary } from "@/lib/usage-stats";

export const dynamic = "force-dynamic";

type HomePageSearchParams = {
  auth?: string;
  next?: string;
};

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
  const userProviderKeysMode = getUserProviderKeysMode();
  const allowUserProviderKeys = userProviderKeysMode !== "false";
  const initialAuthMode = user ? null : normalizeAuthMode(params?.auth);
  const initialNextPath = normalizeNextPath(params?.next);

  if (!user) {
    return (
      <DashboardPageClient
        initialUser={null}
        initialCreatedRooms={[]}
        initialJoinedRooms={[]}
        initialLivekitStatus={null}
        initialTranscriptionStatus={null}
        initialLlmKeyStatus={null}
        initialUsageSummary={null}
        initialUserProviderKeysMode={userProviderKeysMode}
        initialAuthMode={initialAuthMode}
        initialNextPath={initialNextPath}
      />
    );
  }

  const [createdRooms, joinedRooms, livekitStatus, transcriptionStatus, llmKeyStatus, usageSummary] =
    await Promise.all([
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
      allowUserProviderKeys ? getUserLivekitCredentialStatus(user.id) : Promise.resolve(null),
      allowUserProviderKeys ? getUserTranscriptionSettingsStatus(user.id) : Promise.resolve(null),
      allowUserProviderKeys ? getUserLlmKeyStatus(user.id) : Promise.resolve(null),
      getUserUsageSummary(user.id),
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
      initialLivekitStatus={livekitStatus}
      initialTranscriptionStatus={transcriptionStatus}
      initialLlmKeyStatus={llmKeyStatus}
      initialUsageSummary={usageSummary}
      initialUserProviderKeysMode={userProviderKeysMode}
      initialAuthMode={initialAuthMode}
      initialNextPath={initialNextPath}
    />
  );
}
