# syntax=docker/dockerfile:1.7

# ─── Build stage ────────────────────────────────────────────────────────────
FROM oven/bun:1 AS build

WORKDIR /app

COPY package.json bun.lock* ./
COPY prisma ./prisma/

RUN bun install --frozen-lockfile

COPY . .

# DATABASE_URL не нужен для генерации в Prisma 7 (новый prisma-client + adapter-pg
# без бинарника engine), но prisma.config.ts читает env при загрузке — даём
# dummy чтобы не падать с "DATABASE_URL not set" на этапе сборки.
RUN DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" bunx prisma generate
RUN bun run build

# ─── Runtime stage ──────────────────────────────────────────────────────────
FROM oven/bun:1-slim

WORKDIR /app

# ffmpeg/ffprobe — рендер видео, субтитров, превью, lip-sync
# yt-dlp_linux — статический PyInstaller бинарь, python на хосте не нужен
# (используется server/utils/video-tools/yt-dlp.ts через youtube-dl-exec)
# ffmpeg обязателен (рендер) — ставится из стабильных Debian-зеркал, fatal.
# yt-dlp качается с GitHub-релизов и потому ХРУПОК: ассет может временно отдать
# 404/403 (rate-limit/outage), и `curl -fL` без ретраев ронял ВЕСЬ build → деплой
# падал и откатывался (прод-инцидент 08.06: yt-dlp_linux вернул HTTP-ошибку, build
# умер). yt-dlp нужен ТОЛЬКО для загрузки внешних видео (youtube-dl-exec), НЕ для
# постинга — поэтому: (1) curl с ретраями (transient), (2) best-effort: при провале
# чистим частичный файл + WARN и продолжаем (постинг и весь остальной деплой не
# должны зависеть от блипа GitHub; yt-dlp доедет на следующей успешной сборке).
# Шаг 1 (FATAL): ffmpeg/curl/ca-certificates из стабильных Debian-зеркал. Отдельный
# RUN — чтобы провал yt-dlp (шаг 2) НЕ маскировал реальный провал apt (иначе
# `&& ... || ...` в одном RUN сделал бы и ffmpeg-фейл «мягким»).
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl ffmpeg \
 && rm -rf /var/lib/apt/lists/*

# Шаг 2 (BEST-EFFORT): yt-dlp с GitHub-релизов — ХРУПКО (ассет временами 404/403:
# rate-limit/outage). `curl -fL` без ретраев ронял ВЕСЬ build → деплой падал/откат
# (прод-инцидент 08.06). yt-dlp нужен ТОЛЬКО для загрузки внешних видео
# (youtube-dl-exec), НЕ для постинга. Поэтому: curl с ретраями + при провале чистим
# частичный файл, WARN и продолжаем (deploy не зависит от блипа GitHub; yt-dlp
# доедет на следующей успешной сборке).
RUN ( curl -fL --retry 5 --retry-delay 3 --retry-all-errors --connect-timeout 30 \
        https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux \
        -o /usr/local/bin/yt-dlp \
      && chmod +x /usr/local/bin/yt-dlp \
      && /usr/local/bin/yt-dlp --version ) \
 || { rm -f /usr/local/bin/yt-dlp; echo "WARN: yt-dlp install failed (GitHub asset unavailable / rate-limit) — деплой продолжается БЕЗ yt-dlp; загрузка внешних видео недоступна до пере-сборки"; }

# ─── Indigo X agent + Xvfb (headless browser automation) ──────────────────
# Indigo agent (launcher) запускает реальный Chrome для anti-detect posting.
# Поскольку Saturn cloud не имеет route к launcher.indigobrowser.com:45011
# через интернет — bundle agent прямо в контейнер, INDIGO_LAUNCHER_BASE
# указывает на 127.0.0.1:45011. Профили хранятся в Indigo Cloud Storage
# (см. build-create-body.ts storage.is_local=false), state переживает
# ephemeral redeploy. Xvfb (virtual framebuffer X server) даёт agent'у
# display server т.к. контейнер без GUI.
#
# Зависимости для Chromium runtime в Debian bookworm (bun:1-slim base):
#   libgtk-3-0, libnss3, libxss1, libxtst6 — base GUI libs
#   libatspi2.0-0 — accessibility (Chrome bootstraps это даже headless)
#   libdrm2, libgbm1 — GPU compositing (нужны даже с --disable-gpu)
#   libxcb-dri3-0, libxcomposite1, libxdamage1, libxfixes3, libxkbcommon0 — X11
#   libasound2 — audio stack (Chrome не запускается без)
#   libpango-1.0-0, libcairo2 — text rendering
#   fonts-liberation, fonts-noto-color-emoji — fallback шрифты для веб-страниц
#
# Indigo deb распакуется в /opt и/или /usr/bin — точный путь binary
# логируется через dpkg -L (см. fallback chain в entrypoint.sh).
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      xvfb \
      libgtk-3-0 libnotify4 libnss3 libxss1 libxtst6 \
      libatspi2.0-0 libdrm2 libgbm1 libxcb-dri3-0 \
      libxcomposite1 libxdamage1 libxfixes3 libxkbcommon0 \
      libasound2 libpango-1.0-0 libcairo2 \
      fonts-liberation fonts-noto-color-emoji \
 && curl -fL "https://indigodists.s3.eu-west-3.amazonaws.com/indigo/latest/indigox-amd64.deb" \
        -o /tmp/indigox.deb \
 && (dpkg -i /tmp/indigox.deb || apt-get install -f -y) \
 && rm /tmp/indigox.deb \
 && echo "── Indigo install paths ──" \
 && (dpkg -L indigox 2>/dev/null | grep -E '(bin/|/indigo$|\.desktop$)' || echo "WARN: dpkg -L indigox empty") \
 # Indigo deb распаковывает binary/launcher-script с потерянным +x флагом
 # (наблюдалось на Saturn deploy: /usr/bin/indigo Permission denied).
 # Используем `while IFS= read -r` НЕ `for f in $(...)` потому что Indigo
 # реально устанавливается в `/opt/Indigo X/...` (с пробелом в имени папки),
 # а shell word-splitting в `for ... in $(...)` разрезает путь по пробелу
 # → chmod бьёт мимо. `IFS=` сохраняет полный path с пробелами.
 && dpkg -L indigox 2>/dev/null | grep -E '(/bin/|/indigo$|\.so$)' | while IFS= read -r f; do \
      if [ -f "$f" ]; then \
        chmod +x "$f" 2>/dev/null && echo "  +x $f" || echo "  ! chmod failed: $f"; \
      fi; \
    done \
 # Дополнительный safety net - explicit chmod на типичные пути
 # (whitelist на случай если dpkg -L по какой-то причине пустой).
 && for path in "/usr/bin/indigo" "/opt/Indigo X/indigo" "/opt/indigox/indigo" "/usr/local/bin/indigo"; do \
      if [ -f "$path" ]; then chmod +x "$path" 2>/dev/null && echo "  +x (whitelist) $path"; fi; \
    done \
 # Финальная проверка что хотя бы один путь реально executable.
 && (test -x "/usr/bin/indigo" && echo "OK: /usr/bin/indigo is executable" \
     || test -x "/opt/Indigo X/indigo" && echo "OK: /opt/Indigo X/indigo is executable" \
     || test -x "/opt/indigox/indigo" && echo "OK: /opt/indigox/indigo is executable" \
     || echo "WARN: ни один кандидат indigo не executable - entrypoint напишет WARN на старте") \
 && (which indigo || ls -la /opt/*/indigo /usr/bin/indigo* 2>/dev/null || echo "WARN: indigo binary not in default PATH") \
 && rm -rf /var/lib/apt/lists/*

# ─── Multilogin X agent (провайдер за ANTIDETECT_PROVIDER=multilogin) ─────────
# Multilogin и Indigo — API-близнецы; держим оба агента в образе, entrypoint.sh
# стартует нужный по ANTIDETECT_PROVIDER (default indigo). Xvfb и Chromium-либы
# уже установлены выше (Mimic = тот же Chromium) — нужен только сам deb.
# Бинарь: /usr/bin/mlx, launcher слушает 127.0.0.1:45001 (hostname launcher.mlx.yt).
# Best-effort: если deb недоступен — build НЕ падает (ломается только multilogin-
# путь, прод на Indigo не затрагивается).
RUN apt-get update; \
    if curl -fL "https://mlxdists.s3.eu-west-3.amazonaws.com/mlx/latest/multiloginx-amd64.deb" -o /tmp/multiloginx.deb; then \
      (dpkg -i /tmp/multiloginx.deb || apt-get install -f -y) || echo "WARN: mlx dpkg install issues"; \
      rm -f /tmp/multiloginx.deb; \
      if [ -x /usr/bin/mlx ]; then \
        echo "OK: /usr/bin/mlx is executable"; \
      else \
        echo "WARN: /usr/bin/mlx не найден после install"; \
        dpkg -L multiloginx 2>/dev/null | grep -E 'bin/' || true; \
      fi; \
    else \
      echo "WARN: Multilogin deb download failed — build continues (affects only ANTIDETECT_PROVIDER=multilogin)"; \
    fi; \
    rm -rf /var/lib/apt/lists/*

COPY --from=build /app/.output .output
COPY --from=build /app/prisma ./prisma/
COPY --from=build /app/prisma.config.ts ./
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/app/generated ./app/generated
# Кастомные шрифты для libass/drawtext (server/utils/subtitles/font-resolver.ts).
# Это часть проекта, не пользовательские данные — копируем в образ, не в volume.
COPY --from=build /app/storage/fonts ./storage/fonts

# Persistent storage для пользовательских файлов:
# видео, references, субтитры, app-references, unique-variants, _mock_cache,
# а также frames/<videoId>/<seq>.jpg (marketing-grade анализ креативов).
# В проде — mount host volume / named volume на этот путь.
RUN mkdir -p /app/storage/uploads /app/storage/frames && chmod 755 /app/storage
VOLUME /app/storage/uploads
VOLUME /app/storage/frames

ENV HOST=0.0.0.0
ENV PORT=3000
ENV YT_DLP_BIN_PATH=/usr/local/bin/yt-dlp
EXPOSE 3000

COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

CMD ["./entrypoint.sh"]
