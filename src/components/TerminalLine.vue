<script setup lang="ts">
import { terminalLineClass, type TerminalKind } from '@/lib/terminal'

withDefaults(defineProps<{ kind?: TerminalKind; text: string }>(), {
  kind: 'output',
})
</script>

<template>
  <div
    class="min-h-[1.5em] whitespace-pre-wrap [overflow-wrap:anywhere]"
    :class="terminalLineClass[kind]"
  >
    {{ text }}
  </div>
</template>
