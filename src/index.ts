import "dotenv/config";
import { OrquestradorPrincipal } from "./application/services/OrquestradorPrincipal";
import { PublicacaoService } from "./application/services/PublicacaoService";
import type { IVideoPlatformAdapter } from "./application/interfaces/IVideoPlatformAdapter";
import type { Platform } from "./application/models/VideoPublish";
import { config } from "./config";
import { ApiServer } from "./infrastructure/http/ApiServer";
import { GeminiAdapter } from "./infrastructure/external/GeminiAdapter";
import { YouTubeAdapter } from "./infrastructure/external/YouTubeAdapter";
import { TikTokAdapter } from "./infrastructure/external/TikTokAdapter";
import { InstagramReelsAdapter } from "./infrastructure/external/InstagramReelsAdapter";
import { KwaiAdapter } from "./infrastructure/external/KwaiAdapter";
import { GoogleTtsAdapter } from "./infrastructure/external/GoogleTtsAdapter";
import { VeoVideoAdapter } from "./infrastructure/external/VeoVideoAdapter";
import { FFmpegVideoComposer } from "./infrastructure/external/FFmpegVideoComposer";
import { RabbitMQAdapter } from "./infrastructure/queue/RabbitMQAdapter";
import { BullMQAdapter } from "./infrastructure/queue/BullMQAdapter";
import { InMemoryQueueAdapter } from "./infrastructure/queue/InMemoryQueueAdapter";
import { InMemoryJobRepository } from "./infrastructure/storage/InMemoryJobRepository";
import { MongoJobRepository } from "./infrastructure/storage/MongoJobRepository";

async function main(): Promise<void> {
	const queueProvider = createQueueProvider(config.queueProvider);
	const jobRepository = await createJobRepository();
	const gemini = new GeminiAdapter();
	const ttsProvider = new GoogleTtsAdapter();
	const veoAdapter = new VeoVideoAdapter(); // Criar instância compartilhada
	const videoComposer = new FFmpegVideoComposer(veoAdapter);
	const adapters = new Map<Platform, IVideoPlatformAdapter>([
		["youtube", new YouTubeAdapter()],
		["tiktok", new TikTokAdapter()],
		["instagram_reels", new InstagramReelsAdapter()],
		["kwai", new KwaiAdapter()],
	]);
	const publicacaoService = new PublicacaoService(
		gemini,
		adapters,
		videoComposer
	);
	const apiServer = new ApiServer(
		config.httpPort,
		(payload) => queueProvider.publish(config.inputQueueName, payload),
		jobRepository,
		veoAdapter // Passar VEO adapter para o servidor
	);
	const orquestrador = new OrquestradorPrincipal(
		queueProvider,
		publicacaoService,
		apiServer,
		jobRepository,
		config.inputQueueName,
		config.resultsQueueName
	);

	await orquestrador.iniciar();
	console.log(
		`API listening on http://localhost:${config.httpPort} (env=${config.env})`
	);
}

void main();

function createQueueProvider(provider: string) {
	switch (provider) {
		case "rabbitmq":
			return new RabbitMQAdapter();
		case "bullmq":
			return new BullMQAdapter();
		case "memory":
		default:
			return new InMemoryQueueAdapter();
	}
}

async function createJobRepository() {
	switch (config.jobRepository) {
		case "mongodb":
			if (!config.mongoUri) {
				throw new Error("MONGO_URI is required for mongodb repository");
			}
			return MongoJobRepository.connect(
				config.mongoUri,
				config.mongoDbName,
				config.mongoCollection
			);
		case "memory":
		default:
			return new InMemoryJobRepository();
	}
}
