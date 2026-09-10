export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown) {
    const message = typeof body === "object" && body !== null && "error" in body ? String((body as { error: unknown }).error) : `HTTP ${status}`;
    super(message);
    this.status = status;
    this.body = body;
  }
}

/** Сессия истекла/отозвана — AuthContext слушает это и сбрасывает пользователя
 *  на ЛЮБОМ запросе, а не только на /api/auth/me (иначе страница просто
 *  показывает необъяснимую ошибку вместо возврата на логин). */
const UNAUTHORIZED_EVENT = "fleet:unauthorized";

async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: "include",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });

  const text = await response.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    // Не-JSON тело (например, HTML-страница ошибки от прокси) — не роняем
    // приложение необработанным SyntaxError, отдаём осмысленную ApiError.
    throw new ApiError(response.status, { error: response.ok ? "invalid_response" : `HTTP ${response.status}` });
  }

  if (!response.ok) {
    // /api/auth/login само по себе отдаёт 401 на неверный пароль — это не
    // "сессия отозвана", просто обычная ошибка формы входа.
    if (response.status === 401 && path !== "/api/auth/login" && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
    }
    throw new ApiError(response.status, data);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>("GET", path, undefined, signal),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body ?? {}),
  delete: <T>(path: string) => request<T>("DELETE", path),
};

export { UNAUTHORIZED_EVENT };
