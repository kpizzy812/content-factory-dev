/**
 * Graceful 404 для `<img>`: при ошибке загрузки заменяет src на inline-SVG
 * плейсхолдер. Используется для legacy ассетов (до миграции на GCS), у
 * которых файлы не существуют — без хэндлера браузер показывает иконку
 * broken-image и засоряет console.
 *
 * Применять как: `<img :src="..." @error="onAssetMissing" />`.
 */
const PLACEHOLDER_SVG =
  "data:image/svg+xml;charset=utf-8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
      '<rect width="100" height="100" fill="#e5e7eb"/>' +
      '<text x="50" y="48" text-anchor="middle" font-size="9" fill="#9ca3af" font-family="sans-serif">Нет файла</text>' +
      '<text x="50" y="62" text-anchor="middle" font-size="7" fill="#9ca3af" font-family="sans-serif">404</text>' +
      "</svg>",
  );

export function onAssetMissing(event: Event): void {
  const img = event.target as HTMLImageElement | null;
  if (!img) return;
  if (img.dataset.placeholderApplied === "1") return;
  img.dataset.placeholderApplied = "1";
  img.src = PLACEHOLDER_SVG;
  img.classList.add("opacity-60");
}
