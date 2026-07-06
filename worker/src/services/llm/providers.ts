import type { LLMProvider } from "./base";

export function parseOpenAIChatContent(raw: string): string {
  const text = raw.trim();
  if (!text.startsWith("data:")) {
    const data: any = JSON.parse(text);
    return data.choices?.[0]?.message?.content || "";
  }

  const chunks: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    const data: any = JSON.parse(payload);
    const content = data.choices?.[0]?.delta?.content ?? data.choices?.[0]?.message?.content ?? "";
    if (content) chunks.push(content);
  }
  return chunks.join("");
}

export class AnthropicProvider implements LLMProvider {
  name = "anthropic";
  private baseUrl: string;

  constructor(public model: string, private apiKey: string, baseUrl?: string) {
    this.baseUrl = (baseUrl || "https://api.anthropic.com/v1").replace(/\/$/, "");
  }

  private async complete(system: string, user: string): Promise<string> {
    const res = await fetch(`${this.baseUrl}/messages`, {
      method: "POST",
      signal: AbortSignal.timeout(90000),
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

export class GeminiProvider implements LLMProvider {
  name = "gemini";
  private baseUrl: string;

  constructor(public model: string, private apiKey: string, baseUrl?: string) {
    this.baseUrl = (baseUrl || "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
  }

  private async generate(system: string, user: string, jsonMode: boolean): Promise<string> {
    const url = `${this.baseUrl}/models/${encodeURIComponent(this.model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`;
    const body: any = {
      contents: [
        {
          role: "user",
          parts: [{ text: `${system}\n\n${user}` }],
        },
      ],
      generationConfig: {
        temperature: jsonMode ? 0 : 0.3,
      },
    };
    if (jsonMode) body.generationConfig.responseMimeType = "application/json";

    const res = await fetch(url, {
      method: "POST",
      signal: AbortSignal.timeout(90000),
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Gemini API lỗi ${res.status}: ${await res.text()}`);
    }
    const data: any = await res.json();
    return (data.candidates?.[0]?.content?.parts || [])
      .map((part: any) => part.text || "")
      .join("");
  }

  completeJson(system: string, user: string): Promise<string> {
    return this.generate(system, user, true);
  }

  completeText(system: string, user: string): Promise<string> {
    return this.generate(system, user, false);
  }
}

export class OpenAIProvider implements LLMProvider {
  name = "openai";
  private baseUrl: string;

  constructor(public model: string, private apiKey: string, baseUrl?: string, name?: string) {
    this.baseUrl = (baseUrl || "https://api.openai.com/v1").replace(/\/$/, "");
    if (name) this.name = name;
    else if (baseUrl) this.name = "openai_compatible";
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
      signal: AbortSignal.timeout(90000),
      headers: {
        Authorization: `Bearer ${this.apiKey || "not-needed"}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`OpenAI API lỗi ${res.status}: ${await res.text()}`);
    }
    return parseOpenAIChatContent(await res.text());
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
  opts: {
    anthropicKey?: string;
    openaiKey?: string;
    baseUrl?: string;
    llmViaxKey?: string;
    llmViaxBaseUrl?: string;
  }
): LLMProvider | null {
  const p = (provider || "").toLowerCase();
  if (p === "anthropic" && opts.anthropicKey) return new AnthropicProvider(model, opts.anthropicKey, opts.baseUrl);
  if (p === "gemini" && opts.openaiKey) return new GeminiProvider(model, opts.openaiKey, opts.baseUrl);
  if (p === "openai" && opts.openaiKey) return new OpenAIProvider(model, opts.openaiKey);
  if ((p === "openai_compatible" || p === "custom") && (opts.openaiKey || opts.baseUrl)) {
    return new OpenAIProvider(model, opts.openaiKey || "", opts.baseUrl, p === "custom" ? "custom" : undefined);
  }
  if (p === "llm_viax" && (opts.llmViaxKey || opts.llmViaxBaseUrl)) {
    return new OpenAIProvider(model, opts.llmViaxKey || "", opts.llmViaxBaseUrl, "llm_viax");
  }
  return null;
}
