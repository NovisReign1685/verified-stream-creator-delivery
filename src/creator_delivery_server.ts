import { createServer, type ServerResponse } from "node:http";
import { z, ZodError, type ZodTypeAny } from "zod";
import { CreatorDeliveryWorkflow, WorkflowError, type MediaAsset } from "./creator_delivery.js";
import { InfraiRequestError, smsGatewayFromEnvironment } from "./infrai_sms.js";

const ingestBody = z.object({
  assetId: z.string().min(1),
  creatorId: z.string().min(1),
  creatorPhone: z.string().regex(/^\+[1-9]\d{7,14}$/),
  sourceName: z.string().min(1),
}).strict();

const assetBody = z.object({ assetId: z.string().min(1) }).strict();
const codeBody = z.object({
  assetId: z.string().min(1),
  requestId: z.string().uuid(),
}).strict();
const verifyBody = codeBody.extend({ code: z.string().regex(/^\d{4,10}$/) }).strict();

async function readBody<Schema extends ZodTypeAny>(
  request: AsyncIterable<Uint8Array>,
  schema: Schema,
): Promise<z.output<Schema>> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) chunks.push(chunk);
  return schema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

export function createCreatorDeliveryServer(workflow: CreatorDeliveryWorkflow) {
  return createServer(async (request, response) => {
    try {
      if (request.method !== "POST") {
        json(response, 405, { error: "method not allowed" });
        return;
      }
      if (request.url === "/assets/ingest") {
        const body = await readBody(request, ingestBody) as Omit<MediaAsset, "jobId" | "stage">;
        json(response, 201, workflow.ingest(body));
      } else if (request.url === "/jobs/start") {
        const body = await readBody(request, assetBody);
        json(response, 200, workflow.startProcessing(body.assetId));
      } else if (request.url === "/jobs/finish") {
        const body = await readBody(request, assetBody);
        json(response, 200, workflow.finishProcessing(body.assetId));
      } else if (request.url === "/delivery/code") {
        const body = await readBody(request, codeBody);
        json(response, 200, await workflow.requestDeliveryCode(body.assetId, body.requestId));
      } else if (request.url === "/delivery/verify") {
        const body = await readBody(request, verifyBody);
        json(response, 200, await workflow.verifyAndDeliver(body.assetId, body.code, body.requestId));
      } else {
        json(response, 404, { error: "route not found" });
      }
    } catch (error) {
      if (error instanceof ZodError || error instanceof SyntaxError) {
        json(response, 400, { error: "invalid request body" });
      } else if (error instanceof WorkflowError) {
        json(response, error.status, { error: error.message });
      } else if (error instanceof InfraiRequestError) {
        const status = error.status >= 400 && error.status < 500 ? error.status : 502;
        json(response, status, { error: error.message, code: error.code });
      } else {
        json(response, 500, { error: "internal service error" });
      }
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? "3000");
  const workflow = new CreatorDeliveryWorkflow(smsGatewayFromEnvironment());
  createCreatorDeliveryServer(workflow).listen(port, () => {
    console.log(`creator delivery service listening on http://localhost:${port}`);
  });
}
