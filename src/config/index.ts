const parsePort = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

import fs from "fs";
import path from "path";

const gcCredentialsPath = path.join(process.cwd(), "gc_credentials.json");

/**
 * Carregar múltiplas API keys numeradas do .env
 * Exemplo: GOOGLE_API_KEY_1, GOOGLE_API_KEY_2, GOOGLE_API_KEY_3, ...
 */
function loadNumberedApiKeys(): string[] {
  const keys: string[] = [];
  let index = 1;

  // Procurar por GOOGLE_API_KEY_1, GOOGLE_API_KEY_2, etc.
  while (process.env[`GOOGLE_API_KEY_${index}`]) {
    const key = process.env[`GOOGLE_API_KEY_${index}`]?.trim();
    if (key && key.length > 0) {
      keys.push(key);
    }
    index++;
  }

  // Se não encontrou chaves numeradas, tentar GEMINI_API_KEYS (separadas por vírgula)
  if (keys.length === 0) {
    const geminiKeys = (process.env.GEMINI_API_KEYS ?? "")
      .split(",")
      .map((k) => k.trim())
      .filter((k) => k.length > 0);
    
    if (geminiKeys.length > 0) {
      return geminiKeys;
    }
  }

  return keys;
}

const allApiKeys = loadNumberedApiKeys();

// Remova a variável credential_gc, pois queremos o *caminho*, não o conteúdo parseado aqui.
// const credential_gc = fs.existsSync(gcCredentialsPath)
//   ? JSON.parse(fs.readFileSync(gcCredentialsPath, "utf-8"))
//   : null;

export const config = {
  env: process.env.NODE_ENV ?? "development",
  httpPort: parsePort(process.env.HTTP_PORT, 3000),
  inputQueueName: process.env.INPUT_QUEUE_NAME ?? "video.publish.input",
  resultsQueueName: process.env.RESULTS_QUEUE_NAME ?? "video.publish.results",
  queueProvider: process.env.QUEUE_PROVIDER ?? "memory",
  jobRepository: process.env.JOB_REPOSITORY ?? "memory",
  mongoUri: process.env.MONGO_URI ?? "",
  mongoDbName: process.env.MONGO_DB_NAME ?? "orquestrador",
  mongoCollection: process.env.MONGO_COLLECTION ?? "jobs",
  geminiApiKeys: allApiKeys,
  geminiModel: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
  geminiTtsModel: process.env.GEMINI_TTS_MODEL ?? "gemini-2.5-flash-preview-tts",
  geminiBaseUrl:
    process.env.GEMINI_BASE_URL ??
    "https://generativelanguage.googleapis.com/v1beta",
  googleApiKey: allApiKeys[0] ?? process.env.GOOGLE_API_KEY ?? "",
  // Se gc_credentials.json existir, use seu caminho. Caso contrário, use a variável de ambiente.
  gcpTtsKeyFile: fs.existsSync(gcCredentialsPath) ? gcCredentialsPath : process.env.GCP_TTS_KEYFILE,
  gcpTtsVoice: process.env.GCP_TTS_VOICE ?? "pt-BR-Neural2-C",
  gcpTtsAudioEncoding: process.env.GCP_TTS_AUDIO_ENCODING ?? "MP3",
  ttsProvider: process.env.TTS_PROVIDER ?? "google", // Novo: "google" ou "gemini"
  workflowOutputDir: process.env.WORKFLOW_OUTPUT_DIR ?? "tmp",
};

 