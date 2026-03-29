import type { IVideoComposer } from "../../application/interfaces/IVideoComposer";
import type { WorkflowAsset } from "../../application/models/VideoPublish";
import { VeoVideoAdapter } from "./VeoVideoAdapter";
import { execFile } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export interface VideoComposingResult {
  jobId: string;
  videoPath?: string; // Vazio se Veo ainda processando
  veoJobId?: string; // ID da operação Veo para rastreamento
  status: "completed" | "processing";
}

export class FFmpegVideoComposer implements IVideoComposer {
  private veo: VeoVideoAdapter;

  constructor(veoInstance?: VeoVideoAdapter) {
    this.veo = veoInstance || new VeoVideoAdapter();
  }
  async compose(
    jobId: string,
    plan: any,
    assets: WorkflowAsset[],
    videoInputDir: string
  ): Promise<string> {
    console.log("[video-composer] Starting with Veo");
    console.log("[video-composer] Job:", jobId);
    console.log("[video-composer] Dir:", videoInputDir);

    // 1. Procurar avatar
    const avatarPath = await this.findFile(videoInputDir, [
      "avatar.jpg",
      "avatar.png",
      "avatar.jpeg",
      "avatar.mp4",
    ]);
    
    if (!avatarPath) {
      throw new Error(`Avatar not found in ${videoInputDir}`);
    }
    console.log("[video-composer] Avatar found:", path.basename(avatarPath));

    // 2. Concatenar áudios
    const audioFiles = assets
      .filter((a) => a.ttsAudioPath)
      .sort((a, b) => a.partId - b.partId)
      .map((a) => a.ttsAudioPath!);

    if (audioFiles.length === 0) {
      throw new Error("No audio files found");
    }

    console.log("[video-composer] Audio files:", audioFiles.length);
    console.log("[video-composer] Audio paths:", audioFiles);

    const concatenatedAudio = path.join(videoInputDir, "audio.mp3");
    await this.concatAudio(audioFiles, concatenatedAudio);

    // 3. Iniciar Veo (NÃO AGUARDA!)
    console.log("[video-composer] Starting Veo for talking head generation (non-blocking)");
    
    const avatarBase64 = await this.readFileAsBase64(avatarPath);
    const audioBase64 = await this.readFileAsBase64(concatenatedAudio);

    // A API Veo não aceita áudio diretamente. O áudio é usado no prompt.
    // A imagem do avatar é passada como 'referenceImages'.
    const veoJobId = await this.veo.startVideoGeneration({
      prompt: "Professional talking head with natural lip-sync and engaging presentation. The audio for the lip-sync is provided in the context.",
      referenceImages: [
        {
          imageBase64: avatarBase64,
          mimeType: "image/png", // Assumindo PNG, idealmente detectar o mime type
        },
      ],
      jobId: jobId, // Usar mesmo jobId para rastreamento
      callbackUrl: process.env.VEO_CALLBACK_URL, // Webhook callback
    });

    console.log("[video-composer] Veo generation started (non-blocking), jobId:", veoJobId);

    // 4. Retornar IMEDIATAMENTE com status "processing"
    // O vídeo será salvo quando Veo terminar (via webhook/listener)
    const output = path.join(videoInputDir, "final-output.mp4");
    
    return output; // Pode não existir ainda!
  }

  private async findFile(
    dir: string,
    names: string[]
  ): Promise<string | undefined> {
    for (const name of names) {
      const filePath = path.join(dir, name);
      try {
        await fs.access(filePath);
        return filePath;
      } catch {
        // continue
      }
    }
    return undefined;
  }

  private async readFileAsBase64(filePath: string): Promise<string> {
    const buffer = await fs.readFile(filePath);
    return buffer.toString("base64");
  }

  private async concatAudio(
    files: string[],
    output: string
  ): Promise<void> {
    console.log("[video-composer] Concatenating audio...");

    const args: string[] = [];
    for (const file of files) {
      args.push("-i", path.resolve(file));
    }

    const concatFilter = `concat=n=${files.length}:v=0:a=1[a]`;
    args.push(
      "-filter_complex", concatFilter,
      "-map", "[a]",
      "-ar", "24000",
      "-ac", "1",
      "-c:a", "libmp3lame",
      "-b:a", "128k",
      "-y",
      output
    );

    await execFileAsync("ffmpeg", args);

    console.log("[video-composer] Audio ready");
  }
}

