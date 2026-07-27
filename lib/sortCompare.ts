export function compareForSort(
  a: unknown,
  b: unknown,
  type: "string" | "number" = "string",
  dir: "asc" | "desc" = "asc"
): number {
  const aEmpty = a === null || a === undefined || a === "";
  const bEmpty = b === null || b === undefined || b === "";
  // Пустые значения всегда в конце, независимо от направления сортировки —
  // поэтому направление применяется только к результату сравнения двух
  // настоящих значений, а не переворотом всего массива целиком (иначе
  // пустые оказались бы в начале при сортировке по убыванию).
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;

  const result = type === "number" ? Number(a) - Number(b) : String(a).localeCompare(String(b), "ru");
  return dir === "asc" ? result : -result;
}
