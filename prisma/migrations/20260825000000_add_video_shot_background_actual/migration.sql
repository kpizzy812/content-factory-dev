-- Ruling ре-ревью Task 4, сомнение Б: `background` — план (пишет edit_plan,
-- shot_background его больше не трогает), `backgroundActual` — факт (что
-- реально произвёл шаг shot_background после потолка §7 и отказов
-- исполнения). Nullable: null у кадра, для которого шаг ещё не исполнялся.
ALTER TABLE "VideoShot" ADD COLUMN "backgroundActual" TEXT;
