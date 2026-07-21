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
  <div class="space-y-2">
    <div
      v-for="(field, idx) in fields"
      :key="idx"
      class="flex items-start gap-2"
    >
      <fieldset class="fieldset flex-1">
        <legend class="fieldset-legend">Имя поля</legend>
        <input
          :value="field.name"
          class="input input-sm w-full"
          placeholder="fieldName"
          @input="updateField(idx, 'name', ($event.target as HTMLInputElement).value)"
        />
      </fieldset>

      <fieldset class="fieldset flex-1">
        <legend class="fieldset-legend">Значение</legend>
        <input
          :value="field.value"
          class="input input-sm w-full"
          placeholder="value"
          @input="updateField(idx, 'value', ($event.target as HTMLInputElement).value)"
        />
      </fieldset>

      <button
        class="btn btn-ghost btn-xs btn-square mt-8"
        @click="removeField(idx)"
      >
        <Icon name="mingcute:close-line" class="text-error" />
      </button>
    </div>

    <SharedFieldHint text="Пары «имя поля → значение». Можно использовать шаблоны {{ }} для динамических значений из потока данных." example="status → processed" />

    <button class="btn btn-outline btn-sm btn-block" @click="addField">
      <Icon name="mingcute:add-line" />
      Добавить поле
    </button>
  </div>
</template>
