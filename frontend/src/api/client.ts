import { getStoredClientId } from "../utils/telemetry";

/** Error thrown for non-2xx responses, carrying the server's `detail` message when present. */
export class ApiError extends Error {
  readonly status: number;
  readonly detail: unknown;

  constructor(status: number, message: string, detail?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

let expectedAuthUser: string | null = null;
let sessionMismatchHandler: ((status: 401 | 409) => void) | null = null;

export function setExpectedAuthUser(username: string | null): void {
  expectedAuthUser = username;
}

export function setSessionMismatchHandler(handler: ((status: 401 | 409) => void) | null): void {
  sessionMismatchHandler = handler;
}

function buildSyncHeaders(url: string, extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...(extra ?? {}) };
  if (
    expectedAuthUser &&
    (url.startsWith("/draft/session") ||
      url.startsWith("/draft/practice-history") ||
      url.startsWith("/combat/builds"))
  ) {
    headers["X-Expected-User"] = expectedAuthUser;
  }
  return headers;
}

async function parseResponse<T>(res: Response, checkedSyncAuth: boolean): Promise<T> {
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // non-JSON body, keep raw text for the error message
  }
  if (!res.ok) {
    if (checkedSyncAuth && (res.status === 401 || res.status === 409)) {
      sessionMismatchHandler?.(res.status);
    }
    const detail = (body as { detail?: unknown } | null)?.detail;
    const message = typeof detail === "string" ? detail : detail ? JSON.stringify(detail) : text || res.statusText;
    throw new ApiError(res.status, `Server returned ${res.status}: ${message}`, detail);
  }
  return body as T;
}

export async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const headers = buildSyncHeaders(url);
  return parseResponse<T>(await fetch(url, { headers, signal }), Boolean(headers["X-Expected-User"]));
}

export async function postJson<T>(url: string, payload: unknown, signal?: AbortSignal): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (url.startsWith("/predict")) {
    const cid = getStoredClientId();
    if (cid) headers["X-Client-Id"] = cid;
  }
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal,
  });
  return parseResponse<T>(res, false);
}

export async function putJson<T>(url: string, payload: unknown, signal?: AbortSignal): Promise<T> {
  const headers = buildSyncHeaders(url, { "Content-Type": "application/json" });
  const res = await fetch(url, {
    method: "PUT",
    headers,
    body: JSON.stringify(payload),
    signal,
  });
  return parseResponse<T>(res, Boolean(headers["X-Expected-User"]));
}

export async function deleteJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const headers = buildSyncHeaders(url);
  const res = await fetch(url, {
    method: "DELETE",
    headers,
    signal,
  });
  return parseResponse<T>(res, Boolean(headers["X-Expected-User"]));
}

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}
