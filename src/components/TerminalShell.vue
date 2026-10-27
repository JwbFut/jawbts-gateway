<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

import { useAuthStore } from '@/stores/auth'

const props = withDefaults(
  defineProps<{
    prompt?: string
    placeholder?: string
    disabled?: boolean
    left?: string
    right?: string
    label?: string
  }>(),
  {
    prompt: '$',
    placeholder: '',
    disabled: false,
    left: '',
    right: '',
    label: 'Terminal command',
  },
)

const auth = useAuthStore()
const identity = computed(() =>
  auth.username ? `${auth.username}@jawbts` : 'guest@jawbts',
)

const emit = defineEmits<{ submit: [value: string] }>()

const inputEl = ref<HTMLInputElement | null>(null)
const scrollEl = ref<HTMLElement | null>(null)
const value = ref('')

function submit(): void {
  const text = value.value.trim()
  if (!text || props.disabled) {
    return
  }
  value.value = ''
  emit('submit', text)
  nextTick(() => inputEl.value?.focus())
}

function focus(): void {
  inputEl.value?.focus()
}

function focusUnlessSelecting(): void {
  const selection = window.getSelection()
  if (selection && !selection.isCollapsed) {
    return
  }
  focus()
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  )
}

/**
 * The terminal should accept typing even after focus was lost to a click on
 * the transcript. If the target is not an editable field, focus the command
 * input and replay the key that started the sequence.
 */
function onGlobalKeydown(event: KeyboardEvent): void {
  if (event.defaultPrevented || event.isComposing || props.disabled) {
    return
  }
  if (event.metaKey || event.ctrlKey || event.altKey) {
    return
  }
  if (isEditableTarget(event.target)) {
    return
  }
  if (event.key === 'Enter') {
    event.preventDefault()
    focus()
    submit()
    return
  }
  if (event.key === 'Backspace') {
    event.preventDefault()
    focus()
    value.value = value.value.slice(0, -1)
    return
  }
  if (event.key.length !== 1) {
    return
  }
  event.preventDefault()
  focus()
  value.value += event.key
}

function scrollToBottom(): void {
  void nextTick(() => {
    if (scrollEl.value) {
      scrollEl.value.scrollTop = scrollEl.value.scrollHeight
    }
  })
}

defineExpose({ focus, scrollToBottom })

onMounted(() => {
  window.addEventListener('keydown', onGlobalKeydown)
  focus()
  scrollToBottom()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKeydown)
})
</script>

<template>
  <div
    class="flex h-[100dvh] flex-col overflow-hidden bg-[#0a0f0c] font-mono text-[#c9d6cf]"
    @click="focusUnlessSelecting"
  >
    <header
      class="flex shrink-0 items-center justify-between gap-3 border-b border-[#1b2620] px-4 py-2 text-[11px] uppercase tracking-[0.18em] text-[#61756a]"
    >
      <span class="normal-case">{{ left || identity }}</span>
      <span class="truncate text-right">{{ right || 'tty0' }}</span>
    </header>

    <main
      ref="scrollEl"
      class="terminal-scroll min-h-0 flex-1 overflow-y-auto px-4 py-4 text-[13px] leading-6 sm:text-sm"
      role="log"
      aria-live="polite"
      aria-label="Terminal output"
    >
      <slot />
    </main>

    <form
      class="flex shrink-0 items-center gap-2 border-t border-[#1b2620] px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3"
      @submit.prevent="submit"
    >
      <span class="shrink-0 text-[#7ee787]">{{ prompt }}</span>
      <input
        ref="inputEl"
        v-model="value"
        type="text"
        class="min-w-0 flex-1 bg-transparent font-mono text-base text-[#d7e3dc] caret-[#7ee787] placeholder:text-[#4c5e54] focus:outline-none sm:text-sm"
        :placeholder="placeholder"
        :disabled="disabled"
        :aria-label="label"
        autocomplete="off"
        autocapitalize="none"
        autocorrect="off"
        spellcheck="false"
        enterkeyhint="send"
      />
      <button
        type="submit"
        class="shrink-0 rounded border border-[#2b3a32] px-2.5 py-1 text-sm text-[#9fb3a6] transition hover:border-[#7ee787] hover:text-[#7ee787] disabled:opacity-30"
        :disabled="disabled || !value.trim()"
        aria-label="Run command"
      >
        ↵
      </button>
    </form>
  </div>
</template>
