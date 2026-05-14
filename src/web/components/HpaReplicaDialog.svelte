<script lang="ts">
  import { onMount, tick } from 'svelte';

  interface Props {
    resourceName: string;
    initialMin: number;
    initialMax: number;
    onConfirm: (bounds: { minReplicas: number; maxReplicas: number }) => void;
    onCancel: () => void;
  }

  let { resourceName, initialMin, initialMax, onConfirm, onCancel }: Props = $props();

  let dialogEl = $state<HTMLDialogElement | null>(null);
  let minInput = $state<HTMLInputElement | null>(null);
  let minReplicas = $state('');
  let maxReplicas = $state('');

  let parsed = $derived({
    min: Number.parseInt(minReplicas, 10),
    max: Number.parseInt(maxReplicas, 10),
  });
  let error = $derived.by(() => {
    if (!Number.isInteger(parsed.min) || !Number.isInteger(parsed.max)) {
      return 'Replica bounds must be whole numbers.';
    }
    if (parsed.min < 1) {
      return 'Minimum replicas must be at least 1.';
    }
    if (parsed.max < parsed.min) {
      return 'Maximum replicas must be greater than or equal to minimum replicas.';
    }
    return '';
  });

  function submit() {
    if (error) {
      return;
    }
    onConfirm({ minReplicas: parsed.min, maxReplicas: parsed.max });
  }

  function handleBackdropClick(event: MouseEvent) {
    if (event.target === dialogEl) {
      onCancel();
    }
  }

  $effect(() => {
    minReplicas = String(initialMin);
    maxReplicas = String(initialMax);
  });

  onMount(async () => {
    dialogEl?.showModal();
    await tick();
    minInput?.focus();
    minInput?.select();
  });
</script>

<dialog
  class="hpa-dialog"
  bind:this={dialogEl}
  aria-labelledby="hpa-dialog-title"
  oncancel={(e) => {
    e.preventDefault();
    onCancel();
  }}
  onclick={handleBackdropClick}
>
  <form
    class="hpa-panel"
    onsubmit={(e) => {
      e.preventDefault();
      submit();
    }}
  >
    <div id="hpa-dialog-title" class="hpa-title">Set HPA Replica Bounds</div>
    <p class="hpa-msg">Update replica constraints for <strong>{resourceName}</strong>.</p>

    <div class="hpa-grid">
      <label class="hpa-field">
        <span>Min replicas</span>
        <input
          type="number"
          min="1"
          step="1"
          inputmode="numeric"
          bind:value={minReplicas}
          bind:this={minInput}
        />
      </label>
      <label class="hpa-field">
        <span>Max replicas</span>
        <input type="number" min="1" step="1" inputmode="numeric" bind:value={maxReplicas} />
      </label>
    </div>

    {#if error}
      <div class="hpa-error">{error}</div>
    {/if}

    <div class="hpa-actions">
      <button class="hpa-btn cancel" type="button" onclick={onCancel}>Cancel</button>
      <button class="hpa-btn warning" type="submit" disabled={!!error}>Set Bounds</button>
    </div>
  </form>
</dialog>

<style>
  .hpa-dialog {
    position: fixed;
    top: 50%;
    left: 50%;
    padding: 0;
    margin: 0;
    color: inherit;
    background: transparent;
    border: 0;
    max-width: calc(100vw - 32px);
    transform: translate(-50%, -50%);
  }

  .hpa-dialog::backdrop {
    background: rgba(4, 4, 14, 0.7);
    backdrop-filter: blur(4px);
  }

  .hpa-panel {
    min-width: 340px;
    max-width: 430px;
    padding: 20px 24px;
    background: rgba(8, 10, 24, 0.97);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 12px;
    animation: fadeIn 0.12s ease-out;
  }

  .hpa-title {
    font-family: 'Chakra Petch', sans-serif;
    font-size: 14px;
    font-weight: 600;
    letter-spacing: 0.5px;
    color: #ff8a2b;
    margin-bottom: 8px;
  }

  .hpa-msg {
    font-size: 12px;
    color: #7a8599;
    line-height: 1.5;
    margin-bottom: 16px;
  }

  .hpa-msg strong {
    color: #c8cede;
    font-weight: 600;
  }

  .hpa-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    margin-bottom: 10px;
  }

  .hpa-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .hpa-field span {
    font-size: 10px;
    color: #7a8599;
    text-transform: uppercase;
    letter-spacing: 0.8px;
  }

  .hpa-field input {
    width: 100%;
    font-family: 'Fira Code', monospace;
    font-size: 12px;
    padding: 7px 10px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 6px;
    color: #e2e8f0;
    outline: none;
  }

  .hpa-field input:focus {
    border-color: rgba(255, 138, 43, 0.35);
  }

  .hpa-error {
    font-size: 11px;
    color: #ff2b4e;
    margin-bottom: 12px;
  }

  .hpa-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 16px;
  }

  .hpa-btn {
    font-family: 'Chakra Petch', sans-serif;
    font-size: 11px;
    font-weight: 600;
    padding: 6px 16px;
    border-radius: 6px;
    border: 1px solid;
    cursor: pointer;
    transition: all 0.2s;
    letter-spacing: 0.3px;
  }

  .hpa-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .hpa-btn.cancel {
    color: #7a8599;
    border-color: rgba(255, 255, 255, 0.06);
    background: transparent;
  }

  .hpa-btn.cancel:hover {
    background: rgba(255, 255, 255, 0.03);
  }

  .hpa-btn.warning {
    color: #ff8a2b;
    border-color: rgba(255, 138, 43, 0.2);
    background: rgba(255, 138, 43, 0.08);
  }

  .hpa-btn.warning:hover:not(:disabled) {
    background: rgba(255, 138, 43, 0.16);
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
</style>
