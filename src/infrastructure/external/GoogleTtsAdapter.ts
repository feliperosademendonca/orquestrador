import type { ITtsProvider, TtsOptions, TtsResult } from "../../application/interfaces/ITtsProvider";
import { config } from "../../config";
import * as textToSpeech from "@google-cloud/text-to-speech";

export class GoogleTtsAdapter implements ITtsProvider {
  private readonly client: textToSpeech.TextToSpeechClient;

  constructor() {
    const keyFile = config.gcpTtsKeyFile?.trim();
    this.client = new textToSpeech.TextToSpeechClient(
      keyFile ? { keyFilename: keyFile } : undefined
    );
  }

  async synthesize(text: string, options?: TtsOptions): Promise<TtsResult> {
    const voice = options?.voice ?? config.gcpTtsVoice;
    const languageCode = options?.languageCode ?? "pt-BR";
    const audioEncoding =
      options?.audioEncoding ??
      (config.gcpTtsAudioEncoding as "MP3" | "LINEAR16" | "OGG_OPUS");

    const [response] = await this.client.synthesizeSpeech({
      input: { text },
      voice: { languageCode, name: voice },
      audioConfig: {
        audioEncoding,
      },
    });

    if (!response.audioContent) {
      throw new Error("TTS returned empty audio content");
    }

    return {
      audioContent: Buffer.isBuffer(response.audioContent)
        ? response.audioContent
        : Buffer.from(response.audioContent as Uint8Array),
      mimeType: "audio/mpeg",
    };
  }
}
