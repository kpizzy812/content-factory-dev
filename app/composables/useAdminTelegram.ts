/**
 * Composables для Telegram-раздела админки.
 */

/** Статус интеграции */
export function useAdminTelegramStatus() {
  return useFetch('/api/admin/telegram/status', {
    key: 'admin-telegram-status',
  })
}

/** Список чатов */
export function useAdminTelegramChats() {
  return useFetch('/api/admin/telegram/chats', {
    key: 'admin-telegram-chats',
  })
}

/** Список шаблонов */
export function useAdminTelegramTemplates() {
  return useFetch('/api/admin/telegram/templates', {
    key: 'admin-telegram-templates',
  })
}

/** История доставок */
export function useAdminTelegramDeliveries(params?: Ref<{ page?: number; status?: string; eventType?: string }>) {
  return useFetch('/api/admin/telegram/deliveries', {
    key: 'admin-telegram-deliveries',
    query: params,
  })
}

/** Аудит команд */
export function useAdminTelegramAudit(params?: Ref<{ page?: number; command?: string; resultStatus?: string }>) {
  return useFetch('/api/admin/telegram/audit', {
    key: 'admin-telegram-audit',
    query: params,
  })
}

/** Canonical variable registry */
export function useAdminTelegramVariables(scopes?: string) {
  return useFetch('/api/admin/telegram/variables', {
    key: `admin-telegram-variables-${scopes || 'all'}`,
    query: scopes ? { scopes } : undefined,
  })
}

/** Список API-ключей */
export function useAdminTelegramKeys() {
  return useFetch('/api/admin/telegram/keys', {
    key: 'admin-telegram-keys',
  })
}

/** Тестовые действия */
export function useAdminTelegramActions() {
  async function testApi() {
    const res = await $fetch<{ data: Record<string, unknown> }>('/api/admin/telegram/test', {
      method: 'POST',
      body: { action: 'test_api' },
    })
    return res.data
  }

  async function testSend(message: string) {
    const res = await $fetch<{ data: Record<string, unknown> }>('/api/admin/telegram/test', {
      method: 'POST',
      body: { action: 'test_send', message },
    })
    return res.data
  }

  async function testChat(chatId: string, message?: string) {
    const res = await $fetch<{ data: Record<string, unknown> }>('/api/admin/telegram/test', {
      method: 'POST',
      body: { action: 'test_chat', chatId, message },
    })
    return res.data
  }

  async function updateChat(id: number, data: {
    alertsEnabled?: boolean
    isAuthorized?: boolean
    routingTags?: string[]
  }) {
    return $fetch(`/api/admin/telegram/chats/${id}`, {
      method: 'PUT',
      body: data,
    })
  }

  async function deleteChat(id: number) {
    return $fetch(`/api/admin/telegram/chats/${id}`, {
      method: 'DELETE',
    })
  }

  async function createTemplate(data: {
    key: string
    title: string
    category?: string
    messageBody: string
    variablesSchema?: Record<string, string>
  }) {
    return $fetch('/api/admin/telegram/templates', {
      method: 'POST',
      body: data,
    })
  }

  async function updateTemplate(id: number, data: {
    title?: string
    category?: string
    messageBody?: string
    variablesSchema?: Record<string, string> | null
    isActive?: boolean
  }) {
    return $fetch(`/api/admin/telegram/templates/${id}`, {
      method: 'PUT',
      body: data,
    })
  }

  async function deleteTemplate(id: number) {
    return $fetch(`/api/admin/telegram/templates/${id}`, {
      method: 'DELETE',
    })
  }

  async function testTemplate(id: number, variables?: Record<string, string>) {
    const res = await $fetch<{ data: Record<string, unknown> }>(`/api/admin/telegram/templates/${id}/test`, {
      method: 'POST',
      body: { variables },
    })
    return res.data
  }

  async function resendDelivery(id: number) {
    const res = await $fetch<{ data: Record<string, unknown> }>(`/api/admin/telegram/deliveries/${id}/resend`, {
      method: 'POST',
    })
    return res.data
  }

  async function restartBot() {
    const res = await $fetch<{ data: Record<string, unknown> }>('/api/admin/telegram/restart', {
      method: 'POST',
    })
    return res.data
  }

  async function generateTemplate(prompt: string) {
    const res = await $fetch<{ data: Record<string, unknown> }>('/api/admin/telegram/templates/generate', {
      method: 'POST',
      body: { prompt },
    })
    return res.data
  }

  async function listKeys() {
    const res = await $fetch<{ data: unknown[] }>('/api/admin/telegram/keys')
    return res.data
  }

  async function createKey(label: string, expiresAt?: string) {
    const res = await $fetch<{ data: Record<string, unknown> }>('/api/admin/telegram/keys', {
      method: 'POST',
      body: { label, expiresAt },
    })
    return res.data
  }

  async function updateKey(id: number, data: { label?: string; isActive?: boolean }) {
    return $fetch(`/api/admin/telegram/keys/${id}`, {
      method: 'PUT',
      body: data,
    })
  }

  async function deleteKey(id: number) {
    return $fetch(`/api/admin/telegram/keys/${id}`, {
      method: 'DELETE',
    })
  }

  async function rotateKey(id: number) {
    const res = await $fetch<{ data: Record<string, unknown> }>(`/api/admin/telegram/keys/${id}/rotate`, {
      method: 'POST',
    })
    return res.data
  }

  return {
    restartBot,
    testApi,
    testSend,
    testChat,
    updateChat,
    deleteChat,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    testTemplate,
    resendDelivery,
    generateTemplate,
    listKeys,
    createKey,
    updateKey,
    deleteKey,
    rotateKey,
  }
}
