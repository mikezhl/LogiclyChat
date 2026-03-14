import { RoomStatus } from "@prisma/client";
import { NextResponse } from "next/server";

import { advanceRealtimeAnalysisCursorToLatestConversationMessage } from "@/features/analysis/service/analysis-control";
import { requireApiUser } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { normalizeRoomId } from "@/lib/room-utils";

type RouteContext = {
  params: Promise<{
    roomId: string;
  }>;
};

type UpdateRoomAnalysisRequest = {
  enabled?: boolean;
};

export const runtime = "nodejs";

export async function POST(request: Request, context: RouteContext) {
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

    const body = (await request.json()) as UpdateRoomAnalysisRequest;
    if (typeof body?.enabled !== "boolean") {
      return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
    }

    const room = await prisma.room.findUnique({
      where: { roomId },
      select: {
        id: true,
        roomId: true,
        status: true,
        createdById: true,
        analysisEnabled: true,
      },
    });

    if (!room) {
      return NextResponse.json({ error: "room not found" }, { status: 404 });
    }

    if (room.createdById !== user.id) {
      return NextResponse.json({ error: "only room creator can update analysis settings" }, { status: 403 });
    }

    if (room.status === RoomStatus.ENDED) {
      return NextResponse.json({ error: "room has ended" }, { status: 403 });
    }

    const updated = await prisma.room.update({
      where: { id: room.id },
      data: {
        analysisEnabled: body.enabled,
      },
      select: {
        roomId: true,
        analysisEnabled: true,
      },
    });

    if (!updated.analysisEnabled) {
      await advanceRealtimeAnalysisCursorToLatestConversationMessage(room.id);
    }

    return NextResponse.json({
      room: updated,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update analysis settings";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
