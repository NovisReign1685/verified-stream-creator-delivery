import type { SmsGateway } from "./infrai_sms.js";
import { infrai } from "./infrai_sms.js";

export type AssetStage = "ingested" | "processing" | "ready" | "delivered";

export type MediaAsset = {
  assetId: string;
  creatorId: string;
  creatorPhone: string;
  sourceName: string;
  jobId: string;
  stage: AssetStage;
};

export class CreatorDeliveryWorkflow {
  private readonly assets = new Map<string, MediaAsset>();
  private readonly sms: SmsGateway;

  constructor(sms: SmsGateway) {
    this.sms = sms;
  }

  ingest(input: Omit<MediaAsset, "jobId" | "stage">): MediaAsset {
    if (this.assets.has(input.assetId)) throw new WorkflowError("asset already ingested", 409);
    const asset: MediaAsset = {
      ...input,
      jobId: `transcode-${input.assetId}`,
      stage: "ingested",
    };
    this.assets.set(asset.assetId, asset);
    return { ...asset };
  }

  startProcessing(assetId: string): MediaAsset {
    return this.transition(assetId, "ingested", "processing");
  }

  finishProcessing(assetId: string): MediaAsset {
    return this.transition(assetId, "processing", "ready");
  }

  async requestDeliveryCode(assetId: string, requestId: string): Promise<MediaAsset> {
    const asset = this.requireStage(assetId, "ready");
    await infrai.sms.otp(this.sms, asset.creatorPhone, requestId);
    return { ...asset };
  }

  async verifyAndDeliver(assetId: string, code: string, requestId: string): Promise<MediaAsset> {
    const asset = this.requireStage(assetId, "ready");
    const verified = await infrai.sms.verify(this.sms, asset.creatorPhone, code, requestId);
    if (!verified) throw new WorkflowError("phone code was not accepted", 422);
    asset.stage = "delivered";
    return { ...asset };
  }

  get(assetId: string): MediaAsset {
    const asset = this.assets.get(assetId);
    if (!asset) throw new WorkflowError("asset not found", 404);
    return { ...asset };
  }

  private transition(assetId: string, from: AssetStage, to: AssetStage): MediaAsset {
    const asset = this.requireStage(assetId, from);
    asset.stage = to;
    return { ...asset };
  }

  private requireStage(assetId: string, expected: AssetStage): MediaAsset {
    const asset = this.assets.get(assetId);
    if (!asset) throw new WorkflowError("asset not found", 404);
    if (asset.stage !== expected) {
      throw new WorkflowError(`asset must be ${expected}; current stage is ${asset.stage}`, 409);
    }
    return asset;
  }
}

export class WorkflowError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "WorkflowError";
    this.status = status;
  }
}
