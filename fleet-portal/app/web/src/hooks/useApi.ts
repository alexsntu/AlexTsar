import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { describeError } from "../api/errors";

export function useApi<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Запрос в полёте для ЭТОГО хука — если фильтры сменились до ответа,
  // отменяем старый запрос, чтобы его результат не перезаписал новый
  // (гонка: быстрая смена фильтров, старый ответ приходит позже нового).
  const controllerRef = useRef<AbortController | null>(null);

  const reload = useCallback(async () => {
    if (!path) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    setLoading(true);
    setError(null);
    try {
      const result = await api.get<T>(path, controller.signal);
      setData(result);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(describeError(err));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);

  useEffect(() => {
    void reload();
    return () => controllerRef.current?.abort();
  }, [reload]);

  return { data, loading, error, reload };
}
