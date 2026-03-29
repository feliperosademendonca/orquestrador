import { GoogleGenAI } from "@google/genai";
import { config } from "../../config";
import type { ITtsProvider, TtsOptions, TtsResult } from "../../application/interfaces/ITtsProvider";
import { ApiKeyRotator } from "../utils/ApiKeyRotator";

export class GeminiTtsAdapter implements ITtsProvider {
  private ai: GoogleGenAI;
  private readonly keyRotator: ApiKeyRotator;

  constructor() {
    const keys = config.geminiApiKeys && config.geminiApiKeys.length > 0
      ? config.geminiApiKeys
      : [config.googleApiKey].filter(Boolean) as string[];

    if (keys.length === 0) {
      throw new Error("GEMINI_API_KEYS ou GOOGLE_API_KEY não configurada para Gemini TTS");
    }

    this.keyRotator = new ApiKeyRotator(keys);
    const apiKey = keys[0];
    this.ai = new GoogleGenAI({ apiKey });
  }

  async synthesize(text: string, options?: TtsOptions): Promise<TtsResult> {
    let lastError: unknown;
    const maxAttempts = Math.max(1, this.keyRotator.getKeyCount());

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        if (attempt > 0) {
          const nextKey = this.keyRotator.getNext();
          this.ai = new GoogleGenAI({ apiKey: nextKey });
          console.log(`[GeminiTtsAdapter] Rotacionando API key (tentativa ${attempt + 1}/${maxAttempts})`);
        }

      const languageCode = options?.languageCode ?? "pt-BR";
      const ttsPrompt = this.buildLocalizedTtsPrompt(text, languageCode, options);

      const result = await this.ai.models.generateContent({
        model: config.geminiTtsModel,
        contents: [{ parts: [{ text: ttsPrompt }] }],
        config: {
          responseModalities: ["AUDIO"],
        },
      });

      const parts = result.candidates?.[0]?.content?.parts ?? [];
      const audioPart = parts.find((part: any) => part?.inlineData?.data);
      const audioContentBase64 = audioPart?.inlineData?.data;
      const mimeType = audioPart?.inlineData?.mimeType as string | undefined;

      if (!audioContentBase64) {
        throw new Error("Gemini TTS returned empty audio content");
      }

      const audioContent = Buffer.from(audioContentBase64, "base64");

      // Gemini TTS costuma retornar PCM bruto (audio/L16). Empacotamos em WAV.
      if (mimeType?.toLowerCase().includes("audio/l16")) {
        const sampleRate = this.extractSampleRate(mimeType) ?? 24000;
        const wav = this.wrapPcm16MonoToWav(audioContent, sampleRate);
        return {
          audioContent: wav,
          mimeType: "audio/wav",
        };
      }

      return {
        audioContent,
        mimeType,
      };
      } catch (error: any) {
        lastError = error;
        const statusCode = error?.status || error?.statusCode;
        const isQuotaError = statusCode === 429 || error?.message?.includes("RESOURCE_EXHAUSTED");

        console.error("[GeminiTtsAdapter] Erro ao sintetizar com Gemini TTS:", error?.message || error);

        if (!isQuotaError) {
          throw error;
        }
      }
    }

    throw lastError ?? new Error("Gemini TTS failed after key rotation attempts");
  }

  private extractSampleRate(mimeType: string): number | undefined {
    const match = /rate=(\d+)/i.exec(mimeType);
    if (!match) return undefined;
    const parsed = Number.parseInt(match[1], 10);
    return Number.isNaN(parsed) ? undefined : parsed;
  }

  private wrapPcm16MonoToWav(pcmData: Buffer, sampleRate: number): Buffer {
    const channels = 1;
    const bitsPerSample = 16;
    const blockAlign = (channels * bitsPerSample) / 8;
    const byteRate = sampleRate * blockAlign;
    const dataSize = pcmData.length;
    const riffChunkSize = 36 + dataSize;

    const header = Buffer.alloc(44);
    header.write("RIFF", 0);
    header.writeUInt32LE(riffChunkSize, 4);
    header.write("WAVE", 8);
    header.write("fmt ", 12);
    header.writeUInt32LE(16, 16); // PCM fmt chunk size
    header.writeUInt16LE(1, 20); // PCM format
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write("data", 36);
    header.writeUInt32LE(dataSize, 40);

    return Buffer.concat([header, pcmData]);
  }

  private buildLocalizedTtsPrompt(
    text: string,
    languageCode: string,
    options?: TtsOptions
  ): string {
    const tone = options?.tone?.trim() || "natural e conversacional";
    const pacing = options?.pacing?.trim() || "ritmo medio";
    const accent = options?.accent?.trim() || "brasileiro neutro";

    if (languageCode.toLowerCase() === "pt-br") {
      return [
        "### DIRECTOR NOTES",
        `Style: ${tone}`,
        `Pacing: ${pacing}`,
        `Accent: ${accent}`,
        "Leia EXCLUSIVAMENTE em portugues do Brasil (pt-BR), sem espanhol e sem portunhol.",
        "### TRANSCRIPT",
        text,
      ].join("\n");
    }

    return [
      "### DIRECTOR NOTES",
      `Style: ${tone}`,
      `Pacing: ${pacing}`,
      `Accent: ${accent}`,
      "### TRANSCRIPT",
      text,
    ].join("\n");
  }
}
