import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/auth-guard";
import {
  getUserLivekitCredentialStatus,
  upsertUserLivekitCredentials,
} from "@/lib/livekit-credentials";

type SaveLivekitRequest = {
  livekitUrl?: string;
  livekitApiKey?: string;
  livekitApiSecret?: string;
  clear?: boolean;
};

export const runtime = "nodejs";

export async function GET() {
  try {
    const { user, unauthorizedResponse } = await requireApiUser();
    if (!user) {
      return unauthorizedResponse!;
    }

    const status = await getUserLivekitCredentialStatus(user.id);
    return NextResponse.json({ status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load LiveKit settings";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { user, unauthorizedResponse } = await requireApiUser();
    if (!user) {
      return unauthorizedResponse!;
    }

    const body = (await request.json()) as SaveLivekitRequest;
    const status =
      body.clear === true
        ? await upsertUserLivekitCredentials(user.id, null)
        : await upsertUserLivekitCredentials(user.id, {
            livekitUrl: body.livekitUrl?.trim() ?? "",
            livekitApiKey: body.livekitApiKey?.trim() ?? "",
            livekitApiSecret: body.livekitApiSecret?.trim() ?? "",
          });

    return NextResponse.json({ status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save LiveKit settings";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
