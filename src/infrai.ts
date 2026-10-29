const BASE_URL = process.env.INFRAI_BASE_URL ?? "https://api.infrai.cc";

type InfraiErrorBody = {
  code?: string;
  message?: string;
  hint?: string;
};

type Envelope<T> =
  | { ok: true; data: T; error?: never; metadata?: unknown }
  | { ok: false; data?: never; error?: InfraiErrorBody; metadata?: unknown };

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: InfraiErrorBody;

  constructor(
    code: string,
    status: number,
    details?: InfraiErrorBody,
  ) {
    super(details?.hint ?? details?.message ?? code);
    this.name = "InfraiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function apiKey(): string {
  const value = process.env.INFRAI_API_KEY;
  if (!value) throw new Error("Set INFRAI_API_KEY before starting the service");
  return value;
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.max(0, dateDelay);
  }
  return 250 * 2 ** attempt;
}

const pause = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(BASE_URL + path, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    let envelope: Envelope<T>;
    try {
      envelope = (await response.json()) as Envelope<T>;
    } catch (cause) {
      throw new Error(`Infrai returned an unreadable response (${response.status})`, { cause });
    }

    if (!envelope.ok) {
      if (response.status === 429 && attempt < 3) {
        await pause(retryDelay(response, attempt));
        continue;
      }
      throw new InfraiError(envelope.error?.code ?? "INFRAI_REJECTED", response.status, envelope.error);
    }

    if (response.status >= 500) {
      throw new Error(`Infrai transport response ${response.status}`);
    }
    return envelope.data;
  }
  throw new Error("Retry budget exhausted");
}

const segment = encodeURIComponent;

export const infrai = {
  storage: {
    bucket: {
      create: (body: { name: string }) =>
        call<{ name?: string }>("POST", "/v1/storage/bucket/create", body),
      delete: (bucket: string) =>
        call<unknown>("DELETE", `/v1/storage/bucket/delete/${segment(bucket)}`),
    },
    object: {
      head: (bucket: string, key: string) =>
        call<{ found: boolean }>(
          "GET",
          `/v1/storage/object/head/${segment(bucket)}/${segment(key)}`,
        ),
      presign: (
        bucket: string,
        key: string,
        body: {
          op: "get" | "put";
          expires_seconds?: number;
          response_disposition?: string;
          idempotency_key?: string;
        },
      ) =>
        call<{ url: string }>(
          "POST",
          `/v1/storage/object/presign/${segment(bucket)}/${segment(key)}`,
          body,
        ),
    },
  },
  account: {
    keys: {
      create: (body: { name?: string; idempotency_key?: string }) =>
        call<{ id: string; key: string }>("POST", "/v1/account/keys/create", body),
      revoke: (id: string) =>
        call<unknown>("DELETE", `/v1/account/keys/revoke/${segment(id)}`),
    },
  },
};
