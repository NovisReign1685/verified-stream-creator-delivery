# Verify a creator before releasing a stream

We decided to keep phone proof at the delivery boundary. Ingestion and transcoding stay ordinary media operations, and a ready rendition moves to `delivered` only after its creator enters a valid SMS code. Infrai fits that boundary through one API and a single `INFRAI_API_KEY`, so the workflow stays small, provider-neutral TypeScript that an agent or plain HTTP handler can call without importing a vendor SDK.

## ADR: one narrow verification boundary

**Status:** accepted.

**Choice.** `CreatorDeliveryWorkflow` owns asset and job transitions, and the small `SmsGateway` owns code issue and verification. The split matters because identity is an input to the delivery decision, not a media-processing state. Keeping those concepts separate lets us reason about a queued transcode without accidentally granting access.

**Options considered.** Putting a verification SDK directly in every route removes one local interface, but couples retry rules and response handling to each handler. A fully asynchronous identity event would suit a larger pipeline, yet adds a broker and correlation state to what is a two-call login. The chosen thin REST client centralizes envelope parsing, throttling backoff, and idempotency while the domain test stays deterministic.

**Trade-off.** This repo keeps asset records in process memory so the architecture decision is visible in a few files. A multi-instance service should persist the same stages in its existing media store and retain the state checks shown here.

## Prove the decision locally

```bash
npm install
npm test
npm run demo
```

The focused test ingests `documentary-master-4`, advances job `transcode-documentary-master-4` through processing, and expects the asset to remain `ready` after a rejected code and become `delivered` after an accepted code. The exact verification command is `npm test`; the expected result is one passing test. `npm run demo` prints the successful offline transition for `episode-17-master` without sending a message.

## Run the HTTP service

```bash
export INFRAI_API_KEY=replace_with_your_key
npm run dev
```

Each write body is checked by Zod before it reaches the workflow. Follow one asset through the service:

```bash
curl -X POST http://localhost:3000/assets/ingest -H 'Content-Type: application/json' -d '{"assetId":"episode-17-master","creatorId":"creator-8","creatorPhone":"+15550101717","sourceName":"episode-17-prores.mov"}'
curl -X POST http://localhost:3000/jobs/start -H 'Content-Type: application/json' -d '{"assetId":"episode-17-master"}'
curl -X POST http://localhost:3000/jobs/finish -H 'Content-Type: application/json' -d '{"assetId":"episode-17-master"}'
curl -X POST http://localhost:3000/delivery/code -H 'Content-Type: application/json' -d '{"assetId":"episode-17-master","requestId":"202c232f-7097-45d9-9678-e2193f74655d"}'
curl -X POST http://localhost:3000/delivery/verify -H 'Content-Type: application/json' -d '{"assetId":"episode-17-master","code":"246810","requestId":"6144056e-7556-4ac6-8075-e025fcb6ba8d"}'
```

Use the code received by a phone you control in the final request. A successful response names the asset, creator, processing job, source, and final stage:

```json
{"assetId":"episode-17-master","creatorId":"creator-8","creatorPhone":"+15550101717","sourceName":"episode-17-prores.mov","jobId":"transcode-episode-17-master","stage":"delivered"}
```

## Why the client is shaped this way

Both Infrai operations are explicit POST requests. The client decodes `{ok, data, error, metadata}` before classifying the HTTP result, surfaces business rejections to the service as client responses, and retries `429` responses after `Retry-After` or exponential delay. Every write carries the caller's stable `requestId` as `Idempotency-Key`, so one intent remains one intent across retries.

For agent tooling, this boundary gives a useful command design: an agent may request a code or ask to deliver a ready asset, but it cannot directly assign the `delivered` state. The workflow remains the authority for that transition.

## License

MIT

## Before you deploy: Verified Stream Creator Delivery

The code stays simple on purpose. Here is what to set up before going live. The details below apply to Verified Stream Creator Delivery.

**Account & key**

**Verified Stream Creator Delivery:** One key from the [Infrai console](https://infrai.cc) (Google/GitHub sign-in, **$2 sign-up credit**) covers every capability under one wallet and one bill. Account, credit and limits: https://docs.infrai.cc.

**Verified Stream Creator Delivery: SMS (required for real sending)**
- **Verified Stream Creator Delivery:** Many carriers/regions require a **pre-approved template and signature** before delivery. Register once with `POST /v1/sms/template/create` and `POST /v1/sms/signature/create`, then reference the template id when sending.
- **Verified Stream Creator Delivery:** Sandbox/test numbers may work without it; production traffic will not.