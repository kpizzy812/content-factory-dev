-- Шаг производства медиа фона НА КАДР (spec §7, исполнительная половина).
-- Значение дописано в конец: enum-позиции персистентны, вставка в середину
-- переписала бы историю уже записанных VideoGenerationStep.
ALTER TYPE "VideoStepKey" ADD VALUE 'shot_background';

-- Тип ассета для готового файла фона кадра. Под videoSceneImage его класть
-- нельзя: там адресация по order СЦЕНЫ, а у кадра свой order.
ALTER TYPE "AssetType" ADD VALUE 'shot_background';
