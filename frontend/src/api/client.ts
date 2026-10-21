/** Error thrown for non-2xx responses, carrying the server's `detail` message when present. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function parseResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // non-JSON body, keep raw text for the error message
  }
  if (!res.ok) {
    const detail = (body as { detail?: unknown } | null)?.detail;
    const message = typeof detail === "string" ? detail : detail ? JSON.stringify(detail) : text || res.statusText;
    throw new ApiError(res.status, `Server returned ${res.status}: ${message}`);
  }
  return body as T;
}

export async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  return parseResponse<T>(await fetch(url, { signal }));
}

export async function postJson<T>(url: string, payload: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  return parseResponse<T>(res);
}

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}
