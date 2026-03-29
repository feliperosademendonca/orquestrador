import type {
  Platform,
  PlatformPublishResult,
  RoteiroPlan,
  VideoPublishRequest,
  VideoPublishResult,
  WorkflowAsset,
  WorkflowResult,
} from "../models/VideoPublish";
import type { IVideoPlatformAdapter } from "../interfaces/IVideoPlatformAdapter";
import type { IVideoComposer } from "../interfaces/IVideoComposer";
import { GeminiAdapter } from "../../infrastructure/external/GeminiAdapter";
import type { ITtsProvider, TtsResult } from "../interfaces/ITtsProvider";
import { config } from "../../config";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { GeminiTtsAdapter } from "../../infrastructure/external/GeminiTtsAdapter";
import { GoogleTtsAdapter } from "../../infrastructure/external/GoogleTtsAdapter";

export class PublicacaoService {
  private readonly primaryTtsProvider: ITtsProvider | undefined;
  private readonly fallbackTtsProvider: ITtsProvider | undefined;

  constructor(
    private readonly gemini: GeminiAdapter,
    private readonly adapters: Map<Platform, IVideoPlatformAdapter>,
    private readonly videoComposer?: IVideoComposer
  ) {
    if (config.ttsProvider === "gemini") {
      this.primaryTtsProvider = new GeminiTtsAdapter();
      this.fallbackTtsProvider = new GoogleTtsAdapter();
      console.log("[publicacao] TTS: Gemini (primary), Google (fallback)");
    } else {
      this.primaryTtsProvider = new GoogleTtsAdapter();
      this.fallbackTtsProvider = undefined; // No fallback se Google for o primário
      console.log("[publicacao] TTS: Google (primary)");
    }
  }

  async process(request: VideoPublishRequest): Promise<VideoPublishResult> {
    console.log("[publicacao] Start", request.requestId);
    
    // Suportar retry attempts (padrão: 0, máximo: 3)
    const retryAttempt = (request as any).retryAttempt || 0;
    const maxRetries = 3;
    
    const workflow = await this.buildWorkflow(request, retryAttempt, maxRetries);
    let description = request.description ?? "";
    let roteiro = request.roteiro ?? "";
    let script = request.script ?? "";

    if (workflow) {
      description = description || workflow.plan.summary;
      roteiro = roteiro || this.composeRoteiro(workflow.plan);
      script = script || roteiro;
    }

    if (!description) {
      description = await this.getDescription(request);
    }
    console.log("[publicacao] Description ready");

    if (!roteiro) {
      roteiro = await this.getRoteiro(request, description);
    }
    console.log("[publicacao] Roteiro ready");

    if (!script) {
      script = await this.getScript(request, roteiro);
    }
    console.log("[publicacao] Script ready");
    const results: PlatformPublishResult[] = [];

    for (const platform of request.platforms) {
      const adapter = this.adapters.get(platform);
      if (!adapter) {
        console.warn("[publicacao] Missing adapter", platform);
        results.push({
          platform,
          status: "failed",
          message: "Platform not configured",
        });
        continue;
      }

      try {
        console.log("[publicacao] Publishing", platform);
        results.push(await adapter.publish(request, description));
        console.log("[publicacao] Published", platform);
      } catch (error) {
        console.error("[publicacao] Publish failed", platform, error);
        results.push({
          platform,
          status: "failed",
          message: this.formatError(error),
        });
      }
    }

    console.log("[publicacao] Done", request.requestId);

    return {
      requestId: request.requestId,
      userId: request.userId,
      title: request.title,
      videoUrl: request.videoUrl,
      platforms: request.platforms,
      roteiro,
      script,
      createdAt: request.createdAt,
      completedAt: new Date().toISOString(),
      results,
      workflow,
    };
  }

  private composeRoteiro(plan: RoteiroPlan): string {
    return plan.parts.map((part) => part.ttsText.trim()).join("\n\n");
  }

  private async buildWorkflow(
    request: VideoPublishRequest,
    retryAttempt: number = 0,
    maxRetries: number = 3
  ): Promise<WorkflowResult | undefined> {
    if (!request.idea || (!this.primaryTtsProvider && !this.fallbackTtsProvider)) {
      return undefined;
    }

    console.log(
      `[workflow] Generating roteiro plan (attempt ${retryAttempt + 1}/${maxRetries + 1})`
    );
    const plan = await this.generateRoteiroPlan(request);
    console.log("[workflow] Plan ready", plan.parts.length);

    const outputDir = path.join(config.workflowOutputDir, request.requestId);
    await mkdir(outputDir, { recursive: true });

    // Salvar avatar em arquivo se fornecido em base64
    if (request.avatarImageBase64 && request.avatarImageMimeType) {
      await this.saveAvatarFile(outputDir, request.avatarImageBase64, request.avatarImageMimeType);
    }

    const assets = await this.runWithConcurrency(
      plan.parts,
      2,
      async (part) => {
        let audio: TtsResult | undefined;
        try {
          if (!this.primaryTtsProvider) {
            throw new Error("Nenhum provedor TTS primário configurado.");
          }
          console.log(`[workflow] Sintetizando TTS com provedor primário para parte ${part.id}`);
          audio = await this.primaryTtsProvider.synthesize(part.ttsText, {
            languageCode: request.language ?? "pt-BR",
            tone: request.tone,
          });
        } catch (error) {
          console.warn(`[workflow] Falha no provedor TTS primário para parte ${part.id}:`, (error as Error).message);
          if (this.fallbackTtsProvider) {
            console.log(`[workflow] Tentando com provedor de fallback para parte ${part.id}`);
            try {
              audio = await this.fallbackTtsProvider.synthesize(part.ttsText, {
                languageCode: request.language ?? "pt-BR",
                tone: request.tone,
              });
            } catch (fallbackError) {
              console.error(`[workflow] Falha também no provedor de fallback para parte ${part.id}:`, (fallbackError as Error).message);
              // Se ambos falharem, lançar o erro original para não perder o contexto
              throw error;
            }
          } else {
            // Se não houver fallback, lançar o erro original
            throw error;
          }
        }

        const audioExtension = this.getAudioExtension(audio?.mimeType);
        const audioPath = path.join(outputDir, `part-${part.id}${audioExtension}`);
        if (audio) {
          await writeFile(audioPath, audio.audioContent);
        }

        const asset: WorkflowAsset = {
          partId: part.id,
          ttsAudioPath: audioPath,
        };

        console.log("[workflow] TTS ready", part.id);
        return asset;
      }
    );

    // Compor vídeo final usando VideoComposer se disponível
    let finalVideoPath: string | undefined;
    if (this.videoComposer) {
      try {
        console.log("[workflow] Composing video from TTS assets");
        finalVideoPath = await this.videoComposer.compose(
          request.requestId,
          plan,
          assets,
          outputDir
        );
        console.log("[workflow] Video composition completed", finalVideoPath);
      } catch (error: any) {
        console.error("[workflow] Video composition failed", error);
        
        // Verificar se é erro de quota (429) - se sim, re-queue para retry
        const isQuotaError = error?.status === 429 || error?.message?.includes("RESOURCE_EXHAUSTED");
        
        if (isQuotaError && retryAttempt < maxRetries) {
          console.log(
            `[workflow] Quota exhausted, scheduling retry (${retryAttempt + 1}/${maxRetries})`
          );
          // Marcar para retry - isso será capturado pelo orquestrador
          throw new Error(`QUOTA_RETRY_${retryAttempt + 1}:${error.message}`);
        }
        
        // Se não conseguiu e já tentou todos os retries, FALHAR COMPLETAMENTE
        console.error("[workflow] Video composition failed after all retries");
        throw new Error(`VIDEO_COMPOSITION_FAILED: ${error.message}`);
      }
    } else {
      console.log("[workflow] VideoComposer not configured");
    }

    return {
      plan,
      assets,
      finalVideoPath,
    };
  }

  private getAudioExtension(mimeType?: string): string {
    if (!mimeType) return ".mp3";
    if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return ".mp3";
    if (mimeType.includes("wav") || mimeType.includes("wave")) return ".wav";
    if (mimeType.includes("ogg")) return ".ogg";
    return ".mp3";
  }

  private async generateRoteiroPlan(
    request: VideoPublishRequest
  ): Promise<RoteiroPlan> {
    const prompt = `Voce e roteirista de videos curtos. Gere roteiro dividido em 5 partes.
Regras:
- Cada parte deve durar ~5s de fala.
- Manter contexto e continuidade.
- Retornar JSON valido.

Entrada:
idea: ${request.idea}
language: ${request.language ?? "pt-BR"}
tone: ${request.tone ?? "jornalistico"}
audience: ${request.audience ?? "geral"}
visualStyle: ${(request as any).visualStyle ?? "busto em bancada"}
allowSelfieLook: ${(request as any).allowSelfieLook ?? true}
brollRatio: ${request.brollRatio ?? 0.4}

Saida JSON:
{
  "summary": "...",
  "language": "...",
  "totalParts": 5,
  "partDurationSec": 5,
  "continuityNotes": "...",
  "parts": [
    {
      "id": 1,
      "ttsText": "...",
      "visualType": "talking_head|broll",
      "visualDirection": "...",
      "brollTags": ["..."]
    }
  ]
}`;

    const response = await this.gemini.generate(prompt);
    let parsed: RoteiroPlan;

    try {
      parsed = this.parseJson(response) as RoteiroPlan;
    } catch (firstError) {
      console.warn("[workflow] Invalid JSON on first attempt, trying repair");
      const repairedPrompt = `Conserte o JSON abaixo e devolva APENAS JSON valido, sem markdown e sem comentarios.\n\n${response}`;
      const repairedResponse = await this.gemini.generate(repairedPrompt);
      parsed = this.parseJson(repairedResponse) as RoteiroPlan;
    }

    if (!parsed || !Array.isArray(parsed.parts)) {
      throw new Error("Invalid roteiro plan from Gemini");
    }

    return parsed;
  }

  private parseJson(text: string): unknown {
    const cleaned = this.normalizeJsonText(text);
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      throw new Error("No JSON payload found in Gemini response");
    }

    const jsonText = cleaned.slice(start, end + 1);
    return JSON.parse(jsonText);
  }

  private normalizeJsonText(text: string): string {
    let normalized = text.trim();

    // Remove code fences de markdown
    normalized = normalized.replace(/```json\s*/gi, "").replace(/```/g, "");

    // Remove comentários de linha
    normalized = normalized.replace(/(^|\n)\s*\/\/.*(?=\n|$)/g, "\n");

    // Remove trailing commas antes de } ou ]
    normalized = normalized.replace(/,\s*([}\]])/g, "$1");

    // Remove caracteres de controle invisíveis comuns
    normalized = normalized.replace(/[\u0000-\u001F\u007F]/g, (ch) => {
      return ch === "\n" || ch === "\r" || ch === "\t" ? ch : "";
    });

    return normalized;
  }

  private async runWithConcurrency<T, R>(
    items: T[],
    limit: number,
    handler: (item: T) => Promise<R>
  ): Promise<R[]> {
    const results: R[] = [];
    let index = 0;

    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (index < items.length) {
        const current = items[index];
        index += 1;
        results.push(await handler(current));
      }
    });

    await Promise.all(runners);
    return results;
  }

  private async getDescription(request: VideoPublishRequest): Promise<string> {
    if (request.description && request.description.trim().length > 0) {
      return request.description.trim();
    }

    const prompt = `Generate a short description for: ${request.title}`;
    return this.gemini.generate(prompt);
  }

  private formatError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return "Unknown error";
  }

  private async getRoteiro(
    request: VideoPublishRequest,
    description: string
  ): Promise<string> {
    if (request.roteiro && request.roteiro.trim().length > 0) {
      return request.roteiro.trim();
    }

    return this.gemini.generateRoteiro(request.title, description);
  }

  private async getScript(
    request: VideoPublishRequest,
    roteiro: string
  ): Promise<string> {
    if (request.script && request.script.trim().length > 0) {
      return request.script.trim();
    }

    return this.gemini.generateScript(request.title, roteiro);
  }

  private async saveAvatarFile(
    outputDir: string,
    base64Content: string,
    mimeType: string
  ): Promise<void> {
    console.log("[workflow] Saving avatar from base64");

    // Determinar extensão baseado no mimeType
    let ext = "jpg";
    if (mimeType === "image/png") {
      ext = "png";
    } else if (mimeType === "image/gif") {
      ext = "gif";
    } else if (mimeType === "video/mp4") {
      ext = "mp4";
    }

    const avatarPath = path.join(outputDir, `avatar.${ext}`);

    // Converter base64 para buffer
    const buffer = Buffer.from(base64Content, "base64");
    await writeFile(avatarPath, buffer);

    console.log("[workflow] Avatar saved to", avatarPath);
  }
}
