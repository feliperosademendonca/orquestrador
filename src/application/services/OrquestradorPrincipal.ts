import type { IQueueProvider } from "../interfaces/IQueueProvider";
import type { IJobRepository } from "../interfaces/IJobRepository";
import type { VideoPublishRequest, VideoPublishResult } from "../models/VideoPublish";
import { isVideoPublishRequest } from "../models/VideoPublish";
import { PublicacaoService } from "./PublicacaoService";
import { ApiServer } from "../../infrastructure/http/ApiServer";

export class OrquestradorPrincipal {
  constructor(
    private readonly queueProvider: IQueueProvider,
    private readonly publicacaoService: PublicacaoService,
    private readonly apiServer: ApiServer,
    private readonly jobRepository: IJobRepository,
    private readonly inputQueueName: string,
    private readonly resultsQueueName: string
  ) {}

  async iniciar(): Promise<void> {
    console.log("[orchestrator] Starting...");
    await this.queueProvider.connect();
    console.log("[orchestrator] Queue connected");
    await this.queueProvider.subscribe(
      this.inputQueueName,
      async (payload: unknown) => {
        console.log("[orchestrator] Payload received");
        if (!isVideoPublishRequest(payload)) {
          console.warn("Invalid payload received", payload);
          return;
        }

        console.log("[orchestrator] Job processing", payload.requestId);

        await this.jobRepository.setStatus(payload.requestId, "processing");

        try {
          const result = await this.processPayload(payload);
          await this.jobRepository.setResult(payload.requestId, result);
          await this.queueProvider.publish(this.resultsQueueName, result);
          console.log(
            "[orchestrator] Job completed",
            result.requestId,
            result.results
          );
          console.log("Publish completed", result.requestId, result.results);
        } catch (error: any) {
          const message = error instanceof Error ? error.message : "Unknown error";
          
          // Verificar se é um erro de retry
          const isRetryError = message?.includes("QUOTA_RETRY_");
          
          if (isRetryError) {
            // Extrair número do retry da mensagem
            const retryMatch = message.match(/QUOTA_RETRY_(\d+)/);
            const nextRetryAttempt = retryMatch ? parseInt(retryMatch[1]) : 1;
            
            console.log(
              `[orchestrator] Re-queueing job for retry (attempt ${nextRetryAttempt})`
            );
            
            // Re-enqueue job com retry counter
            const retryPayload = {
              ...payload,
              retryAttempt: nextRetryAttempt,
            };
            
            // Aguardar antes de re-enqueue (backoff)
            const delayMs = 5000 * nextRetryAttempt; // 5s, 10s, 15s
            await new Promise((resolve) => setTimeout(resolve, delayMs));
            
            await this.queueProvider.publish(this.inputQueueName, retryPayload);
            await this.jobRepository.setStatus(
              payload.requestId,
              "queued_for_retry",
              `Retry ${nextRetryAttempt} scheduled due to quota exhaustion`
            );
            console.log(`[orchestrator] Job re-queued for retry`);
          } else {
            // Erro final - job falha completamente
            await this.jobRepository.setStatus(payload.requestId, "failed", message);
            console.error("[orchestrator] Publish failed", payload.requestId, message);
            
            // Se é erro de video composition, informar especificamente
            if (message?.includes("VIDEO_COMPOSITION_FAILED")) {
              console.error(
                "[orchestrator] Job failed at video composition stage - no publication occurred"
              );
            }
          }
        }
      }
    );

    await this.apiServer.start();
    console.log("[orchestrator] API server started");
  }

  async finalizar(): Promise<void> {
    await this.apiServer.stop();
    await this.queueProvider.close();
  }

  private async processPayload(
    payload: VideoPublishRequest
  ): Promise<VideoPublishResult> {
    return this.publicacaoService.process(payload);
  }
}
