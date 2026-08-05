<script setup lang="ts">
/**
 * Витрина дизайн-системы. Временная страница для сверки с
 * design-preview/catalog/00-system.dc.html. Удаляется в этапе 7 перед мержем.
 */
import { ENTITY_STATUSES } from '~~/shared/utils/entity-status'

// Витрина не ходит в API и не показывает данных. Доступ без логина открыт
// только в dev — см. исключение в app/middleware/auth.global.ts.
definePageMeta({ layout: false })
useHead({ title: 'Дизайн-система' })

const colorMode = useColorMode()
const toast = useToast()

const text = ref('Тренд → сценарий → видео → Reels')
const num = ref('80')
const area = ref('Оператор просматривает пачками.')
const platform = ref('tiktok')
const checked = ref(true)
const toggled = ref(true)
const modalOpen = ref(false)
const drawerOpen = ref(false)
const sort = ref('-viewCount')

const COLUMNS = '32px 40px minmax(220px,1fr) 108px 96px 116px 128px 76px'

const rows = [
  { id: 1, title: 'Как за 30 секунд собрать шкаф без инструкции', author: '@mebel_pro', platform: 'tiktok', views: 2431902, virality: 84, status: 'review' as const, date: '5 авг, 14:32' },
  { id: 2, title: 'Три ошибки при замере кухни', author: '@kuhni.optom', platform: 'instagram', views: 812440, virality: 61, status: 'running' as const, date: '5 авг, 12:10' },
  { id: 3, title: 'Почему доставка едет две недели', author: '@sborka.msk', platform: 'youtube', views: 96310, virality: 28, status: 'failed' as const, date: '4 авг, 19:48' },
  { id: 4, title: 'Разбор: диван за 40 тысяч против за 120', author: '@mebel_pro', platform: 'tiktok', views: 1204880, virality: 77, status: 'done' as const, date: '4 авг, 09:05' },
]
const selected = ref<number[]>([1])

const menuItems = [
  { key: 'open', label: 'Открыть', icon: 'mingcute:external-link-line', group: 'Действия' },
  { key: 'assembly', label: 'Пересобрать сцены', icon: 'mingcute:refresh-2-line', group: 'Действия' },
  { key: 'lipsync', label: 'Повторить lip-sync', icon: 'mingcute:mic-line', cost: '24 ₽', group: 'Оплачиваемое' },
  { key: 'render', label: 'Перерендерить', icon: 'mingcute:video-line', cost: '41 ₽', group: 'Оплачиваемое' },
  { key: 'delete', label: 'Удалить', icon: 'mingcute:delete-2-line', danger: true, group: 'Оплачиваемое' },
]

function fmt(n: number) {
  return n.toLocaleString('ru-RU')
}

// --- Компоненты списка (этап 3) ---
// Активно общее представление и вид изменён — показываем плашку «оригинал не тронут».
const demoActiveView = ref<string | number>(1)
const demoDirty = ref(true)
const demoPage = ref(3)
const demoColumnDefs = [
  { key: 'title', label: 'Название', locked: true },
  { key: 'platform', label: 'Платформа' },
  { key: 'views', label: 'Просмотры' },
  { key: 'virality', label: 'Виральность' },
  { key: 'status', label: 'Статус' },
  { key: 'imported', label: 'Импортирован' },
]
const demoColumns = ref(demoColumnDefs.map(c => c.key))
const demoViews = [
  { id: 'system:all', section: 'trends', name: 'Все', scope: 'system' as const, query: {}, columns: null, ownerId: null, ownerName: null, updatedAt: null },
  { id: 'system:fresh', section: 'trends', name: 'Новые за 24 часа', scope: 'system' as const, query: {}, columns: null, ownerId: null, ownerName: null, updatedAt: null },
  { id: 1, section: 'trends', name: 'Ждут ревью', scope: 'shared' as const, query: {}, columns: null, ownerId: 2, ownerName: 'Дмитрий Кузнецов', updatedAt: '2026-08-04T10:00:00Z' },
  { id: 2, section: 'trends', name: 'Мебель, RU', scope: 'personal' as const, query: {}, columns: null, ownerId: 1, ownerName: null, updatedAt: '2026-08-05T10:00:00Z' },
]
</script>

<template>
  <div class="min-h-screen bg-surface text-fg">
    <header class="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-panel px-5 py-3">
      <h1 class="text-lg font-semibold">Дизайн-система ContentFactory</h1>
      <span class="text-sm text-subtle">витрина этапа 1 · удаляется перед мержем</span>
      <div class="ml-auto flex gap-1.5">
        <UiButton :variant="colorMode.preference === 'dark' ? 'primary' : 'secondary'" @click="colorMode.preference = 'dark'">Тёмная</UiButton>
        <UiButton :variant="colorMode.preference === 'light' ? 'primary' : 'secondary'" @click="colorMode.preference = 'light'">Светлая</UiButton>
      </div>
    </header>

    <main class="mx-auto flex max-w-6xl flex-col gap-8 px-5 py-6">
      <!-- Кнопки -->
      <section class="flex flex-col gap-3">
        <h2 class="text-micro tracking-[.07em] text-subtle uppercase">Кнопки</h2>
        <div class="flex flex-wrap items-center gap-3 rounded-md border border-border bg-panel px-3.5 py-2.5">
          <span class="w-[132px] shrink-0 text-micro tracking-[.06em] text-subtle uppercase">Основная · md</span>
          <UiButton variant="primary" size="md">Импортировать тренды</UiButton>
          <UiButton variant="primary" size="md" loading>Загрузка</UiButton>
          <UiButton variant="primary" size="md" disabled>Отключена</UiButton>
        </div>
        <div class="flex flex-wrap items-center gap-3 rounded-md border border-border bg-panel px-3.5 py-2.5">
          <span class="w-[132px] shrink-0 text-micro tracking-[.06em] text-subtle uppercase">Вторичная · sm</span>
          <UiButton>Взять в работу</UiButton>
          <UiButton variant="ghost">Призрачная</UiButton>
          <UiButton variant="danger">Удалить</UiButton>
          <UiButton disabled>Отключена</UiButton>
        </div>
        <div class="flex flex-wrap items-center gap-3 rounded-md border border-border bg-panel px-3.5 py-2.5">
          <span class="w-[132px] shrink-0 text-micro tracking-[.06em] text-subtle uppercase">Только иконка</span>
          <UiButton icon-only><Icon name="mingcute:refresh-2-line" /></UiButton>
          <UiButton icon-only variant="ghost"><Icon name="mingcute:more-2-line" /></UiButton>
          <UiButton icon-only variant="danger"><Icon name="mingcute:delete-2-line" /></UiButton>
        </div>
      </section>

      <!-- Поля -->
      <section class="flex flex-col gap-3">
        <h2 class="text-micro tracking-[.07em] text-subtle uppercase">Поля формы</h2>
        <div class="grid gap-4 rounded-md border border-border bg-panel p-3.5 sm:grid-cols-2 lg:grid-cols-3">
          <UiField label="Название" hint="Показывается в списке конвейеров">
            <UiInput v-model="text" />
          </UiField>
          <UiField label="Порог виральности" error="Значение должно быть от 0 до 100">
            <UiInput v-model="num" mono invalid />
          </UiField>
          <UiField label="Платформа">
            <UiSelect
              v-model="platform"
              :options="[
                { value: 'tiktok', label: 'TikTok' },
                { value: 'instagram', label: 'Instagram' },
                { value: 'youtube', label: 'YouTube' },
              ]"
            />
          </UiField>
          <UiField label="ID запуска">
            <UiInput model-value="run_88213" mono readonly />
          </UiField>
          <UiField label="Нет прав на изменение">
            <UiInput model-value="Значение недоступно" disabled />
          </UiField>
          <UiField label="Заметка">
            <UiTextarea v-model="area" />
          </UiField>
          <div class="flex flex-col justify-center gap-3">
            <UiCheckbox v-model="checked" label="Учитывать прогрев аккаунта" />
            <UiCheckbox :model-value="false" label="Отключено" disabled />
            <UiToggle v-model="toggled" label="Автозапуск по расписанию" />
          </div>
        </div>
      </section>

      <!-- Статусы -->
      <section class="flex flex-col gap-3">
        <h2 class="text-micro tracking-[.07em] text-subtle uppercase">Статусы — единая семантика</h2>
        <div class="flex flex-col gap-2.5 rounded-md border border-border bg-panel p-3.5">
          <div v-for="s in ENTITY_STATUSES" :key="s" class="flex items-center gap-4">
            <span class="w-[120px] shrink-0 font-mono text-micro text-subtle">{{ s }}</span>
            <UiStatusBadge :status="s" size="xs" />
            <UiStatusBadge :status="s" size="sm" dot />
            <UiStatusBadge :status="s" size="md" />
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-3 rounded-md border border-border bg-panel p-3.5">
          <UiPlatformBadge platform="instagram" />
          <UiPlatformBadge platform="tiktok" />
          <UiPlatformBadge platform="youtube" />
          <UiStepProgressBadge :current="3" :total="7" />
          <UiStepProgressBadge :current="9" :total="9" tone="success" />
          <UiStepProgressBadge :current="4" :total="9" tone="danger" />
        </div>
      </section>

      <!-- Метрики и прогресс -->
      <section class="grid gap-3 lg:grid-cols-2">
        <div class="rounded-lg border border-border bg-panel p-4">
          <UiMetricStat
            label="Готово роликов за сутки"
            :value="43"
            :target="60"
            :delta="18"
            delta-caption="к прошлым суткам"
            :spark="[38, 52, 44, 66, 58, 78, 100]"
          />
        </div>
        <div class="flex flex-col gap-4 rounded-lg border border-border bg-panel p-4">
          <UiStepProgress
            label="Запуск run_88213"
            caption="шаг 4 из 9"
            :steps="['done', 'done', 'done', 'running', 'pending', 'pending', 'pending', 'pending', 'pending']"
          />
          <UiStepProgress
            label="Запуск run_88198"
            caption="упал на шаге 5"
            :steps="['done', 'done', 'done', 'done', 'failed', 'pending', 'pending']"
          />
        </div>
      </section>

      <!-- Таблица -->
      <section class="flex flex-col gap-3">
        <h2 class="text-micro tracking-[.07em] text-subtle uppercase">Таблица · плотность 36 px, миниатюра 28×28</h2>
        <UiTable :columns="COLUMNS" min-width="880px">
          <UiTableHead>
            <span><input type="checkbox" class="size-3.5 cursor-pointer accent-(--color-accent)"></span>
            <span />
            <UiTableHeadCell sort-key="title" :sort="sort" @sort="sort = $event">Название</UiTableHeadCell>
            <UiTableHeadCell sort-key="platform" :sort="sort" @sort="sort = $event">Платформа</UiTableHeadCell>
            <UiTableHeadCell sort-key="viewCount" :sort="sort" align="right" @sort="sort = $event">Просмотры</UiTableHeadCell>
            <UiTableHeadCell sort-key="virality" :sort="sort" align="right" @sort="sort = $event">Виральность</UiTableHeadCell>
            <UiTableHeadCell sort-key="status" :sort="sort" @sort="sort = $event">Статус</UiTableHeadCell>
            <UiTableHeadCell align="right">Действия</UiTableHeadCell>
          </UiTableHead>

          <UiTableRow v-for="r in rows" :key="r.id" :selected="selected.includes(r.id)">
            <span @click.stop>
              <input
                type="checkbox"
                :checked="selected.includes(r.id)"
                class="size-3.5 cursor-pointer accent-(--color-accent)"
                @change="selected.includes(r.id) ? selected.splice(selected.indexOf(r.id), 1) : selected.push(r.id)"
              >
            </span>
            <span>
              <span class="block size-7 rounded-sm bg-neutral-bg" />
            </span>
            <span class="flex min-w-0 items-baseline gap-2">
              <span class="truncate text-sm">{{ r.title }}</span>
              <span class="shrink-0 font-mono text-[11.5px] text-subtle">{{ r.author }}</span>
            </span>
            <span><UiPlatformBadge :platform="r.platform" /></span>
            <span class="tnum text-right font-mono text-sm">{{ fmt(r.views) }}</span>
            <span class="flex items-center justify-end gap-[7px]">
              <span class="h-[5px] w-11 overflow-hidden rounded-full bg-neutral-bg">
                <span class="block h-full bg-accent" :style="{ width: `${r.virality}%` }" />
              </span>
              <span class="tnum w-6 text-right font-mono text-sm">{{ r.virality }}</span>
            </span>
            <span><UiStatusBadge :status="r.status" size="xs" dot /></span>
            <span class="flex justify-end opacity-0 transition-opacity group-hover:opacity-100" @click.stop>
              <UiActionMenu :items="menuItems" />
            </span>
          </UiTableRow>
        </UiTable>

        <UiBulkActionBar :selected="selected.length" :total="240" page-selected @clear="selected = []">
          <UiButton>Взять в работу</UiButton>
          <UiButton>Отправить в конвейер</UiButton>
          <UiButton variant="danger">Удалить</UiButton>
        </UiBulkActionBar>
      </section>

      <!-- Состояния -->
      <section class="flex flex-col gap-3">
        <h2 class="text-micro tracking-[.07em] text-subtle uppercase">Состояния</h2>
        <UiSkeleton variant="table" :count="4" />
        <div class="grid gap-3 lg:grid-cols-3">
          <UiEmptyState
            variant="first"
            title="Трендов пока нет"
            description="Создайте профиль парсинга — тренды начнут приезжать автоматически."
          >
            <UiButton variant="primary">Создать профиль</UiButton>
          </UiEmptyState>
          <UiEmptyState
            variant="search"
            title="Ничего не найдено"
            description="Мешает виральность 90—100: таких в базе 4."
          >
            <UiButton>Снять этот фильтр</UiButton>
          </UiEmptyState>
          <UiNoAccess section="Балансы" />
        </div>
        <UiErrorState
          message="Сервис трендов не ответил за 30 секунд. Данные могли не обновиться."
          details="TimeoutError: upstream apify.trends did not respond within 30000ms"
        />
      </section>

      <!-- Ключ-значение, логи, обновление -->
      <section class="grid gap-3 lg:grid-cols-2">
        <div class="rounded-lg border border-border bg-panel p-4">
          <UiKeyValue
            :items="[
              { label: 'ID', value: 'vid_10842' },
              { label: 'Длительность', value: '82 сек · 1080×1920' },
              { label: 'Стоимость', value: '41,20 ₽' },
              { label: 'Из тренда', value: 'Как за 30 секунд собрать шкаф', to: '#', mono: false },
            ]"
          />
        </div>
        <div class="flex flex-col gap-1 rounded-lg border border-border bg-panel p-4">
          <UiLogRow time="14:32:07" level="info" message="шаг 4/9 lip-sync: отправлено в Replicate, model=wav2lip" />
          <UiLogRow time="14:32:41" level="warn" message="повторная попытка 1 из 3, таймаут провайдера" />
          <UiLogRow
            time="14:33:12"
            level="error"
            message="шаг 4/9 lip-sync: речь короче видеодорожки на 6,4 с"
            details="AudioLengthMismatch: speech=75.6s video=82.0s"
          />
          <div class="mt-2 flex items-center gap-3">
            <UiRefreshIndicator pending updated-at="14:33:20" />
            <UiRefreshIndicator updated-at="14:33:15" />
            <UiTooltip text="Данные обновляются раз в 5 секунд">
              <span class="cursor-help text-sm text-muted underline decoration-dotted">что это</span>
            </UiTooltip>
          </div>
        </div>
      </section>

      <!-- Карточки -->
      <section class="flex flex-col gap-3">
        <h2 class="text-micro tracking-[.07em] text-subtle uppercase">Режим карточек</h2>
        <div class="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <UiEntityCard
            v-for="r in rows"
            :key="r.id"
            selectable
            :title="r.title"
            :subtitle="r.author"
            :selected="selected.includes(r.id)"
            @update:selected="selected.includes(r.id) ? selected.splice(selected.indexOf(r.id), 1) : selected.push(r.id)"
          >
            <template #badges>
              <UiStatusBadge :status="r.status" size="xs" dot />
            </template>
            <template #meta>
              <span class="tnum font-mono text-micro text-muted">{{ fmt(r.views) }} просмотров</span>
            </template>
            <template #actions>
              <UiButton variant="primary">Открыть</UiButton>
            </template>
          </UiEntityCard>
        </div>
      </section>

      <!-- Компоненты списка (этап 3) -->
      <section class="flex flex-col gap-3">
        <h2 class="text-micro tracking-[.07em] text-subtle uppercase">Список: представления, фильтры, колонки, пагинация</h2>

        <ListSavedViews
          :views="demoViews"
          :active-id="demoActiveView"
          :dirty="demoDirty"
          can-manage-shared
          :counts="{ 'system:all': 240, 'system:fresh': 18, '1': 12 }"
          @select="demoActiveView = $event; demoDirty = false"
          @revert="demoDirty = false"
          @save-as-own="demoDirty = false"
        />

        <ListFilterChips
          :chips="[
            { key: 'platform', label: 'Платформа', value: 'TikTok' },
            { key: 'virality', label: 'Виральность', value: '90—100' },
          ]"
        />

        <div class="flex items-center justify-end rounded-md border border-border bg-panel px-3 py-2">
          <ListColumnsMenu v-model:visible="demoColumns" :columns="demoColumnDefs" />
        </div>

        <ListPagination
          :page="demoPage"
          :total-pages="10"
          :total="240"
          :per-page="25"
          @update:page="demoPage = $event"
        />
      </section>

      <!-- Оверлеи -->
      <section class="flex flex-wrap gap-2">
        <UiButton variant="primary" @click="modalOpen = true">Открыть модалку</UiButton>
        <UiButton @click="drawerOpen = true">Открыть панель деталей</UiButton>
        <UiButton @click="toast.undoable('4 тренда взяты в работу', () => toast.info('Действие отменено'))">
          Тост с отменой
        </UiButton>
        <UiButton variant="danger" @click="toast.error('Не удалось отправить в конвейер')">Тост с ошибкой</UiButton>
      </section>
    </main>

    <UiModal :open="modalOpen" title="Удалить 12 трендов?" size="sm" @close="modalOpen = false">
      <p class="text-sm text-muted">
        Тренды исчезнут из всех списков. Связанные сценарии и ролики останутся, но потеряют ссылку на источник.
      </p>
      <template #footer>
        <UiButton @click="modalOpen = false">Отмена</UiButton>
        <UiButton variant="danger" @click="modalOpen = false">Удалить</UiButton>
      </template>
    </UiModal>

    <UiDrawer
      :open="drawerOpen"
      title="Как за 30 секунд собрать шкаф без инструкции"
      subtitle="trend_44190"
      position="12 из 240"
      has-prev
      has-next
      @close="drawerOpen = false"
    >
      <UiKeyValue
        :items="[
          { label: 'Платформа', value: 'TikTok', mono: false },
          { label: 'Автор', value: '@mebel_pro' },
          { label: 'Просмотры', value: '2 431 902' },
          { label: 'Виральность', value: '84' },
          { label: 'Импортирован', value: '5 авг, 14:32' },
        ]"
      />
      <template #footer>
        <UiButton variant="primary">Взять в работу</UiButton>
        <UiButton>Отправить в конвейер</UiButton>
      </template>
    </UiDrawer>

    <UiToastContainer />
  </div>
</template>
