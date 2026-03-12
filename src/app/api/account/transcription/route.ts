import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/auth-guard";
import {
  clearUserTranscriptionProviderCredentials,
  getUserTranscriptionSettingsStatus,
  normalizeRequestedDefaultProvider,
  saveUserTranscriptionProviderCredentials,
  setUserDefaultTranscriptionProvider,
} from "@/features/transcription/core/user-settings";

type SaveTranscriptionRequest =
  | {
      action?: "save";
      provider?: string;
      apiKey?: string;
    }
  | {
      action: "clear";
      provider?: string;
    }
  | {
      action: "set-default";
      provider?: string | null;
    };

export const runtime = "nodejs";

export async function GET() {
  try {
    const { user, unauthorizedResponse } = await requireApiUser();
    if (!user) {
      return unauthorizedResponse!;
    }

    const status = await getUserTranscriptionSettingsStatus(user.id);
    return NextResponse.json({ status });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load transcription provider settings";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { user, unauthorizedResponse } = await requireApiUser();
    if (!user) {
      return unauthorizedResponse!;
    }

    const body = (await request.json()) as SaveTranscriptionRequest;
    const action = body.action ?? "save";

    if (action === "set-default") {
      const provider = normalizeRequestedDefaultProvider(body.provider);
      const status = await setUserDefaultTranscriptionProvider(user.id, provider);
      return NextResponse.json({ status });
    }

    const provider = normalizeRequestedDefaultProvider(body.provider);
    if (!provider) {
      return NextResponse.json({ error: "provider is required" }, { status: 400 });
    }

    const apiKey = "apiKey" in body ? body.apiKey?.trim() ?? "" : "";
    const status =
      action === "clear"
        ? await clearUserTranscriptionProviderCredentials(user.id, provider)
        : await saveUserTranscriptionProviderCredentials(user.id, provider, {
            apiKey,
          });

    return NextResponse.json({ status });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to save transcription provider settings";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
