import { GoogleGenAI } from "@google/genai";
import { config } from "../../config";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import EventEmitter from "events";
import { ApiKeyRotator } from "../utils/ApiKeyRotator";

/**
 * Solicitação de geração de vídeo com Veo 3.1
 * 
 * IMPORTANTE: Vídeos são armazenados por 2 dias apenas.
 * Marca d'água SynthID é adicionada automaticamente.
 * Latência: 11s a 6 minutos
 */
export interface VeoVideoRequest {
  // === OBRIGATÓRIO ===
  prompt: string;

  // === ENTRADA (escolha uma) ===
  /** Imagem inicial para animar */
  image?: {
    imageBase64: string;
    mimeType: "image/png" | "image/jpeg" | "image/webp";
  };

  /** Vídeo anterior para estender (até 7s, até 20x) */
  video?: {
    videoBase64: string;
    mimeType: "video/mp4";
  };

  // === REFERÊNCIAS ===
  /** Até 3 imagens para orientar estilo/conteúdo (Veo 3.1 apenas) */
  referenceImages?: Array<{
    imageBase64: string;
    mimeType: "image/png" | "image/jpeg" | "image/webp";
    referenceType?: "asset";
  }>;

  /** Imagem final para interpolação (usar com image) */
  lastFrame?: {
    imageBase64: string;
    mimeType: "image/png" | "image/jpeg" | "image/webp";
  };

  // === CONFIGURAÇÃO ===
  /** Proporção: "16:9" (padrão) ou "9:16" */
  aspectRatio?: "16:9" | "9:16";

  /** Resolução: "720p" (padrão), "1080p" (8s apenas), "4k" (8s apenas) */
  resolution?: "720p" | "1080p" | "4k";

  /** Duração: "4", "6", "8" (8s obrigatório para 1080p/4k/referências) */
  durationSeconds?: "4" | "6" | "8";

  /** Controla geração de pessoas */
  personGeneration?: "allow_all" | "allow_adult";

  /** Seed para melhorar (não garante) determinismo */
  seed?: number;

  // === CALLBACK ===
  jobId?: string;
  callbackUrl?: string;
}

export interface VeoVideoResult {
  videoBase64: string;
  videoPath?: string;
  jobId?: string;
  status: "completed" | "pending" | "failed";
  error?: string;
}

/**
 * Adapter para Google Gemini Veo 3.1 - Geração de vídeos com IA
 * 
 * RECURSOS SUPORTADOS:
 * ✅ Texto → Vídeo
 * ✅ Imagem → Vídeo (animar imagem inicial)
 * ✅ Interpolação (frame inicial + final)
 * ✅ Extensão de vídeos (até 7s, até 20x)
 * ✅ Imagens de referência (até 3, para manter aparência)
 * ✅ Controle de proporção (16:9 ou 9:16)
 * ✅ Controle de resolução (720p, 1080p, 4K)
 * ✅ Controle de duração (4, 6, 8 segundos)
 * ✅ Áudio nativo gerado automaticamente
 * ✅ Retry com rotação de API keys
 * 
 * LIMITAÇÕES IMPORTANTES:
 * ⚠️ Vídeos armazenados por 2 dias apenas (fazer download em 48h)
 * ⚠️ Marca d'água SynthID adicionada automaticamente
 * ⚠️ Latência: 11 segundos a 6 minutos
 * ⚠️ 1080p/4K: 8 segundos obrigatório
 * ⚠️ Extensão: 720p apenas, até 141s duração original
 * ⚠️ Imagens de referência: 8 segundos obrigatório
 * ⚠️ Filtros de segurança aplicados automaticamente
 */
export class VeoVideoAdapter extends EventEmitter {
  private ai: GoogleGenAI;
  private activeOperations: Map<string, any> = new Map();
  private keyRotator: ApiKeyRotator;
  private maxRetriesPerKey: number = 3;
  private retryDelayMs: number = 1000;
  private maxRetryAttempts: number = 3; // Total de tentativas com backoff crescente

  constructor() {
    super();
    if (!config.googleApiKey && (!config.geminiApiKeys || config.geminiApiKeys.length === 0)) {
      throw new Error("GOOGLE_API_KEY or GEMINI_API_KEYS not configured");
    }
    
    // Usar GEMINI_API_KEYS (array) ou fallback para GOOGLE_API_KEY
    const keys = config.geminiApiKeys && config.geminiApiKeys.length > 0
      ? config.geminiApiKeys
      : [config.googleApiKey!];

    this.keyRotator = new ApiKeyRotator(keys);
    
    // Inicializar com primeira chave
    const currentKey = keys[0];
    this.ai = new GoogleGenAI({
      apiKey: currentKey,
    });
    
    console.log(`[veo] Initialized with ${keys.length} API key(s)`);
  }

  /**
   * Rotacionar para próxima API key
   */
  private rotateApiKey(): void {
    const nextKey = this.keyRotator.getNext();
    this.ai = new GoogleGenAI({
      apiKey: nextKey,
    });
    console.log(`[veo] Rotated to next API key`);
  }

  /**
   * Inicia geração de vídeo SEM AGUARDAR (async/non-blocking)
   * Retorna jobId para rastreamento
   * Com retry automático em caso de erro 429
   * Tenta com backoff exponencial: 1s, 2s, 4s, 8s, 16s, 32s, 64s, 128s, 256s, 512s
   */
  async startVideoGeneration(request: VeoVideoRequest): Promise<string> {
    console.log("[veo] Starting video generation (non-blocking)");

    const jobId = request.jobId || `veo-${Date.now()}`;
    let lastError: any;
    let totalAttempts = 0;

    // Loop de tentativas com backoff crescente
    for (let globalAttempt = 0; globalAttempt < this.maxRetryAttempts; globalAttempt++) {
      // Aguardar backoff antes de tentar (exceto na primeira)
      if (globalAttempt > 0) {
        const delayMs = this.retryDelayMs * Math.pow(2, globalAttempt - 1);
        console.log(
          `[veo] Retry attempt ${globalAttempt + 1}/${this.maxRetryAttempts}, aguardando ${delayMs}ms...`
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      // Tentar com cada chave disponível
      for (let keyAttempt = 0; keyAttempt < this.keyRotator.getKeyCount(); keyAttempt++) {
        // Se não for primeira tentativa, rotacionar chave
        if (keyAttempt > 0) {
          console.log(
            `[veo] Rotating to next API key (key attempt ${keyAttempt + 1}/${this.keyRotator.getKeyCount()})`
          );
          this.rotateApiKey();
        }

        totalAttempts++;

        try {
          return await this.startVideoGenerationWithKey(request, jobId);
        } catch (error: any) {
          lastError = error;
          const statusCode = error?.status || error?.statusCode;
          const isQuotaError = statusCode === 429 || error?.message?.includes("RESOURCE_EXHAUSTED");

          console.error(
            `[veo] Error (attempt ${totalAttempts}):`,
            isQuotaError ? "QUOTA_EXHAUSTED" : statusCode,
            error.message?.substring(0, 100)
          );

          // Se não for erro de quota, ou se for última chave, continuar para próximo global attempt
          if (!isQuotaError || keyAttempt === this.keyRotator.getKeyCount() - 1) {
            break; // Sair do loop de keys e tentar novamente com backoff
          }
        }
      }
    }

    // Se chegou aqui, todos os attempts falharam
    const errorMsg = `Video generation failed after ${totalAttempts} attempts and ${this.maxRetryAttempts} retry cycles`;
    console.error(`[veo] ${errorMsg}`);
    throw lastError || new Error(errorMsg);
  }

  /**
   * Inicia geração com chave atual (sem rotação)
   * Suporta: texto→vídeo, imagem→vídeo, interpolação, extensão, imagens de referência
   */
  private async startVideoGenerationWithKey(
    request: VeoVideoRequest,
    jobId: string
  ): Promise<string> {
    try {
      // Preparar config com todos os parâmetros opcionais
      const config: any = {};

      if (request.aspectRatio) {
        config.aspectRatio = request.aspectRatio;
      }
      if (request.resolution) {
        config.resolution = request.resolution;
      }
      if (request.durationSeconds) {
        config.durationSeconds = request.durationSeconds;
      }
      if (request.personGeneration) {
        config.personGeneration = request.personGeneration;
      }
      if (request.seed !== undefined) {
        config.seed = request.seed;
      }

      // Imagem final para interpolação
      if (request.lastFrame) {
        config.lastFrame = {
          imageBytes: request.lastFrame.imageBase64,
          mimeType: request.lastFrame.mimeType,
        };
      }

      // Imagens de referência
      if (request.referenceImages && request.referenceImages.length > 0) {
        config.referenceImages = request.referenceImages.map((img) => ({
          image: {
            imageBytes: img.imageBase64,
            mimeType: img.mimeType,
          },
          referenceType: img.referenceType || "asset",
        }));
      }

      // Preparar parâmetros base para generateVideos
      const generateParams: any = {
        model: "veo-3.1-generate-preview",
        prompt: request.prompt,
      };

      // Imagem inicial (entrada)
      if (request.image) {
        generateParams.image = {
          imageBytes: request.image.imageBase64,
          mimeType: request.image.mimeType,
        };
      }

      // Vídeo para extensão (entrada)
      if (request.video) {
        generateParams.video = {
          videoBytes: request.video.videoBase64,
          mimeType: request.video.mimeType,
        };
      }

      // Config (só adicionar se tiver algo)
      if (Object.keys(config).length > 0) {
        generateParams.config = config;
      }

      console.log(`[veo] Generating with config:`, {
        hasImage: !!request.image,
        hasVideo: !!request.video,
        hasReferences: !!request.referenceImages?.length,
        aspectRatio: request.aspectRatio,
        resolution: request.resolution,
        duration: request.durationSeconds,
      });

      const operation = await this.ai.models.generateVideos(generateParams);

      console.log("[veo] Operation started:", operation.name);

      this.activeOperations.set(jobId, {
        operationId: operation.name,
        operation,
        jobId,
        callbackUrl: request.callbackUrl,
        startTime: Date.now(),
      });

      this.pollOperation(jobId).catch((error) => {
        console.error("[veo] Polling failed for", jobId, error);
        this.emit("error", { jobId, error });
      });

      return jobId;
    } catch (error) {
      console.error("[veo] Error starting video generation:", error);
      throw error;
    }
  }

  private async pollOperation(jobId: string): Promise<void> {
    const opData = this.activeOperations.get(jobId);
    if (!opData) return;

    let operation = opData.operation;
    let attempts = 0;
    const maxAttempts = 720;
    let consecutiveErrors = 0;
    const maxConsecutiveErrors = 5;

    while (!operation.done && attempts < maxAttempts) {
      console.log(`[veo] Polling ${jobId}... (attempt ${attempts + 1}/${maxAttempts})`);
      await new Promise((resolve) => setTimeout(resolve, 10000));

      try {
        operation = await this.ai.operations.getVideosOperation({
          operation: operation,
        });
        consecutiveErrors = 0; // Reset error counter on success
      } catch (error: any) {
        consecutiveErrors++;
        const statusCode = error?.status || error?.statusCode;
        const isQuotaError = statusCode === 429 || error?.message?.includes("RESOURCE_EXHAUSTED");

        console.error(`[veo] Polling error for ${jobId}:`, error.message);

        // Se quota esgotada, rotacionar chave
        if (isQuotaError && consecutiveErrors < 3) {
          console.log(`[veo] Quota exhausted during polling, rotating to next API key`);
          this.rotateApiKey();
          // Tentar novamente com nova chave sem contar como erro final
          attempts++;
          continue;
        }

        // Se muitos erros consecutivos, falhar
        if (consecutiveErrors >= maxConsecutiveErrors) {
          console.error(`[veo] Too many consecutive polling errors, giving up`);
          this.emit("error", { jobId, error });
          this.activeOperations.delete(jobId);
          return;
        }

        attempts++;
        continue;
      }

      attempts++;
    }

    if (!operation.done) {
      const error = "Video generation timed out after 2 hours";
      console.error(`[veo] ${error}`);
      this.emit("error", { jobId, error });
      this.activeOperations.delete(jobId);
      return;
    }

    console.log(`[veo] Video generation completed for ${jobId}`);

    try {
      const result = await this.processCompletedVideo(jobId, operation);
      this.emit("video-ready", result);

      if (opData.callbackUrl) {
        await this.notifyCallback(opData.callbackUrl, result);
      }

      this.activeOperations.delete(jobId);
    } catch (error) {
      console.error(`[veo] Error processing video for ${jobId}:`, error);
      this.emit("error", { jobId, error });
      this.activeOperations.delete(jobId);
    }
  }

  private async processCompletedVideo(
    jobId: string,
    operation: any
  ): Promise<VeoVideoResult> {
    const generatedVideos = (operation.response as any)?.generatedVideos;
    if (!generatedVideos || generatedVideos.length === 0) {
      throw new Error("No videos returned from Veo");
    }

    const videoFile = generatedVideos[0].video;
    if (!videoFile) {
      throw new Error("No video file in Veo response");
    }

    const outputDir = path.join(config.workflowOutputDir, jobId);
    await fs.mkdir(outputDir, { recursive: true });

    const videoPath = path.join(outputDir, "veo-output.mp4");

    console.log(`[veo] Downloading video for ${jobId} to:`, videoPath);
    await this.ai.files.download({
      file: videoFile,
      downloadPath: videoPath,
    });

    const videoBase64 = await this.fileToBase64(videoPath);

    return {
      jobId,
      videoBase64,
      videoPath,
      status: "completed",
    };
  }

  private async notifyCallback(callbackUrl: string, result: VeoVideoResult): Promise<void> {
    try {
      const response = await fetch(callbackUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result),
      });

      if (!response.ok) {
        console.warn(
          `[veo] Webhook notification failed: ${response.status} ${response.statusText}`
        );
      } else {
        console.log(`[veo] Webhook notification sent to ${callbackUrl}`);
      }
    } catch (error) {
      console.error(`[veo] Error sending webhook notification:`, error);
    }
  }

  getOperationStatus(jobId: string): any {
    const opData = this.activeOperations.get(jobId);
    if (!opData) return null;

    const elapsedSeconds = (Date.now() - opData.startTime) / 1000;
    return {
      jobId,
      status: "processing",
      operationId: opData.operationId,
      elapsedSeconds: Math.round(elapsedSeconds),
      isDone: opData.operation.done,
    };
  }

  /**
   * Obter estatísticas de uso das API keys
   */
  getApiKeyStats(): any {
    return this.keyRotator.getStats();
  }

  async cancelOperation(jobId: string): Promise<boolean> {
    const opData = this.activeOperations.get(jobId);
    if (!opData) return false;

    try {
      // Cancel é uma operação de Long Running Operations
      // Pode não estar disponível para todos os serviços
      console.log(`[veo] Attempting to cancel operation ${jobId}`);
      this.activeOperations.delete(jobId);
      return true;
    } catch (error) {
      console.error(`[veo] Error canceling operation ${jobId}:`, error);
      return false;
    }
  }

  async generateTalkingHead(request: VeoVideoRequest): Promise<VeoVideoResult> {
    const jobId = request.jobId || `veo-sync-${Date.now()}`;

    console.log("[veo] Starting video generation (blocking mode)");

    await this.startVideoGeneration({ ...request, jobId });

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.removeListener("video-ready", handler);
        reject(new Error("Video generation timed out"));
      }, 2 * 60 * 60 * 1000);

      const handler = (result: VeoVideoResult) => {
        if (result.jobId === jobId) {
          clearTimeout(timeout);
          this.removeListener("video-ready", handler);
          resolve(result);
        }
      };

      const errorHandler = (error: any) => {
        if (error.jobId === jobId) {
          clearTimeout(timeout);
          this.removeListener("error", errorHandler);
          reject(error);
        }
      };

      this.on("video-ready", handler);
      this.on("error", errorHandler);
    });
  }

  async generateVideo(
    prompt: string,
    referenceImages?: Array<{
      imageBase64: string;
      mimeType: "image/png" | "image/jpeg" | "image/webp";
    }>
  ): Promise<string> {
    const result = await this.generateTalkingHead({
      prompt,
      referenceImages,
    });

    return result.videoBase64;
  }

  /**
   * Animar uma imagem inicial
   */
  async animateImage(
    imageBase64: string,
    prompt: string,
    aspectRatio?: "16:9" | "9:16"
  ): Promise<string> {
    const result = await this.generateTalkingHead({
      prompt,
      image: {
        imageBase64,
        mimeType: "image/png",
      },
      aspectRatio,
    });

    return result.videoBase64;
  }

  /**
   * Interpolar entre dois frames
   */
  async interpolateFrames(
    firstImageBase64: string,
    lastImageBase64: string,
    prompt: string,
    aspectRatio?: "16:9" | "9:16"
  ): Promise<string> {
    const result = await this.generateTalkingHead({
      prompt,
      image: {
        imageBase64: firstImageBase64,
        mimeType: "image/png",
      },
      lastFrame: {
        imageBase64: lastImageBase64,
        mimeType: "image/png",
      },
      aspectRatio,
      durationSeconds: "8", // Interpolação requer 8s
    });

    return result.videoBase64;
  }

  /**
   * Estender vídeo gerado anteriormente
   * 
   * LIMITAÇÕES:
   * - Até 7 segundos de extensão
   * - Até 20 vezes o comprimento original
   * - Resolução: 720p apenas
   * - Duração original: até 141s
   * - Vídeos armazenados por 2 dias
   */
  async extendVideo(
    videoBase64: string,
    prompt: string,
    aspectRatio?: "16:9" | "9:16"
  ): Promise<string> {
    const result = await this.generateTalkingHead({
      prompt,
      video: {
        videoBase64,
        mimeType: "video/mp4",
      },
      aspectRatio,
      resolution: "720p", // Extensão: 720p apenas
      durationSeconds: "8",
    });

    return result.videoBase64;
  }

  /**
   * Gerar vídeo em alta resolução (1080p ou 4K)
   * Nota: custo mais alto, 8 segundos obrigatório
   */
  async generateHighResolution(
    prompt: string,
    resolution: "1080p" | "4k" = "1080p",
    referenceImages?: Array<{
      imageBase64: string;
      mimeType: "image/png" | "image/jpeg" | "image/webp";
    }>
  ): Promise<string> {
    const result = await this.generateTalkingHead({
      prompt,
      referenceImages,
      resolution,
      durationSeconds: "8", // 1080p/4k requer 8s
    });

    return result.videoBase64;
  }

  /**
   * Gerar vídeo em portrait mode
   */
  async generatePortrait(
    prompt: string,
    durationSeconds?: "4" | "6" | "8"
  ): Promise<string> {
    const result = await this.generateTalkingHead({
      prompt,
      aspectRatio: "9:16",
      durationSeconds: durationSeconds || "8",
    });

    return result.videoBase64;
  }

  private async fileToBase64(filePath: string): Promise<string> {
    const buffer = await fs.readFile(filePath);
    return buffer.toString("base64");
  }
}
