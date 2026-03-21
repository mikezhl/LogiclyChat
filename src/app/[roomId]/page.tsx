import { redirect } from "next/navigation";

import RoomPageClient from "@/components/room-page/room-page";
import { getCurrentUser } from "@/lib/auth";
import { findAccessibleRoom } from "@/lib/rooms";
import { normalizeRoomId } from "@/lib/room-utils";

export const dynamic = "force-dynamic";

type RoomPageProps = {
  params: Promise<{
    roomId: string;
  }>;
};

export default async function RoomPage({ params }: RoomPageProps) {
  const user = await getCurrentUser();
  const { roomId: rawRoomId } = await params;
  const roomId = normalizeRoomId(rawRoomId);

  if (!user) {
    const nextPath = `/${encodeURIComponent(roomId || rawRoomId)}`;
    redirect(`/?auth=login&next=${encodeURIComponent(nextPath)}`);
  }

  if (!roomId) {
    redirect("/");
  }

  const room = await findAccessibleRoom(roomId, user.id);
  if (!room) {
    redirect("/");
  }

  return (
    <RoomPageClient
      roomId={room.roomId}
      initialRoomName={room.name}
      userId={user.id}
      username={user.username}
    />
  );
}
