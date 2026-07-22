#!/bin/bash
set -e

# ─── Pre-flight checks ─────────────────────────────────────────────────────
echo "==> Pre-flight checks..."

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "FATAL: ffmpeg is not installed. Video render и lip-sync работать не будут." >&2
  exit 1
fi
if ! command -v ffprobe >/dev/null 2>&1; then
  echo "FATAL: ffprobe is not installed." >&2
  exit 1
fi
# yt-dlp — НЕ fatal: нужен ТОЛЬКО для reference-video pipeline (загрузка внешних
# видео), НЕ для постинга/раздачи/рендера. GitHub-релиз-ассет флакает (404/rate-limit),
# и Dockerfile ставит yt-dlp best-effort → бинарь может отсутствовать. Если из-за
# этого падать (exit 1) — контейнер уходит в crash-loop и деплой откатывается
# (прод-инцидент 08.06). Поэтому только WARN; доустановится на следующей сборке,
# когда GitHub отдаст ассет.
YT_DLP_OK=0
if command -v yt-dlp >/dev/null 2>&1; then
  YT_DLP_OK=1
else
  echo "WARN: yt-dlp не установлен — reference-video pipeline недоступен (постинг и остальное работают)." >&2
fi

echo "  ffmpeg:  $(ffmpeg -version 2>&1 | head -n1)"
echo "  ffprobe: $(ffprobe -version 2>&1 | head -n1)"
if [ "$YT_DLP_OK" = "1" ]; then
  echo "  yt-dlp:  $(yt-dlp --version 2>&1)"
else
  echo "  yt-dlp:  (не установлен)"
fi

# Indigo X agent опционален. Pre-flight здесь только определяет путь к binary
# и пишет в лог — fail НЕ делаем (некоторые деплои не используют Indigo,
# например локальный dev на host machine где launcher запускается вручную).
# Сам старт agent в самом конце, перед `exec bun ...`.
INDIGO_AGENT_ENABLED="${INDIGO_AGENT_ENABLED:-true}"
INDIGO_BIN=""
if [ "$INDIGO_AGENT_ENABLED" = "true" ]; then
  if command -v indigo >/dev/null 2>&1; then
    INDIGO_BIN="$(command -v indigo)"
  elif [ -x "/opt/Indigo X/indigo" ]; then
    INDIGO_BIN="/opt/Indigo X/indigo"
  elif [ -x "/opt/indigox/indigo" ]; then
    INDIGO_BIN="/opt/indigox/indigo"
  else
    # Last resort: пройтись по dpkg -L (если пакет реально installed).
    # head -n1 берёт первый кандидат — для большинства deb это main binary.
    DPKG_CANDIDATE=$(dpkg -L indigox 2>/dev/null | grep -E '(bin/indigo|/indigo)$' | head -n1 || true)
    if [ -n "$DPKG_CANDIDATE" ] && [ -x "$DPKG_CANDIDATE" ]; then
      INDIGO_BIN="$DPKG_CANDIDATE"
    fi
  fi

  if [ -n "$INDIGO_BIN" ]; then
    echo "  indigo:  $INDIGO_BIN"
  else
    echo "  WARN: indigo binary не найден, но INDIGO_AGENT_ENABLED=true." >&2
    echo "        Indigo posting работать не будет. Set INDIGO_AGENT_ENABLED=false чтобы убрать warning." >&2
  fi
fi

# Проверка обязательных секретов (fail-fast на missing config)
: "${DATABASE_URL:?FATAL: DATABASE_URL не задан}"
: "${NUXT_SESSION_PASSWORD:?FATAL: NUXT_SESSION_PASSWORD не задан}"
: "${ENCRYPTION_KEY:?FATAL: ENCRYPTION_KEY не задан (требуется openssl rand -hex 32)}"
if [ "${CONTENT_FACTORY_ENV:-production}" = "development" ] && [ "${DEV_AUTH_ENABLED:-false}" = "true" ]; then
  : "${DEV_AUTH_EMAIL:?FATAL: DEV_AUTH_EMAIL is not set}"
  : "${DEV_AUTH_PASSWORD:?FATAL: DEV_AUTH_PASSWORD is not set}"
  echo "  auth: isolated ContentFactory development login"
else
  : "${MARKETING_CAMP_URL:?FATAL: MARKETING_CAMP_URL is not set}"
  : "${INTER_SERVICE_API_KEY:?FATAL: INTER_SERVICE_API_KEY is not set}"
  : "${ZAVOD_API_KEY:?FATAL: ZAVOD_API_KEY is not set}"
  echo "  MARKETING_CAMP_URL:    $MARKETING_CAMP_URL"
  echo "  INTER_SERVICE_API_KEY: (set, length ${#INTER_SERVICE_API_KEY})"
  echo "  ZAVOD_API_KEY:         (set, length ${#ZAVOD_API_KEY})"
fi

# Длина ENCRYPTION_KEY должна быть ровно 64 hex-символа (32 байта для AES-256-GCM).
# server/utils/crypto.ts падает с 500 если не подходит, но лучше упасть сразу.
KEY_LEN=${#ENCRYPTION_KEY}
if [ "$KEY_LEN" -ne 64 ]; then
  echo "FATAL: ENCRYPTION_KEY должен быть ровно 64 hex-символа (32 байта). Сейчас: $KEY_LEN." >&2
  echo "       Сгенерировать: openssl rand -hex 32" >&2
  exit 1
fi

# Storage для пользовательских файлов (volume mount).
# UPLOADS_STORAGE_PATH перебивает дефолт — используется когда persistent disk
# платформы смонтирован в нестандартное место (Render/Fly/Saturn).
UPLOADS_DIR="${UPLOADS_STORAGE_PATH:-/app/storage/uploads}"
mkdir -p "$UPLOADS_DIR"
echo "  storage: $UPLOADS_DIR ($(du -sh "$UPLOADS_DIR" 2>/dev/null | cut -f1))"

# Disk-mount sanity: предупреждаем если точка монтирования — это просто директория
# в overlayfs контейнера (не отдельный persistent disk). На saturn.ac/Render/Fly
# без явной привязки диска весь контент сгенерированных видео исчезнет при следующем
# deploy — пользователь потеряет деньги, потраченные на генерацию.
MOUNT_FS=$(df -PT "$UPLOADS_DIR" 2>/dev/null | awk 'NR==2 {print $2}')
ROOT_FS=$(df -PT / 2>/dev/null | awk 'NR==2 {print $2}')
MOUNT_DEV=$(df -P "$UPLOADS_DIR" 2>/dev/null | awk 'NR==2 {print $1}')
ROOT_DEV=$(df -P / 2>/dev/null | awk 'NR==2 {print $1}')
echo "  storage fs: $MOUNT_FS on $MOUNT_DEV"
if [ "$MOUNT_DEV" = "$ROOT_DEV" ]; then
  echo "  WARN: $UPLOADS_DIR находится на том же устройстве что и корневая ФС ($ROOT_DEV)." >&2
  echo "        Если это persistent disk платформы — ОК. Иначе все сгенерированные" >&2
  echo "        видео и ассеты будут потеряны при следующем deploy. См. README " >&2
  echo "        раздел 'Persistent storage' для инструкции по привязке диска." >&2
fi

# ─── Database migrations ───────────────────────────────────────────────────
echo "==> Applying Prisma migrations (migrate deploy)..."
bunx prisma migrate deploy

echo "==> Migration status:"
bunx prisma migrate status 2>&1 || true

# ─── Optional seed ─────────────────────────────────────────────────────────
# RUN_SEED=true запускает seed только если в БД нет ZavodUser (первый деплой).
# Файл prisma/seed.ts опционален — если его нет, шаг пропускается.
if [ "$RUN_SEED" = "true" ]; then
  echo "==> RUN_SEED=true, проверяем нужен ли seed..."
  USER_COUNT=$(bun -e '
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./app/generated/prisma/client.js";
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });
const count = await prisma.zavodUser.count();
console.log(count);
await prisma.$disconnect();
' 2>/dev/null || echo "0")

  if [ "$USER_COUNT" = "0" ]; then
    if [ -f "prisma/seed.ts" ]; then
      echo "  Empty database, running prisma/seed.ts..."
      bun prisma/seed.ts || echo "WARNING: seed failed, continuing..."
    else
      echo "  prisma/seed.ts отсутствует — seed пропущен. Создать пользователей через MarketingCamp + первый логин."
    fi
  else
    echo "  Database уже содержит $USER_COUNT пользователя(ей), seed пропущен."
  fi
fi

# ─── Start antidetect agent + Xvfb (background, headless browser) ───────────
# Запускаем ДО exec — Xvfb и agent идут в background, exec заменит этот shell
# процесс на bun (PID 1 в контейнере). Child процессы остаются параллельно;
# при SIGTERM Docker шлёт сигнал PID 1 (bun) → graceful shutdown → grace period
# → kill -9 оставшимся. Trap после exec не сработает — полагаемся на Docker layer.
#
# Провайдер выбирается ANTIDETECT_PROVIDER (default indigo). Оба агента (Indigo
# :45011 и Multilogin :45001) забандлены в образ — стартуем только выбранный.
# Readiness wait до 60с; НЕ блокируем старт приложения если agent не успел —
# Nuxt стартует, posting честно фейлит с понятной ошибкой, pipeline генерации
# видео работает независимо.
ANTIDETECT_PROVIDER="${ANTIDETECT_PROVIDER:-indigo}"
echo "==> Antidetect provider: $ANTIDETECT_PROVIDER"

AGENT_BIN=""
AGENT_PORT=""
AGENT_LABEL=""
if [ "$ANTIDETECT_PROVIDER" = "multilogin" ]; then
  AGENT_LABEL="Multilogin"
  AGENT_PORT="45001"
  if [ -x /usr/bin/mlx ]; then
    AGENT_BIN="/usr/bin/mlx"
  elif command -v mlx >/dev/null 2>&1; then
    AGENT_BIN="$(command -v mlx)"
  else
    echo "  WARN: mlx binary не найден, но ANTIDETECT_PROVIDER=multilogin. Posting не будет работать." >&2
  fi
  # launcher.mlx.yt резолвится в 127.0.0.1 (loopback-домен с валидным сертом).
  # Гарантируем резолв на случай ограниченного DNS контейнера.
  if ! grep -q "launcher.mlx.yt" /etc/hosts 2>/dev/null; then
    echo "127.0.0.1 launcher.mlx.yt" >> /etc/hosts 2>/dev/null \
      && echo "  /etc/hosts: launcher.mlx.yt → 127.0.0.1" || true
  fi
elif [ "$INDIGO_AGENT_ENABLED" = "true" ] && [ -n "$INDIGO_BIN" ]; then
  AGENT_LABEL="Indigo"
  AGENT_PORT="45011"
  AGENT_BIN="$INDIGO_BIN"
fi

if [ -n "$AGENT_BIN" ]; then
  # /dev/shm: Docker по умолчанию даёт всего 64MB shared memory → Chromium (Mimic/
  # Indigo) крашится под нагрузкой (detached frame / browser_disconnected / DOM.enable
  # timeout) ДАЖЕ при огромном RAM хоста. Ремаунтим больше (best-effort; нужен
  # CAP_SYS_ADMIN). Если не вышло — headless_mode сильно снижает потребность в shm.
  SHM_SZ=$(df -m /dev/shm 2>/dev/null | awk 'NR==2{print $2}')
  echo "==> /dev/shm: ${SHM_SZ:-?}MB"
  if [ -n "$SHM_SZ" ] && [ "$SHM_SZ" -lt 1024 ] 2>/dev/null; then
    if mount -o remount,size=2048m /dev/shm 2>/dev/null; then
      echo "  /dev/shm ремаунчен → 2048MB (стабильность Chromium)"
    else
      echo "  WARN: не смог ремаунтить /dev/shm (нет прав?) — задайте --shm-size=2g в деплое Saturn для стабильности Chromium." >&2
    fi
  fi

  if ! command -v Xvfb >/dev/null 2>&1; then
    echo "==> WARN: Xvfb не установлен — $AGENT_LABEL agent требует X display. Skip." >&2
  else
    echo "==> Starting Xvfb virtual display (:99)..."
    Xvfb :99 -screen 0 1920x1080x24 -ac +extension GLX +render -noreset \
      > /tmp/xvfb.log 2>&1 &
    export DISPLAY=:99
    # Короткая пауза чтобы X server успел открыть socket.
    sleep 2

    echo "==> Starting $AGENT_LABEL agent ($AGENT_BIN)..."
    "$AGENT_BIN" > /tmp/antidetect-agent.log 2>&1 &

    echo "==> Waiting for $AGENT_LABEL agent on :$AGENT_PORT (max 60s)..."
    AGENT_READY=false
    for i in $(seq 1 60); do
      # Launcher может слушать http или https (self-signed/valid) — пробуем оба.
      # Любой HTTP-ответ = порт поднят (curl exit 0 даже на 404).
      if curl -sk --max-time 2 "https://127.0.0.1:$AGENT_PORT/api/v1/version" >/dev/null 2>&1 \
         || curl -s --max-time 2 "http://127.0.0.1:$AGENT_PORT/api/v1/version" >/dev/null 2>&1; then
        echo "  $AGENT_LABEL agent ready (took ${i}s)"
        AGENT_READY=true
        break
      fi
      sleep 1
    done

    if [ "$AGENT_READY" != "true" ]; then
      echo "  WARN: $AGENT_LABEL agent не ответил за 60s. Posting может не работать." >&2
      echo "  ── antidetect-agent.log (tail) ──" >&2
      tail -n 20 /tmp/antidetect-agent.log >&2 || true
      echo "  ── xvfb.log (tail) ──" >&2
      tail -n 10 /tmp/xvfb.log >&2 || true
      # НЕ exit — приложение должно стартовать даже если agent сбоит.
    fi
  fi
fi

# ─── Start application ─────────────────────────────────────────────────────
echo "==> Starting Nuxt server on ${HOST:-0.0.0.0}:${PORT:-3000}..."
exec bun .output/server/index.mjs
