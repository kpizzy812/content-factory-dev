-- Фикс-раунд 1 ревью Task 1 (Important 2): docstring VideoShot.appReferenceId
-- обещал «свой каскад», а внешнего ключа не было вообще — удаление
-- AppReferenceImage оставляло бы висящую ссылку, которую БД не видит.
-- Ведёт себя как backgroundClipId: кадр уже отрендерен и уехал в готовый
-- ролик, сносить его вместе с исходником значит переписать историю.

-- CreateIndex
CREATE INDEX "VideoShot_appReferenceId_idx" ON "VideoShot"("appReferenceId");

-- AddForeignKey
ALTER TABLE "VideoShot" ADD CONSTRAINT "VideoShot_appReferenceId_fkey" FOREIGN KEY ("appReferenceId") REFERENCES "AppReferenceImage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
