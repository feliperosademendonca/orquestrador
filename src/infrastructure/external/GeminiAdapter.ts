import { config } from "../../config";

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
}

export class GeminiAdapter {
  private keyIndex = 0;

  async generate(prompt: string): Promise<string> {
    const trimmed = prompt.trim();
    if (!trimmed) {
      return "";
    }

    const keys = config.geminiApiKeys;
    if (!keys.length) {
      throw new Error("GEMINI_API_KEYS is not configured");
    }

    const key = keys[this.keyIndex % keys.length];
    this.keyIndex += 1;

    const url = `${config.geminiBaseUrl}/models/${config.geminiModel}:generateContent?key=${key}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: trimmed }],
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini error ${response.status}: ${errorText}`);
    }

    const data = (await response.json()) as GeminiResponse;
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error("Gemini response missing text");
    }

    return text;
  }

  async generateRoteiro(title: string, description: string): Promise<string> {
    const prompt = `Generate a roteiro for: ${title}. Context: ${description}`;
    return this.generate(prompt);
  }

  async generateScript(title: string, roteiro: string): Promise<string> {
    const prompt = `Generate a script for: ${title}. Roteiro: ${roteiro}`;
    return this.generate(prompt);
  }
}
