import express, { type Request, type Response } from "express";
import type http from "http";
import { randomUUID } from "crypto";
import multer from "multer";
import path from "path";
import { promises as fs } from "fs";
import type {
  Platform,
  VideoPublishInput,
  VideoPublishRequest,
} from "../../application/models/VideoPublish";
import type { IJobRepository } from "../../application/interfaces/IJobRepository";
import * as textToSpeech from "@google-cloud/text-to-speech";
import type { VeoVideoAdapter } from "../external/VeoVideoAdapter";

export type EnqueueFn = (payload: VideoPublishRequest) => Promise<void>;

export class ApiServer {
  private server?: http.Server;
  private readonly app = express();
  private readonly upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 100_000_000 }, // 100MB para base64 de áudio + imagem
  });
  private veoAdapter?: VeoVideoAdapter;
  private ttsWorkerUrl?: {
    url: string;
    updatedAt: string;
  };

  constructor(
    private readonly port: number,
    private readonly enqueue: EnqueueFn,
    private readonly jobRepository: IJobRepository,
    veoAdapter?: VeoVideoAdapter
  ) {
    this.veoAdapter = veoAdapter;
    this.app.use(express.json({ limit: "100mb" }));
    this.app.use(express.urlencoded({ extended: true, limit: "100mb" }));
    this.registerRoutes();
  }

  async start(): Promise<void> {
    if (this.server) {
      return;
    }

    await new Promise<void>((resolve) => {
      this.server = this.app.listen(this.port, resolve);
    });
  }

  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      this.server?.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });

    this.server = undefined;
  }

  private registerRoutes(): void {
    this.app.get("/", (_req: Request, res: Response) => {
      res.status(200).send(this.renderUploadForm());
    });

    this.app.get("/health", (_req: Request, res: Response) => {
      res.status(200).json({ status: "ok" });
    });

    // Endpoint para worker informar URL quando terminar o wake
    this.app.post("/url_tts", (req: Request, res: Response) => {
      const body = req.body as { url?: string; gradio_url?: string };
      const incomingUrl = body?.gradio_url ?? body?.url;

      if (!incomingUrl || typeof incomingUrl !== "string") {
        this.respondError(res, 400, "Missing url (expected 'gradio_url' or 'url')");
        return;
      }

      this.ttsWorkerUrl = {
        url: incomingUrl,
        updatedAt: new Date().toISOString(),
      };

      console.log("[api] /url_tts atualizado", this.ttsWorkerUrl);
      res.status(200).json({ ok: true, data: this.ttsWorkerUrl });
    });

    this.app.get("/url_tts", (_req: Request, res: Response) => {
      if (!this.ttsWorkerUrl) {
        res.status(404).json({ ok: false, message: "TTS worker URL not registered yet" });
        return;
      }

      res.status(200).json({ ok: true, data: this.ttsWorkerUrl });
    });

    this.app.get("/jobs/:requestId", async (req: Request, res: Response) => {
      const requestId = req.params.requestId;
      if (!requestId) {
        this.respondError(res, 400, "Missing requestId");
        return;
      }

      const job = await this.jobRepository.getById(requestId);
      if (!job) {
        this.respondError(res, 404, "Job not found");
        return;
      }

      res.status(200).json(job);
    });

    this.app.post("/jobs", async (req: Request, res: Response) => {
      console.log("[api] POST /jobs");
      const input = req.body as Partial<VideoPublishInput>;
      const validation = this.validateInput(input);
      if (!validation.ok || !validation.data) {
        console.warn("[api] Validation failed", validation.error);
        this.respondError(res, 400, validation.error);
        return;
      }

      const request = this.buildRequest(validation.data);
      await this.jobRepository.create(request);
      await this.enqueue(request);
      console.log("[api] Enqueued job", request.requestId);
      res.status(202).json({ requestId: request.requestId });
    });

    this.app.post(
      "/jobs/form",
      this.upload.single("avatarImage"),
      async (req: Request, res: Response) => {
        console.log("[api] POST /jobs/form");
        const platforms = this.parsePlatforms(this.getBodyValue(req, "platforms"));
        const allowSelfieLook = this.parseBoolean(
          this.getBodyValue(req, "allowSelfieLook")
        );
        const file = req.file;

        if (!file) {
          console.warn("[api] Missing avatarImage file");
        }

        const input: Partial<VideoPublishInput> = {
          userId: this.getBodyValue(req, "userId"),
          title: this.getBodyValue(req, "title") ?? this.getBodyValue(req, "idea"),
          description: this.getBodyValue(req, "description"),
          videoUrl: this.getBodyValue(req, "videoUrl") ?? "",
          platforms,
          roteiro: this.getBodyValue(req, "roteiro"),
          script: this.getBodyValue(req, "script"),
          idea: this.getBodyValue(req, "idea"),
          language: this.getBodyValue(req, "language"),
          tone: this.getBodyValue(req, "tone"),
          audience: this.getBodyValue(req, "audience"),
          totalDurationSec: this.parseNumber(
            this.getBodyValue(req, "totalDurationSec")
          ),
          brollRatio: this.parseNumber(this.getBodyValue(req, "brollRatio")),
          visualStyle: this.getBodyValue(req, "visualStyle"),
          allowSelfieLook,
          avatarImageBase64: file ? file.buffer.toString("base64") : undefined,
          avatarImageMimeType: file?.mimetype,
        };

        const validation = this.validateInput(input, {
          requireAvatar: true,
          allowEmptyVideoUrl: true,
        });
        if (!validation.ok || !validation.data) {
          console.warn("[api] Validation failed", validation.error);
          this.respondError(res, 400, validation.error);
          return;
        }

        const request = this.buildRequest(validation.data);
        await this.jobRepository.create(request);
        await this.enqueue(request);
        console.log("[api] Enqueued job", request.requestId);
        res.status(202).json({ requestId: request.requestId });
      }
    );

    this.app.delete("/jobs", async (_req: Request, res: Response) => {
      const deleted = await this.jobRepository.clearAll();
      res.status(200).json({ deleted });
    });

    // Webhook para notificação de vídeos prontos do Veo
    this.app.post("/webhooks/veo-video-ready", async (req: Request, res: Response) => {
      console.log("[api] Webhook: Video ready from Veo");
      
      const { jobId, videoBase64, videoPath, status } = req.body;

      if (!jobId || status !== "completed") {
        console.warn("[api] Invalid webhook payload");
        res.status(400).json({ error: "Invalid payload" });
        return;
      }

      try {
        // Salvar vídeo final
        const finalVideoPath = videoPath || path.join("tmp", jobId, "veo-output.mp4");
        
        if (videoBase64) {
          const buffer = Buffer.from(videoBase64, "base64");
          await fs.writeFile(finalVideoPath, buffer);
          console.log("[api] Video saved:", finalVideoPath);
        }

        // Atualizar job no repositório (se suportado)
        try {
          const job = await this.jobRepository.getById(jobId);
          if (job) {
            // Pode variar dependendo da implementação do repositório
            console.log("[api] Job found, could update with video path");
          }
        } catch (e) {
          console.log("[api] Could not update job (not critical)");
        }

        res.status(200).json({ received: true, videoPath: finalVideoPath });
        console.log("[api] Webhook processed successfully for job:", jobId);
      } catch (error) {
        console.error("[api] Error processing webhook:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // Endpoint para consultar estatísticas de API keys
    this.app.get("/veo-stats", (_req: Request, res: Response) => {
      if (!this.veoAdapter) {
        res.status(503).json({ error: "VEO adapter not initialized" });
        return;
      }

      try {
        const stats = this.veoAdapter.getApiKeyStats();
        res.status(200).json(stats);
      } catch (error) {
        console.error("[api] Error getting VEO stats:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    this.app.use((_req: Request, res: Response) => {
      this.respondError(res, 404, "Not found");
    });
  }

  private getBodyValue(req: Request, key: string): string | undefined {
    const value = req.body?.[key];
    if (typeof value === "string") {
      return value;
    }

    if (value === undefined || value === null) {
      return undefined;
    }

    return String(value);
  }

  private buildRequest(data: VideoPublishInput): VideoPublishRequest {
    return {
      requestId: randomUUID(),
      userId: data.userId,
      title: data.title,
      description: data.description,
      videoUrl: data.videoUrl,
      platforms: data.platforms,
      roteiro: data.roteiro,
      script: data.script,
      idea: data.idea,
      avatarImageBase64: data.avatarImageBase64,
      avatarImageMimeType: data.avatarImageMimeType,
      language: data.language,
      tone: data.tone,
      audience: data.audience,
      totalDurationSec: data.totalDurationSec,
      brollRatio: data.brollRatio,
      visualStyle: data.visualStyle,
      allowSelfieLook: data.allowSelfieLook,
      metadata: data.metadata,
      createdAt: new Date().toISOString(),
    };
  }

  private validateInput(
    input: Partial<VideoPublishInput>,
    options?: { requireAvatar?: boolean; allowEmptyVideoUrl?: boolean }
  ): {
    ok: boolean;
    error?: string;
    data?: VideoPublishInput;
  } {
    if (!input.userId || typeof input.userId !== "string") {
      return { ok: false, error: "Missing userId" };
    }

    if (!input.title || typeof input.title !== "string") {
      return { ok: false, error: "Missing title" };
    }

    if (
      (!options?.allowEmptyVideoUrl &&
        (!input.videoUrl || typeof input.videoUrl !== "string")) ||
      (options?.allowEmptyVideoUrl &&
        input.videoUrl !== undefined &&
        typeof input.videoUrl !== "string")
    ) {
      return { ok: false, error: "Missing videoUrl" };
    }

    if (!Array.isArray(input.platforms) || input.platforms.length === 0) {
      return { ok: false, error: "Missing platforms" };
    }

    const platforms = input.platforms.filter(this.isPlatform);
    if (platforms.length === 0) {
      return { ok: false, error: "Invalid platforms" };
    }

    if (options?.requireAvatar) {
      if (!input.avatarImageBase64 || !input.avatarImageMimeType) {
        return { ok: false, error: "Missing avatarImage" };
      }
    }

    return {
      ok: true,
      data: {
        userId: input.userId,
        title: input.title,
        description: input.description,
        videoUrl: input.videoUrl ?? "",
        platforms,
        roteiro: input.roteiro,
        script: input.script,
        idea: input.idea,
        avatarImageBase64: input.avatarImageBase64,
        avatarImageMimeType: input.avatarImageMimeType,
        language: input.language,
        tone: input.tone,
        audience: input.audience,
        totalDurationSec: input.totalDurationSec,
        brollRatio: input.brollRatio,
        visualStyle: input.visualStyle,
        allowSelfieLook: input.allowSelfieLook,
        metadata: input.metadata,
      },
    };
  }

  private isPlatform(value: unknown): value is Platform {
    return (
      value === "youtube" ||
      value === "tiktok" ||
      value === "instagram_reels" ||
      value === "kwai"
    );
  }

  private respondError(res: Response, status: number, error?: string): void {
    res.status(status).json({ error: error ?? "Unknown error" });
  }

  private parsePlatforms(value?: string): Platform[] | undefined {
    if (!value) {
      return undefined;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }

    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.filter(this.isPlatform);
      }
    } catch {
      // ignore json errors and try comma-separated format
    }

    return trimmed
      .split(",")
      .map((item) => item.trim())
      .filter(this.isPlatform);
  }

  private parseBoolean(value?: string): boolean | undefined {
    if (!value) {
      return undefined;
    }

    if (value === "true") {
      return true;
    }

    if (value === "false") {
      return false;
    }

    return undefined;
  }

  private parseNumber(value?: string): number | undefined {
    if (!value) {
      return undefined;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  private renderUploadForm(): string {
    return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Orquestrador - Fluxo Inicial</title>
    <style>
      body { font-family: Arial, sans-serif; max-width: 720px; margin: 32px auto; padding: 0 16px; }
      h1 { font-size: 20px; }
      label { display: block; margin: 12px 0 6px; }
      input, textarea, select { width: 100%; padding: 8px; box-sizing: border-box; }
      button { margin-top: 16px; padding: 10px 16px; }
      small { color: #555; }
    </style>
  </head>
  <body>
    <h1>Fluxo inicial</h1>
    <form method="post" action="/jobs/form" enctype="multipart/form-data">
      <label>Avatar (imagem)</label>
      <input type="file" name="avatarImage" accept="image/*" required />

      <label>Usuario</label>
      <input type="text" name="userId" value="dev-user" required />

      <label>Titulo</label>
      <input type="text" name="title" value="Roteiro teste" required />

      <label>Ideia</label>
      <textarea name="idea" rows="3" required>Ideia principal do video.</textarea>

      <label>Plataformas</label>
      <label>
        <input type="checkbox" name="platforms" value="youtube" checked />
        YouTube
      </label>
      <label>
        <input type="checkbox" name="platforms" value="tiktok" checked />
        TikTok
      </label>

      <input type="hidden" name="language" value="pt-BR" />
      <input type="hidden" name="tone" value="jornalistico" />
      <input type="hidden" name="audience" value="geral" />
      <input type="hidden" name="totalDurationSec" value="25" />
      <input type="hidden" name="brollRatio" value="0.4" />
      <input type="hidden" name="visualStyle" value="busto em bancada" />
      <input type="hidden" name="allowSelfieLook" value="true" />

      <button type="submit">Enviar</button>
      <p><small>Este formulario chama POST /jobs/form.</small></p>
    </form>
  </body>
</html>`;
  }
}
