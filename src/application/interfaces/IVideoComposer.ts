import type { RoteiroPlan, WorkflowAsset } from "../models/VideoPublish";

export interface IVideoComposer {
  compose(
    jobId: string,
    plan: RoteiroPlan,
    assets: WorkflowAsset[],
    videoInputDir: string
  ): Promise<string>; // Returns path to final MP4
}
