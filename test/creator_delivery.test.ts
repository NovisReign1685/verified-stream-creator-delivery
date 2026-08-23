import assert from "node:assert/strict";
import test from "node:test";
import { CreatorDeliveryWorkflow, WorkflowError } from "../src/creator_delivery.js";
import type { SmsGateway } from "../src/infrai_sms.js";

class ControlledSms implements SmsGateway {
  requestedFor: string[] = [];
  accepted = false;

  async requestCode(phone: string): Promise<void> {
    this.requestedFor.push(phone);
  }

  async verifyCode(): Promise<boolean> {
    return this.accepted;
  }
}

test("creator delivery requires both a ready rendition and a verified phone", async () => {
  const sms = new ControlledSms();
  const workflow = new CreatorDeliveryWorkflow(sms);
  workflow.ingest({
    assetId: "documentary-master-4",
    creatorId: "creator-19",
    creatorPhone: "+15550101919",
    sourceName: "documentary-master-4.mxf",
  });

  await assert.rejects(
    workflow.requestDeliveryCode("documentary-master-4", "3bfab50a-b750-4160-a982-1e46626bd926"),
    (error: unknown) => error instanceof WorkflowError && error.status === 409,
  );
  workflow.startProcessing("documentary-master-4");
  workflow.finishProcessing("documentary-master-4");
  await workflow.requestDeliveryCode("documentary-master-4", "3bfab50a-b750-4160-a982-1e46626bd926");
  assert.deepEqual(sms.requestedFor, ["+15550101919"]);

  await assert.rejects(
    workflow.verifyAndDeliver("documentary-master-4", "135790", "2f2bebf7-370b-4db9-964a-e9d9c3124958"),
    (error: unknown) => error instanceof WorkflowError && error.status === 422,
  );
  assert.equal(workflow.get("documentary-master-4").stage, "ready");

  sms.accepted = true;
  const result = await workflow.verifyAndDeliver(
    "documentary-master-4",
    "135790",
    "2f2bebf7-370b-4db9-964a-e9d9c3124958",
  );
  assert.equal(result.stage, "delivered");
  assert.equal(result.jobId, "transcode-documentary-master-4");
});
