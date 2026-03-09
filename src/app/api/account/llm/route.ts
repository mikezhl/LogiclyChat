import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/auth-guard";
import { getUserLlmKeyStatus, upsertUserLlmKeys } from "@/lib/llm-provider-keys";

type SaveLlmKeysRequest = {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  clear?: boolean;
};

export const runtime = "nodejs";

export async function GET() {
  try {
    const { user, unauthorizedResponse } = await requireApiUser();
    if (!user) {
      return unauthorizedResponse!;
    }

    const status = await getUserLlmKeyStatus(user.id);
    return NextResponse.json({ status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load LLM settings";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { user, unauthorizedResponse } = await requireApiUser();
    if (!user) {
      return unauthorizedResponse!;
    }

    const body = (await request.json()) as SaveLlmKeysRequest;
    const status =
      body.clear === true
        ? await upsertUserLlmKeys(user.id, null)
        : await upsertUserLlmKeys(user.id, {
            baseUrl: body.baseUrl?.trim() ?? "",
            apiKey: body.apiKey?.trim() ?? "",
            model: body.model?.trim() ?? "",
          });

    return NextResponse.json({ status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save LLM settings";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
