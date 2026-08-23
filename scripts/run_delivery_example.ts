import { CreatorDeliveryWorkflow } from "../src/creator_delivery.js";
import type { SmsGateway } from "../src/infrai_sms.js";

class ExampleSms implements SmsGateway {
  async requestCode(): Promise<void> {}
  async verifyCode(_phone: string, code: string): Promise<boolean> {
    return code === "246810";
  }
}

const workflow = new CreatorDeliveryWorkflow(new ExampleSms());
workflow.ingest({
  assetId: "episode-17-master",
  creatorId: "creator-8",
  creatorPhone: "+15550101717",
  sourceName: "episode-17-prores.mov",
});
workflow.startProcessing("episode-17-master");
workflow.finishProcessing("episode-17-master");
await workflow.requestDeliveryCode("episode-17-master", "202c232f-7097-45d9-9678-e2193f74655d");
const delivered = await workflow.verifyAndDeliver(
  "episode-17-master",
  "246810",
  "6144056e-7556-4ac6-8075-e025fcb6ba8d",
);
console.log(delivered);
