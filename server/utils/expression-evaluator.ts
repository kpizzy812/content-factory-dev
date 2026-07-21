/**
 * Простой шаблонизатор для подстановки данных из контекста в строки.
 * Поддерживает синтаксис {{ path.to.value }}.
 */

function getByPath(obj: any, path: string): any {
  return path.split('.').reduce((o, k) => o?.[k], obj)
}

/**
 * Заменяет все вхождения {{ path }} в шаблоне на значения из контекста.
 * Если значение не найдено — вставляет пустую строку.
 */
export function evaluateExpression(
  template: string,
  context: Record<string, any>,
): string {
  return template.replace(/\{\{(.+?)\}\}/g, (_, path) => {
    const value = getByPath(context, path.trim())
    return value !== undefined ? String(value) : ''
  })
}

/**
 * Проверяет содержит ли строка expression-шаблоны.
 */
export function hasExpressions(value: string): boolean {
  return /\{\{.+?\}\}/.test(value)
}

/**
 * Применяет expression-подстановку ко всем строковым полям конфига.
 * Возвращает новый объект с подставленными значениями.
 */
export function resolveConfigExpressions(
  config: Record<string, unknown>,
  context: Record<string, any>,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(config)) {
    if (typeof value === 'string' && hasExpressions(value)) {
      resolved[key] = evaluateExpression(value, context)
    } else {
      resolved[key] = value
    }
  }

  return resolved
}
