<script setup lang="ts">
const props = withDefaults(defineProps<{
  rows?: number
  cols?: number
}>(), {
  rows: 6,
  cols: 5,
})
</script>

<template>
  <div class="overflow-x-auto">
    <table class="table table-sm">
      <tbody>
        <tr v-for="i in props.rows" :key="i">
          <td v-for="j in props.cols" :key="j">
            <div class="skeleton h-4" :class="j === 1 ? 'w-32' : 'w-20'" />
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
