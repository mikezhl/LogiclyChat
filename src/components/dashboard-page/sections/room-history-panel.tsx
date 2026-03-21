import Link from "next/link";

import { getRoomDisplayName } from "@/lib/room-name";
import { type UiLanguage } from "@/lib/ui-language";

import {
  formatDate,
  roomStatusLabel,
  type DashboardTranslate,
  type RoomSummary,
} from "../dashboard-page-support";

type RoomHistoryPanelProps = {
  createdRooms: RoomSummary[];
  dashboardLoading: boolean;
  hasHistory: boolean;
  isAuthenticated: boolean;
  joinedRooms: RoomSummary[];
  language: UiLanguage;
  onRefresh: () => Promise<void>;
  t: DashboardTranslate;
};

type RoomHistoryItemProps = {
  detailLabel: string;
  detailValue: string;
  language: UiLanguage;
  room: RoomSummary;
  t: DashboardTranslate;
};

function RoomHistoryItem({ detailLabel, detailValue, language, room, t }: RoomHistoryItemProps) {
  const roomDisplayName = getRoomDisplayName(room.roomName, room.roomId);
  const showRoomCode = Boolean(room.roomName);

  return (
    <li>
      <Link
        className="room-list-item"
        href={`/${encodeURIComponent(room.roomId)}`}
        aria-label={`${t("进入房间", "Open room")} ${roomDisplayName}${showRoomCode ? ` (${room.roomId})` : ""}`}
      >
        <div className="room-list-item-copy">
          <div className="room-list-item-head">
            <strong>{roomDisplayName}</strong>
            <span className="room-list-status" data-status={room.status}>
              {roomStatusLabel(room.status, language)}
            </span>
          </div>

          {showRoomCode ? (
            <p className="room-list-code">
              {t("房间代码", "Room code")}: {room.roomId}
            </p>
          ) : null}
          <p>
            {t("成员", "Members")}: {room.participantCount} | {t("消息", "Messages")}: {room.messageCount}
          </p>
          <p>
            {detailLabel}: {detailValue}
          </p>
        </div>
      </Link>
    </li>
  );
}

export function RoomHistoryPanel({
  createdRooms,
  dashboardLoading,
  hasHistory,
  isAuthenticated,
  joinedRooms,
  language,
  onRefresh,
  t,
}: RoomHistoryPanelProps) {
  return (
    <details className="minimal-details">
      <summary>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span>{t("查看历史房间", "Room History")}</span>
          {isAuthenticated ? (
            <button
              type="button"
              title={t("刷新历史", "Refresh history")}
              style={{
                padding: "4px",
                background: "transparent",
                border: "none",
                color: "var(--muted)",
                cursor: dashboardLoading ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                opacity: dashboardLoading ? 0.5 : 1,
                transition: "opacity 0.2s, color 0.2s",
                borderRadius: "4px",
              }}
              onMouseEnter={(event) => {
                event.currentTarget.style.color = "var(--foreground)";
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.color = "var(--muted)";
              }}
              onClick={(event) => {
                event.preventDefault();
                if (!dashboardLoading) {
                  void onRefresh();
                }
              }}
              disabled={dashboardLoading}
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
                <path d="M21 3v5h-5" />
              </svg>
            </button>
          ) : null}
        </div>
      </summary>

      {!isAuthenticated ? (
        <div className="details-content">
          <p className="panel-tip">
            {t("登录后可查看你创建和参与的房间记录。", "Sign in to view rooms you created or joined.")}
          </p>
        </div>
      ) : (
        <div className="details-content room-history-details">
          {!hasHistory ? (
            <p className="panel-tip">{t("暂无历史房间。", "No room history yet.")}</p>
          ) : (
            <>
              <div className="history-group">
                <h3>{t("我创建的房间", "Rooms I Created")}</h3>
                {createdRooms.length === 0 ? (
                  <p className="panel-tip">{t("暂无记录。", "No records.")}</p>
                ) : (
                  <ul className="room-list">
                    {createdRooms.map((room) => (
                      <RoomHistoryItem
                        key={`created-${room.roomId}`}
                        detailLabel={t("创建", "Created")}
                        detailValue={formatDate(room.createdAt, language)}
                        language={language}
                        room={room}
                        t={t}
                      />
                    ))}
                  </ul>
                )}
              </div>

              <div className="history-group">
                <h3>{t("我参与的房间", "Rooms I Joined")}</h3>
                {joinedRooms.length === 0 ? (
                  <p className="panel-tip">{t("暂无记录。", "No records.")}</p>
                ) : (
                  <ul className="room-list">
                    {joinedRooms.map((room) => (
                      <RoomHistoryItem
                        key={`joined-${room.roomId}`}
                        detailLabel={t("最近加入", "Last joined")}
                        detailValue={formatDate(room.joinedAt ?? room.updatedAt, language)}
                        language={language}
                        room={room}
                        t={t}
                      />
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </details>
  );
}
