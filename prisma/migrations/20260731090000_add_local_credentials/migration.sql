-- Локальные учётные данные ContentFactory. Поле nullable: учётки, пришедшие из
-- MarketingCamp, пароля не имеют и логинятся своим провайдером.
ALTER TABLE "ZavodUser" ADD COLUMN "passwordHash" TEXT;
