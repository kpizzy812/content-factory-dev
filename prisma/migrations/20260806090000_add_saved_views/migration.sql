-- Сохранённые представления списков: фильтры, сортировка и состав колонок.
--
-- Оператор работает с сотнями объектов в день и каждый раз выставлял фильтры
-- заново. Общие представления дополнительно кодируют процесс команды: новый
-- человек открывает раздел и сразу видит очередь «Ждут ревью» с нужными
-- колонками, а не пустую таблицу со всеми записями подряд.
--
-- scope: 'shared' — общие, правит роль с соответствующим правом;
--        'personal' — личные, создаются без трения и без последствий.
-- Системные представления («Все», «Новые за 24 часа») заводятся кодом и здесь
-- не хранятся: их нельзя ни удалить, ни переименовать.
CREATE TABLE "SavedView" (
  "id"        SERIAL       NOT NULL,
  "section"   TEXT         NOT NULL,
  "name"      TEXT         NOT NULL,
  "scope"     TEXT         NOT NULL DEFAULT 'personal',
  "query"     JSONB        NOT NULL,
  "columns"   JSONB,
  "ownerId"   INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SavedView_pkey" PRIMARY KEY ("id")
);

-- Список представлений раздела запрашивается на каждом открытии списка.
CREATE INDEX "SavedView_section_scope_idx" ON "SavedView" ("section", "scope");

-- Личные представления пользователя в конкретном разделе.
CREATE INDEX "SavedView_ownerId_section_idx" ON "SavedView" ("ownerId", "section");

-- Удаление пользователя уносит его личные представления. Общие остаются
-- у команды, поэтому у них ownerId обнуляется отдельным шагом на уровне
-- приложения, а не каскадом.
ALTER TABLE "SavedView"
  ADD CONSTRAINT "SavedView_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "ZavodUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
