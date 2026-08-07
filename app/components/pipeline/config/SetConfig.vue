<script setup lang="ts">
const props = defineProps<{
  config: Record<string, any>
}>()

const emit = defineEmits<{
  update: [key: string, value: any]
}>()

interface FieldPair {
  name: string
  value: string
}

const fields = computed<FieldPair[]>(() => props.config.fields || [])

// Фигурные скобки шаблона держим константой: в разметке Vue они читаются
// как интерполяция, и строка ломает компиляцию при переносе в текстовый узел.
const templateHint = 'Пары «имя поля → значение». Можно использовать шаблоны {{ }} для динамических значений из потока данных.'

function updateField(index: number, key: 'name' | 'value', val: string) {
  const updated = [...fields.value]
  updated[index] = { name: updated[index]!.name, value: updated[index]!.value, [key]: val }
  emit('update', 'fields', updated)
}

function addField() {
  emit('update', 'fields', [...fields.value, { name: '', value: '' }])
}

function removeField(index: number) {
  const updated = fields.value.filter((_, i) => i !== index)
  emit('update', 'fields', updated)
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <div
      v-for="(field, idx) in fields"
      :key="idx"
      class="flex items-end gap-2"
    >
      <UiField label="Имя поля" class="flex-1">
        <UiInput
          :model-value="field.name"
          placeholder="fieldName"
          @update:model-value="(v) => updateField(idx, 'name', v)"
        />
      </UiField>

      <UiField label="Значение" class="flex-1">
        <UiInput
          :model-value="field.value"
          placeholder="value"
          @update:model-value="(v) => updateField(idx, 'value', v)"
        />
      </UiField>

      <UiButton variant="ghost" icon-only title="Убрать поле" @click="removeField(idx)">
        <Icon name="mingcute:close-line" class="text-danger" />
      </UiButton>
    </div>

    <SharedFieldHint :text="templateHint" example="status → processed" />

    <UiButton class="w-full justify-center" @click="addField">
      <Icon name="mingcute:add-line" />
      Добавить поле
    </UiButton>
  </div>
</template>
