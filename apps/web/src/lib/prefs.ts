import { useEffect, useState } from "react";

/** A piece of UI state remembered per browser (tab choice, grouping, collapsed groups...). */
export function usePref<T>(key: string, initial: T): [T, (v: T | ((prev: T) => T)) => void] {
  const storageKey = `vellum:pref:${key}`;
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      /* private mode or quota: preference just isn't remembered */
    }
  }, [storageKey, value]);
  return [value, setValue];
}
