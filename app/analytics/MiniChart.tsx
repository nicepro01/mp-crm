export type ChartSegment = { code: string; label: string; value: number; color: string };
export type ChartBar = { label: string; value: number; segments?: ChartSegment[] };

// Компактно форматирует число прямо на столбике (иначе полная сумма
// выручки в рублях просто не влезет над узким баром) — точное значение
// всё равно видно в подсказке при наведении (title).
function formatCompact(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}М`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}К`;
  return `${sign}${Math.round(abs)}`;
}

function formatValue(value: number, valueSuffix: string): string {
  return `${Math.round(value).toLocaleString("ru-RU")}${valueSuffix ? ` ${valueSuffix}` : ""}`;
}

// Лёгкий SVG-график без внешней библиотеки (в проекте её нет) — столбики по
// месяцам, значение подписано прямо на столбике (компактно) + полная сумма
// в подсказке при наведении. Резиновая ширина (viewBox + width="100%"),
// чтобы растягиваться на весь контейнер, а не оставаться мелкой картинкой.
// Если у точки данных задан `segments` — столбик составной (доля каждой
// площадки внутри месяца), иначе — обычный одноцветный.
export function MiniBarChart({
  data,
  color,
  height = 240,
  valueSuffix = "",
  showSegmentValues = false,
}: {
  data: ChartBar[];
  color: string;
  height?: number;
  valueSuffix?: string;
  // Число прямо на каждом сегменте (не только в тултипе при наведении) —
  // нужно там, где сегментов немного и по ним важно видеть точные цифры
  // без наведения (см. FunnelChartWidget). Для узких сегментов (< minHeight)
  // число не рисуется — иначе на паре пикселей текст просто нечитаем.
  showSegmentValues?: boolean;
}) {
  if (data.length === 0) {
    return <p className="muted">Нет данных за период.</p>;
  }

  const barWidth = 36;
  const gap = 16;
  const monthLabelHeight = 40; // место под подписи снизу (до 2 строк, без поворота)
  const valueLabelHeight = 18; // место над самым высоким столбиком под его подпись
  const plotWidth = data.length * (barWidth + gap) + gap;
  // Раньше подписи были повёрнуты на -40° — при малом числе баров (широкие
  // подписи вроде "Ozon возврат" на узкий viewBox) уходили за левый край и
  // обрезались (SVG по умолчанию обрезает всё вне viewBox). Теперь подписи
  // горизontальные, максимум в 2 строки (см. labelLines ниже) — не съезжают
  // вбок, поэтому и большой отступ по бокам больше не нужен, оставляем
  // небольшой запас на случай, если подпись сама по себе шире бара.
  const sidePadding = 20;
  const viewWidth = plotWidth + sidePadding * 2;
  const plotHeight = height - monthLabelHeight - valueLabelHeight;
  const maxAbs = Math.max(...data.map((d) => Math.abs(d.value)), 1);
  // Отрицательные значения (напр. убыточный месяц) уходят вниз от нулевой линии.
  const hasNegative = data.some((d) => d.value < 0);
  const zeroY = valueLabelHeight + (hasNegative ? plotHeight / 2 : plotHeight);
  const scale = (hasNegative ? plotHeight / 2 : plotHeight) / maxAbs;

  return (
    <svg
      viewBox={`0 0 ${viewWidth} ${height}`}
      width="100%"
      height={height}
      style={{ display: "block", minWidth: 360 }}
    >
      {hasNegative && (
        <line x1={0} y1={zeroY} x2={viewWidth} y2={zeroY} stroke="var(--border)" strokeWidth={1} />
      )}
      {data.map((d, i) => {
        const x = sidePadding + gap + i * (barWidth + gap);
        const barHeight = Math.max(1, Math.abs(d.value) * scale);
        const y = d.value >= 0 ? zeroY - barHeight : zeroY;
        const centerX = x + barWidth / 2;
        const monthLabelY = zeroY + (hasNegative ? plotHeight / 2 : 0) + 14;
        const valueLabelY = d.value >= 0 ? y - 6 : y + barHeight + 12;
        // Подсказка при наведении — через SVG-атрибут title (не элемент
        // <title>): Next.js перехватывает любой <title>-ЭЛЕМЕНТ в дереве как
        // заголовок страницы и обнуляет его содержимое (даже внутри SVG) —
        // проверено на практике, подсказки были пустые. Атрибут этой
        // проблеме не подвержен — браузер всё равно показывает нативный
        // тултип при наведении.
        const segments = d.segments?.filter((s) => s.value > 0);
        const tooltip =
          segments && segments.length > 0
            ? `${d.label}: ${segments.map((s) => `${s.label} ${formatValue(s.value, valueSuffix)}`).join(", ")} (итого ${formatValue(d.value, valueSuffix)})`
            : `${d.label}: ${formatValue(d.value, valueSuffix)}`;
        // Подпись — максимум в 2 строки, без поворота (раньше повёрнутый
        // текст обрезался за краем viewBox при узких/малочисленных барах, см.
        // sidePadding выше). Разбиваем по последнему пробелу: "янв 2026" →
        // "янв"/"2026", "Ozon возврат" → "Ozon"/"возврат"; если пробела нет —
        // одна строка.
        const words = d.label.split(" ");
        const labelLine1 = words.length > 1 ? words.slice(0, -1).join(" ") : d.label;
        const labelLine2 = words.length > 1 ? words[words.length - 1] : null;

        return (
          <g key={d.label}>
            {segments && segments.length > 0 ? (
              (() => {
                // Составной столбик — сегменты друг на друге от нулевой линии
                // (вверх для положительных, вниз для отрицательных), тем же
                // масштабом (scale), что и общий столбик, — сумма высот
                // сегментов совпадает с высотой обычного бара для того же total.
                let cursor = zeroY;
                const minLabelHeight = 12; // меньше — цифра физически не влезает, не рисуем
                return segments.map((s) => {
                  const segHeight = Math.max(0, Math.abs(s.value) * scale);
                  const segY = d.value >= 0 ? cursor - segHeight : cursor;
                  cursor = d.value >= 0 ? segY : cursor + segHeight;
                  const segTooltip = `${d.label} · ${s.label}: ${formatValue(s.value, valueSuffix)}`;
                  return (
                    <g key={s.code}>
                      <rect
                        x={x}
                        y={segY}
                        width={barWidth}
                        height={segHeight}
                        fill={s.color}
                        // @ts-expect-error -- title как SVG-атрибут не в типах React для <rect>
                        title={segTooltip}
                      />
                      {showSegmentValues && segHeight >= minLabelHeight && (
                        <text
                          x={centerX}
                          y={segY + segHeight / 2 + 3}
                          textAnchor="middle"
                          fontSize={9}
                          fontWeight={600}
                          fill="#fff"
                          // @ts-expect-error -- см. комментарий выше про <rect>
                          title={segTooltip}
                        >
                          {Math.round(s.value)}
                        </text>
                      )}
                    </g>
                  );
                });
              })()
            ) : (
              // @ts-expect-error -- title как SVG-атрибут не в типах React для <rect>
              <rect x={x} y={y} width={barWidth} height={barHeight} fill={color} rx={3} title={tooltip} />
            )}
            <text x={centerX} y={valueLabelY} textAnchor="middle" fontSize={11} fontWeight={600} fill={color}>
              {formatCompact(d.value)}
            </text>
            <text
              x={centerX}
              y={monthLabelY}
              textAnchor="middle"
              fontSize={11}
              fill="var(--muted)"
              // @ts-expect-error -- см. комментарий выше про <rect>
              title={tooltip}
            >
              <tspan x={centerX} dy={0}>
                {labelLine1}
              </tspan>
              {labelLine2 && (
                <tspan x={centerX} dy={13}>
                  {labelLine2}
                </tspan>
              )}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
