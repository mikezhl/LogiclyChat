import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { type Room } from "livekit-client";

import {
  type RoomConnectionState,
  type RoomPageTranslate,
} from "./room-page-support";

type UseRoomMicrophoneArgs = {
  connectionState: RoomConnectionState;
  micEnabled: boolean;
  onError: (message: string) => void;
  roomRef: RefObject<Room | null>;
  t: RoomPageTranslate;
};

export function useRoomMicrophone({
  connectionState,
  micEnabled,
  onError,
  roomRef,
  t,
}: UseRoomMicrophoneArgs) {
  const [micDevices, setMicDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedMicId, setSelectedMicId] = useState("");
  const [micSelectorOpen, setMicSelectorOpen] = useState(false);
  const [micVolume, setMicVolume] = useState(0);

  const micAudioContextRef = useRef<AudioContext | null>(null);
  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const micVolumeRafRef = useRef<number | null>(null);
  const micMonitorStreamRef = useRef<MediaStream | null>(null);

  const stopVolumeMonitor = useCallback(() => {
    if (micVolumeRafRef.current !== null) {
      cancelAnimationFrame(micVolumeRafRef.current);
      micVolumeRafRef.current = null;
    }
    micSourceRef.current?.disconnect();
    micSourceRef.current = null;
    micAnalyserRef.current = null;
    if (micAudioContextRef.current) {
      void micAudioContextRef.current.close().catch(() => undefined);
      micAudioContextRef.current = null;
    }
    if (micMonitorStreamRef.current) {
      micMonitorStreamRef.current.getTracks().forEach((track) => track.stop());
      micMonitorStreamRef.current = null;
    }
    setMicVolume(0);
  }, []);

  const startVolumeMonitor = useCallback(async (deviceId: string) => {
    stopVolumeMonitor();
    try {
      const constraints: MediaStreamConstraints = {
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      micMonitorStreamRef.current = stream;
      const ctx = new AudioContext();
      micAudioContextRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      micAnalyserRef.current = analyser;
      const source = ctx.createMediaStreamSource(stream);
      micSourceRef.current = source;
      source.connect(analyser);

      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        if (!micAnalyserRef.current) {
          return;
        }
        micAnalyserRef.current.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;
        setMicVolume(Math.min(1, avg / 80));
        micVolumeRafRef.current = requestAnimationFrame(tick);
      };
      micVolumeRafRef.current = requestAnimationFrame(tick);
    } catch {
      // Passive monitoring should fail silently if the browser blocks device access.
    }
  }, [stopVolumeMonitor]);

  const loadMicDevices = useCallback(async () => {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
        stream.getTracks().forEach((track) => track.stop());
      });
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter((device) => device.kind === "audioinput");
      setMicDevices(audioInputs);
      setSelectedMicId((prev) => {
        if (prev && audioInputs.some((device) => device.deviceId === prev)) {
          return prev;
        }
        return audioInputs[0]?.deviceId ?? "";
      });
    } catch {
      // Delay device errors until the user explicitly tries to start voice.
    }
  }, []);

  const prepareMicrophoneForCall = useCallback(async () => {
    try {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
        throw new Error(
          t("当前环境不支持麦克风设备", "Microphone devices are not available in this environment"),
        );
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());

      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter((device) => device.kind === "audioinput");
      const activeRoom = roomRef.current;
      const roomDeviceId = activeRoom?.getActiveDevice("audioinput")?.trim() ?? "";
      const nextSelectedDeviceId =
        [selectedMicId, roomDeviceId].find(
          (deviceId) => deviceId && audioInputs.some((device) => device.deviceId === deviceId),
        ) ?? audioInputs[0]?.deviceId ?? "";

      setMicDevices(audioInputs);
      setSelectedMicId(nextSelectedDeviceId);

      if (!nextSelectedDeviceId) {
        throw new Error(t("未找到可用麦克风", "No microphone available"));
      }

      return nextSelectedDeviceId;
    } catch (error) {
      if (error instanceof DOMException) {
        if (error.name === "NotAllowedError") {
          throw new Error(t("麦克风权限被拒绝", "Microphone access was denied"));
        }
        if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
          throw new Error(t("未找到可用麦克风", "No microphone available"));
        }
        if (error.name === "NotReadableError" || error.name === "AbortError") {
          throw new Error(
            t(
              "麦克风正在被其他应用占用或暂时不可用",
              "The microphone is busy or unavailable",
            ),
          );
        }
      }

      throw error;
    }
  }, [roomRef, selectedMicId, t]);

  const selectMic = useCallback((deviceId: string) => {
    setSelectedMicId(deviceId);
    void startVolumeMonitor(deviceId);

    const activeRoom = roomRef.current;
    if (!activeRoom || connectionState !== "connected") {
      return;
    }

    void activeRoom.switchActiveDevice("audioinput", deviceId).catch((error) => {
      onError(error instanceof Error ? error.message : t("切换麦克风失败", "Failed to switch microphone"));
    });
  }, [connectionState, onError, roomRef, startVolumeMonitor, t]);

  const toggleMicSelector = useCallback(() => {
    setMicSelectorOpen((open) => {
      if (!open) {
        void loadMicDevices();
      } else {
        stopVolumeMonitor();
      }
      return !open;
    });
  }, [loadMicDevices, stopVolumeMonitor]);

  const closeMicSelector = useCallback(() => {
    setMicSelectorOpen(false);
    stopVolumeMonitor();
  }, [stopVolumeMonitor]);

  useEffect(() => {
    if (micEnabled && selectedMicId) {
      void startVolumeMonitor(selectedMicId);
      return;
    }

    stopVolumeMonitor();
  }, [micEnabled, selectedMicId, startVolumeMonitor, stopVolumeMonitor]);

  useEffect(() => {
    return () => {
      stopVolumeMonitor();
    };
  }, [stopVolumeMonitor]);

  return {
    closeMicSelector,
    micDevices,
    micSelectorOpen,
    micVolume,
    prepareMicrophoneForCall,
    selectedMicId,
    selectMic,
    toggleMicSelector,
  };
}
