// https://nuxt.com/docs/api/configuration/nuxt-config

import tailwindcss from "@tailwindcss/vite";

export default defineNuxtConfig({
  compatibilityDate: "2025-07-15",
  devtools: { enabled: true },
  css: ["./app/assets/css/main.css"],

  components: [
    // Компоненты google-drive названы DriveX — отключаем path-префикс,
    // чтобы Nuxt не превращал их в GoogleDriveDriveX.
    { path: "~/components/google-drive", pathPrefix: false },
    "~/components",
  ],

  app: {
    head: {
      titleTemplate: "%s — Контент-Завод",
      title: "Контент-Завод",
    },
  },

  // runtimeConfig сжат до минимума: только session-блок для nuxt-auth-utils.
  // Все остальные настройки читаются server-кодом напрямую через process.env.X,
  // чтобы секреты НЕ запекались в server-bundle при билде. Полный маппинг
  // env-переменных см. в .env.example.
  runtimeConfig: {
    public: {},
    session: {
      name: "zavod-session",
      // password подхватывается nuxt-auth-utils из NUXT_SESSION_PASSWORD автоматически.
      password: "",
      maxAge: 60 * 60 * 24 * 7, // 7 дней
      cookie: {
        // В production cookie должна быть Secure (HTTPS only). В dev/test
        // сервер ходит по HTTP (127.0.0.1:3100 в Playwright) — браузер не шлёт
        // secure cookies по HTTP, что ломает E2E авторизацию.
        secure: process.env.NODE_ENV === "production",
      },
    },
  },

  vite: {
    plugins: [tailwindcss()],
    server: {
      allowedHosts: true,
    },
  },

  modules: [
    "nuxt-auth-utils",
    "@pinia/nuxt",
    "@nuxt/icon",
    "@vueuse/motion",
    "@nuxtjs/color-mode",
  ],

  icon: {
    mode: "svg",
  },

  colorMode: {
    preference: "bumblebee",
    fallback: "bumblebee",
    dataValue: "theme",
    classSuffix: "",
    storageKey: "nuxt-color-mode",
    storage: "cookie",
  },

  nitro: {
    // otpauth используется только в client-side useTotp (lazy dynamic import).
    // inline-list страхует от deployment, не сохраняющего node_modules рядом с .output.
    externals: {
      inline: ["otpauth"],
    },
  },
});
