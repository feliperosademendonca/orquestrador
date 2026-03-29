import http from "http";
import { OrquestradorPrincipal } from "../application/services/OrquestradorPrincipal";
import { PublicacaoService } from "../application/services/PublicacaoService";
import type { IVideoPlatformAdapter } from "../application/interfaces/IVideoPlatformAdapter";
import type { Platform, VideoPublishInput } from "../application/models/VideoPublish";
import { ApiServer } from "../infrastructure/http/ApiServer";
import { GeminiAdapter } from "../infrastructure/external/GeminiAdapter";
import { YouTubeAdapter } from "../infrastructure/external/YouTubeAdapter";
import { TikTokAdapter } from "../infrastructure/external/TikTokAdapter";
import { InstagramReelsAdapter } from "../infrastructure/external/InstagramReelsAdapter";
import { KwaiAdapter } from "../infrastructure/external/KwaiAdapter";
import { InMemoryQueueAdapter } from "../infrastructure/queue/InMemoryQueueAdapter";
import { InMemoryJobRepository } from "../infrastructure/storage/InMemoryJobRepository";

type JsonResponse<T> = { status: number; body?: T };

type JobRecordResponse = {
  requestId: string;
  status: "queued" | "processing" | "completed" | "failed";
  result?: unknown;
};

type CreateJobResponse = { requestId: string };

type DeleteJobsResponse = { deleted: number };

async function requestJson<T>(
  method: string,
  url: string,
  payload?: unknown
): Promise<JsonResponse<T>> {
  const parsed = new URL(url);

  return new Promise((resolve, reject) => {
    const body = payload ? JSON.stringify(payload) : undefined;

    const req = http.request(
      {
        method,
        hostname: parsed.hostname,
        port: parsed.port ? Number(parsed.port) : undefined,
        path: `${parsed.pathname}${parsed.search}`,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": body ? Buffer.byteLength(body) : 0,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          const status = res.statusCode ?? 0;

          if (!raw) {
            resolve({ status });
            return;
          }

          try {
            const parsedBody = JSON.parse(raw) as T;
            resolve({ status, body: parsedBody });
          } catch (error) {
            reject(error);
          }
        });
      }
    );

    req.on("error", reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCompletion(
  baseUrl: string,
  requestId: string
): Promise<JobRecordResponse> {
  const maxAttempts = 25;
  const delayMs = 200;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const response = await requestJson<JobRecordResponse>(
      "GET",
      `${baseUrl}/jobs/${requestId}`
    );

    if (response.status === 200 && response.body) {
      const status = response.body.status;
      if (status === "completed" || status === "failed") {
        return response.body;
      }
    }

    await sleep(delayMs);
  }

  throw new Error("Job did not complete in time");
}

async function main(): Promise<void> {
  process.env.NODE_ENV ??= "development";
  process.env.QUEUE_PROVIDER ??= "memory";
  process.env.JOB_REPOSITORY ??= "memory";
  process.env.HTTP_PORT ??= "3010";

  const { config } = await import("../config");

  const queueProvider = new InMemoryQueueAdapter();
  const jobRepository = new InMemoryJobRepository();
  const gemini = new GeminiAdapter();
  const adapters = new Map<Platform, IVideoPlatformAdapter>([
    ["youtube", new YouTubeAdapter()],
    ["tiktok", new TikTokAdapter()],
    ["instagram_reels", new InstagramReelsAdapter()],
    ["kwai", new KwaiAdapter()],
  ]);
  const publicacaoService = new PublicacaoService(gemini, adapters);
  const apiServer = new ApiServer(
    config.httpPort,
    (payload) => queueProvider.publish(config.inputQueueName, payload),
    jobRepository
  );
  const orquestrador = new OrquestradorPrincipal(
    queueProvider,
    publicacaoService,
    apiServer,
    jobRepository,
    config.inputQueueName,
    config.resultsQueueName
  );

  const baseUrl = `http://localhost:${config.httpPort}`;

  console.log("[dev:flow] Starting system...");
  await orquestrador.iniciar();
  console.log(`[dev:flow] API running at ${baseUrl}`);

  try {
    const payload: VideoPublishInput = {
      userId: "dev-user",
      title: "Video demo",
      videoUrl: "https://example.com/video.mp4",
      platforms: ["youtube", "tiktok"],
      description: "Descricao de teste",
    };

    console.log("[dev:flow] Creating publication...");
    const createResponse = await requestJson<CreateJobResponse>(
      "POST",
      `${baseUrl}/jobs`,
      payload
    );

    if (createResponse.status !== 202 || !createResponse.body) {
      throw new Error("Failed to create publication");
    }

    const requestId = createResponse.body.requestId;
    console.log(`[dev:flow] Created job ${requestId}`);

    console.log("[dev:flow] Waiting for completion...");
    const job = await waitForCompletion(baseUrl, requestId);
    console.log(`[dev:flow] Job status: ${job.status}`);

    console.log("[dev:flow] Fetching job...");
    const jobResponse = await requestJson<JobRecordResponse>(
      "GET",
      `${baseUrl}/jobs/${requestId}`
    );
    console.log("[dev:flow] Job payload:", jobResponse.body ?? null);

    console.log("[dev:flow] Deleting all jobs...");
    const deleteResponse = await requestJson<DeleteJobsResponse>(
      "DELETE",
      `${baseUrl}/jobs`
    );
    console.log(
      `[dev:flow] Deleted ${deleteResponse.body?.deleted ?? 0} job(s)`
    );
  } finally {
    console.log("[dev:flow] Stopping system...");
    await orquestrador.finalizar();
    console.log("[dev:flow] System stopped.");
  }
}

void main();
