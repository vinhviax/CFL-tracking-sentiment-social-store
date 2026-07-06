import type { LLMProvider } from "./base";

export class AnthropicProvider implements LLMProvider {
  name = "anthropic";
  constructor(public model: string, private apiKey: string) {}

  private async complete(system: string, user: string): Promise<string> {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 8000,
        system,
        messages: [{ role: "user", content: user }],
      }),
    });
    if (!res.ok) {
      throw new Error(`Anthropic API lỗi ${res.status}: ${await res.text()}`);
    }
    const data: any = await res.json();
    return (data.content || [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("");
  }

  completeJson(system: string, user: string): Promise<string> {
    return this.complete(system, user);
  }
  completeText(system: string, user: string): Promise<string> {
    return this.complete(system, user);
  }
}

export class OpenAIProvider implements LLMProvider {
  name = "openai";
  private baseUrl: string;

  constructor(public model: string, private apiKey: string, baseUrl?: string) {
    this.baseUrl = (baseUrl || "https://api.openai.com/v1").replace(/\/$/, "");
    if (baseUrl) this.name = "openai_compatible";
  }

  private async chat(system: string, user: string, jsonMode: boolean): Promise<string> {
    const body: any = {
      model: this.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: jsonMode ? 0 : 0.3,
    };
    if (jsonMode) body.response_format = { type: "json_object" };

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey || "not-needed"}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`OpenAI API lỗi ${res.status}: ${await res.text()}`);
    }
    const data: any = await res.json();
    return data.choices?.[0]?.message?.content || "";
  }

  completeJson(system: string, user: string): Promise<string> {
    return this.chat(system, user, true);
  }
  completeText(system: string, user: string): Promise<string> {
    return this.chat(system, user, false);
  }
}

export function buildProvider(
  provider: string,
  model: string,
  opts: { anthropicKey?: string; openaiKey?: string; baseUrl?: string }
): LLMProvider | null {
  const p = (provider || "").toLowerCase();
  if (p === "anthropic" && opts.anthropicKey) return new AnthropicProvider(model, opts.anthropicKey);
  if (p === "openai" && opts.openaiKey) return new OpenAIProvider(model, opts.openaiKey);
  if (p === "openai_compatible" && (opts.openaiKey || opts.baseUrl)) {
    return new OpenAIProvider(model, opts.openaiKey || "", opts.baseUrl);
  }
  return null;
}
