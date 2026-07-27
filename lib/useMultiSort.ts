"use client";

import { useState } from "react";

export type SortDir = "asc" | "desc";
export type PinnedSort<K extends string> = { key: K; dir: SortDir };

/**
 * Двухуровневая сортировка: можно "закрепить" одну колонку первым уровнем
 * (иконка-булавка в заголовке) — тогда обычный клик по другой колонке не
 * заменяет сортировку, а становится вторым уровнем (разрешает порядок
 * внутри групп с одинаковым значением закреплённой колонки). Клик по самой
 * закреплённой колонке переключает её направление, не снимая закрепление.
 */
export function useMultiSort<K extends string>(initialKey: K, initialDir: SortDir = "asc") {
  const [pinned, setPinned] = useState<PinnedSort<K> | null>(null);
  const [sortKey, setSortKey] = useState<K>(initialKey);
  const [sortDir, setSortDir] = useState<SortDir>(initialDir);

  function handleSort(key: K) {
    if (pinned && pinned.key === key) {
      setPinned({ key, dir: pinned.dir === "asc" ? "desc" : "asc" });
      return;
    }
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function togglePin(key: K) {
    setPinned((prev) => {
      if (prev && prev.key === key) return null;
      const dir = !prev && sortKey === key ? sortDir : "asc";
      return { key, dir };
    });
  }

  return { pinned, sortKey, sortDir, handleSort, togglePin };
}

/**
 * Сортирует rows с учётом закреплённого первого уровня (если есть) и
 * обычного второго — compareByKey должен уметь сравнить два элемента по
 * произвольному key/dir (своя логика для каждой таблицы: какие поля есть,
 * как их сравнивать).
 */
export function applyMultiSort<T, K extends string>(
  rows: T[],
  compareByKey: (a: T, b: T, key: K, dir: SortDir) => number,
  pinned: PinnedSort<K> | null,
  sortKey: K,
  sortDir: SortDir
): T[] {
  return [...rows].sort((a, b) => {
    if (pinned) {
      const primary = compareByKey(a, b, pinned.key, pinned.dir);
      if (primary !== 0) return primary;
      if (sortKey === pinned.key) return 0;
      return compareByKey(a, b, sortKey, sortDir);
    }
    return compareByKey(a, b, sortKey, sortDir);
  });
}
