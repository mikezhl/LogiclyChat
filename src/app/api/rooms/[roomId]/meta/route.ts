import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/auth-guard";
import { RoomAccessError, buildRoomRuntimeInfo } from "@/lib/rooms";
import { normalizeRoomId } from "@/lib/room-utils";

type RouteContext = {
  params: Promise<{
    roomId: string;
  }>;
};

export const runtime = "nodejs";

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { user, unauthorizedResponse } = await requireApiUser();
    if (!user) {
      return unauthorizedResponse!;
    }

    const { roomId: rawRoomId } = await context.params;
    const roomId = normalizeRoomId(rawRoomId);
    if (!roomId) {
      return NextResponse.json({ error: "roomId is required" }, { status: 400 });
    }

    const runtimeInfo = await buildRoomRuntimeInfo(roomId, user.id);
    return NextResponse.json({
      room: {
        roomId: runtimeInfo.room.roomId,
        status: runtimeInfo.room.status,
        endedAt: runtimeInfo.room.endedAt?.toISOString() ?? null,
        isCreator: runtimeInfo.isCreator,
      },
      providers: runtimeInfo.providers,
    });
  } catch (error) {
    if (error instanceof RoomAccessError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to fetch room metadata";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
