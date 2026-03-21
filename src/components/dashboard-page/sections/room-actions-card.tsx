import { type FormEvent } from "react";

import { type DashboardTranslate, type RoomAction } from "../dashboard-page-support";

type RoomActionsCardProps = {
  onCreateRoom: () => Promise<void>;
  onJoinRoom: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onRoomIdToJoinChange: (value: string) => void;
  roomActionError: string;
  roomActionLoading: RoomAction | null;
  roomIdToJoin: string;
  t: DashboardTranslate;
};

export function RoomActionsCard({
  onCreateRoom,
  onJoinRoom,
  onRoomIdToJoinChange,
  roomActionError,
  roomActionLoading,
  roomIdToJoin,
  t,
}: RoomActionsCardProps) {
  return (
    <section className="minimal-main-card">
      <div className="room-quick-actions">
        <button
          type="button"
          className="primary-btn large-btn"
          disabled={roomActionLoading !== null}
          onClick={() => void onCreateRoom()}
        >
          {roomActionLoading === "create" ? t("创建中...", "Creating...") : t("创建房间", "Create Room")}
        </button>

        <form className="join-room-form" onSubmit={(event) => void onJoinRoom(event)}>
          <input
            value={roomIdToJoin}
            onChange={(event) => onRoomIdToJoinChange(event.target.value)}
            placeholder={t("输入已有房间号", "Enter an existing room ID")}
          />
          <button type="submit" className="primary-btn large-btn" disabled={roomActionLoading !== null}>
            {roomActionLoading === "join" ? t("加入中...", "Joining...") : t("加入", "Join")}
          </button>
        </form>
      </div>

      {roomActionError ? <p className="form-error">{roomActionError}</p> : null}
    </section>
  );
}
