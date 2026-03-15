import { DataPacket_Kind, RoomServiceClient } from "livekit-server-sdk";

import { ChatMessage } from "./chat-types";
import {
  createLivekitChatMessageEvent,
  encodeLivekitChatMessageEvent,
  LIVEKIT_CHAT_MESSAGE_TOPIC,
} from "./livekit-chat-event";
import {
  createLivekitTranscriptionStatusEvent,
  encodeLivekitTranscriptionStatusEvent,
  type LivekitTranscriptionStatus,
  LIVEKIT_TRANSCRIPTION_STATUS_TOPIC,
} from "./livekit-transcription-status-event";

export type LivekitRoomServiceCredentials = {
  livekitUrl: string;
  livekitApiKey: string;
  livekitApiSecret: string;
};

export function createRoomServiceClient(credentials: LivekitRoomServiceCredentials) {
  return new RoomServiceClient(
    credentials.livekitUrl,
    credentials.livekitApiKey,
    credentials.livekitApiSecret,
  );
}

export async function publishChatMessageViaLivekit(
  roomServiceClient: RoomServiceClient,
  roomId: string,
  message: ChatMessage,
) {
  const packet = encodeLivekitChatMessageEvent(createLivekitChatMessageEvent(roomId, message));
  await roomServiceClient.sendData(roomId, packet, DataPacket_Kind.RELIABLE, {
    topic: LIVEKIT_CHAT_MESSAGE_TOPIC,
  });
}

export async function publishTranscriptionStatusViaLivekit(
  roomServiceClient: RoomServiceClient,
  roomId: string,
  participantIdentity: string,
  status: LivekitTranscriptionStatus,
  trackSid: string | null,
  reason?: string | null,
) {
  const packet = encodeLivekitTranscriptionStatusEvent(
    createLivekitTranscriptionStatusEvent(roomId, participantIdentity, status, trackSid, reason),
  );
  await roomServiceClient.sendData(roomId, packet, DataPacket_Kind.RELIABLE, {
    topic: LIVEKIT_TRANSCRIPTION_STATUS_TOPIC,
  });
}
