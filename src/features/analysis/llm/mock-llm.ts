import {
  ConversationLlmProvider,
  ConversationLlmInvocation,
  ConversationLlmProviderResult,
} from "./types";

export class MockConversationLlmProvider implements ConversationLlmProvider {
  async invoke(invocation: ConversationLlmInvocation): Promise<ConversationLlmProviderResult> {
    // This debug provider intentionally echoes prompt/input for inspection.
    // Do not convert it into semantic analysis output.
    return {
      content: {
        mode: invocation.mode,
        style: invocation.style,
        prompt: invocation.prompt,
        input: invocation.input,
      },
      usage: null,
    };
  }
}
