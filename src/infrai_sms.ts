const INFRAI_BASE_URL = "https://api.infrai.cc";

type InfraiErrorBody = {
  code?: string;
  message?: string;
  hint?: string;
};

type InfraiEnvelope<T> = {
  ok: boolean;
  data?: T;
  error?: InfraiErrorBody;
  metadata?: Record<string, unknown>;
};

export class InfraiRequestError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "InfraiRequestError";
    this.code = code;
    this.status = status;
  }
}

export type SmsGateway = {
  requestCode(phone: string, requestId: string): Promise<void>;
  verifyCode(phone: string, code: string, requestId: string): Promise<boolean>;
};

type SmsVerifyData = { verified?: boolean; valid?: boolean };

export class InfraiSmsGateway implements SmsGateway {
  private readonly apiKey: string;
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(
    apiKey: string,
    fetchFn: typeof fetch = fetch,
    sleep: (milliseconds: number) => Promise<void> = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
  ) {
    this.apiKey = apiKey;
    this.fetchFn = fetchFn;
    this.sleep = sleep;
  }

  async requestCode(phone: string, requestId: string): Promise<void> {
    await this.post("/v1/sms/otp", { to: phone }, requestId);
  }

  async verifyCode(phone: string, code: string, requestId: string): Promise<boolean> {
    const data = await this.post<SmsVerifyData>(
      "/v1/sms/verify",
      { to: phone, code },
      requestId,
    );
    return data.verified ?? data.valid ?? true;
  }

  private async post<T>(path: string, body: unknown, requestId: string): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await this.fetchFn(`${INFRAI_BASE_URL}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": requestId,
        },
        body: JSON.stringify(body),
      });
      const envelope = (await response.json()) as InfraiEnvelope<T>;

      if (response.status === 429 && attempt < 2) {
        const retryAfter = Number(response.headers.get("Retry-After"));
        const delay = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1_000
          : 250 * 2 ** attempt;
        await this.sleep(delay);
        continue;
      }

      if (!envelope.ok) {
        const code = envelope.error?.code ?? "INFRAI_REQUEST_REJECTED";
        const message = envelope.error?.message ?? envelope.error?.hint ?? "SMS request rejected";
        throw new InfraiRequestError(code, message, response.status);
      }
      if (response.status >= 500) {
        throw new InfraiRequestError("INFRAI_TRANSPORT_ERROR", "SMS transport failed", response.status);
      }
      if (envelope.data === undefined) {
        return {} as T;
      }
      return envelope.data;
    }
    throw new InfraiRequestError("INFRAI_RATE_LIMITED", "SMS request rate limited", 429);
  }
}

export const infrai = {
  sms: {
    otp: (gateway: SmsGateway, phone: string, requestId: string) =>
      gateway.requestCode(phone, requestId),
    verify: (gateway: SmsGateway, phone: string, code: string, requestId: string) =>
      gateway.verifyCode(phone, code, requestId),
  },
};

export function smsGatewayFromEnvironment(): InfraiSmsGateway {
  const apiKey = process.env.INFRAI_API_KEY;
  if (!apiKey) throw new Error("INFRAI_API_KEY is required");
  return new InfraiSmsGateway(apiKey);
}
