export interface TtsOptions {
  voice?: string;
  audioEncoding?: "MP3" | "LINEAR16" | "OGG_OPUS";
  languageCode?: string;
  tone?: string;
  pacing?: string;
  accent?: string;
}

export interface TtsResult {
  audioContent: Buffer;
  mimeType?: string;
}

export interface ITtsProvider {
  synthesize(text: string, options?: TtsOptions): Promise<TtsResult>;
}
