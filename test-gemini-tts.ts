import "dotenv/config";
import { promises as fs } from "fs";
import path from "path";
import { GeminiTtsAdapter } from "./src/infrastructure/external/GeminiTtsAdapter";
import { GoogleTtsAdapter } from "./src/infrastructure/external/GoogleTtsAdapter";

async function run(): Promise<void> {
  const outDir = path.join(process.cwd(), "tmp");
  await fs.mkdir(outDir, { recursive: true });

  const text = "Ola! Este eh um teste de voz natural no orquestrador.";
  const geminiOut = path.join(outDir, "tts-gemini-test.wav");
  const googleOut = path.join(outDir, "tts-google-fallback-test.mp3");

  try {
    const gemini = new GeminiTtsAdapter();
    const audio = await gemini.synthesize(text, { languageCode: "pt-BR" });
    await fs.writeFile(geminiOut, audio.audioContent);
    console.log("[ok] Gemini TTS gerou audio:", geminiOut, "bytes=", audio.audioContent.length, "mime=", audio.mimeType);
    return;
  } catch (error: any) {
    console.warn("[warn] Gemini TTS falhou, testando fallback Google:", error?.message || error);
  }

  const google = new GoogleTtsAdapter();
  const fallbackAudio = await google.synthesize(text, { languageCode: "pt-BR", audioEncoding: "MP3" });
  await fs.writeFile(googleOut, fallbackAudio.audioContent);
  console.log("[ok] Fallback Google TTS gerou audio:", googleOut, "bytes=", fallbackAudio.audioContent.length);
}

run().catch((err) => {
  console.error("[erro] Teste de TTS falhou:", err);
  process.exit(1);
});
