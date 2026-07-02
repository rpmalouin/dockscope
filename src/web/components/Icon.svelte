<script lang="ts">
  import { ICONS, type IconDef, type IconName } from '../lib/icons';

  interface Props {
    name: IconName;
    size?: number;
    strokeWidth?: number;
  }

  let { name, size = 13, strokeWidth }: Props = $props();
  let icon = $derived<IconDef>(ICONS[name]);
</script>

{#if icon.fill}
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <!-- eslint-disable-next-line svelte/no-at-html-tags -- static trusted registry markup -->
    {@html icon.body}
  </svg>
{:else}
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width={strokeWidth ?? icon.strokeWidth ?? 2.2}
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <!-- eslint-disable-next-line svelte/no-at-html-tags -- static trusted registry markup -->
    {@html icon.body}
  </svg>
{/if}
