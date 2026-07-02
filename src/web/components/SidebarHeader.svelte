<script lang="ts">
  import Icon from './Icon.svelte';
  import type { ServiceNode } from '../../types';
  import type { ContainerUiAction } from '../lib/sidebarApi';
  import type { ConfirmKind } from '../lib/sidebarActions';

  interface Props {
    node: ServiceNode;
    actionPending: boolean;
    /** Hide all actions (replay mode shows historical state) */
    hideActions?: boolean;
    onClose: () => void;
    /** Run an action that needs no confirmation (pause, unpause, restart, start) */
    onDirect: (action: ContainerUiAction) => void;
    /** Ask the parent to confirm and run a destructive action */
    onConfirmAction: (kind: ConfirmKind) => void;
    onHpaDialog: () => void;
  }

  let {
    node,
    actionPending,
    hideActions = false,
    onClose,
    onDirect,
    onConfirmAction,
    onHpaDialog,
  }: Props = $props();

  let showMore = $state(false);
  let moreBtn = $state<HTMLElement | null>(null);
  let isKubernetes = $derived(node.runtime === 'kubernetes');

  // Close the actions menu when the selected node changes
  $effect(() => {
    void node.id;
    showMore = false;
  });

  function pick(kind: ConfirmKind) {
    showMore = false;
    onConfirmAction(kind);
  }
</script>

<div class="sidebar-header">
  <div class="sidebar-title">
    <span
      class="status-dot {node.status === 'running'
        ? node.health === 'unhealthy'
          ? 'unhealthy'
          : 'running'
        : node.status === 'paused'
          ? 'paused'
          : 'exited'}"
    ></span>
    <h3>{node.name}</h3>
  </div>
  <div class="header-right">
    {#if !hideActions}
      {#if isKubernetes}
        <button
          class="act-icon"
          class:spinning={actionPending}
          title="Restart backing pods"
          onclick={() => pick('k8sRestart')}
          disabled={actionPending}
        >
          <Icon name="restart" />
        </button>
      {:else if node.status === 'running'}
        <button
          class="act-icon warning"
          title="Pause"
          onclick={() => onDirect('pause')}
          disabled={actionPending}
        >
          <Icon name="pause" size={11} />
        </button>
        <button
          class="act-icon"
          class:spinning={actionPending}
          title="Restart"
          onclick={() => onDirect('restart')}
          disabled={actionPending}
        >
          <Icon name="restart" />
        </button>
        <button
          class="act-icon danger"
          title="Stop"
          onclick={() => pick('stop')}
          disabled={actionPending}
        >
          <Icon name="stop" size={11} />
        </button>
      {:else if node.status === 'paused'}
        <button
          class="act-icon success"
          title="Unpause"
          onclick={() => onDirect('unpause')}
          disabled={actionPending}
        >
          <Icon name="play" />
        </button>
        <button
          class="act-icon"
          class:spinning={actionPending}
          title="Restart"
          onclick={() => onDirect('restart')}
          disabled={actionPending}
        >
          <Icon name="restart" />
        </button>
      {:else}
        <button
          class="act-icon success"
          title="Start"
          onclick={() => onDirect('start')}
          disabled={actionPending}
        >
          <Icon name="play" />
        </button>
      {/if}

      <!-- More actions trigger -->
      <button
        class="act-icon"
        title="More actions"
        onclick={(e) => {
          moreBtn = e.currentTarget as HTMLElement;
          showMore = !showMore;
        }}
        disabled={actionPending}
      >
        <Icon name="dots" />
      </button>
    {/if}

    <span class="header-sep"></span>
    <button class="close-btn" onclick={onClose}>&times;</button>
  </div>
</div>

{#if showMore && moreBtn}
  <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
  <div class="more-backdrop" onclick={() => (showMore = false)} onkeydown={() => {}}></div>
  <div
    class="more-menu"
    style="top: {moreBtn.getBoundingClientRect().bottom + 4}px; right: {window.innerWidth -
      moreBtn.getBoundingClientRect().right}px;"
  >
    {#if isKubernetes}
      <button class="more-item" onclick={() => pick('k8sRestart')}>Restart</button>
      {#if node.kind === 'hpa'}
        <button
          class="more-item"
          onclick={() => {
            showMore = false;
            onHpaDialog();
          }}>Set replica bounds</button
        >
      {/if}
      <button class="more-item danger" onclick={() => pick('k8sDelete')}>Delete</button>
    {:else if node.status === 'running' || node.status === 'paused'}
      <button class="more-item" onclick={() => pick('kill')}>Kill</button>
    {/if}
    {#if !isKubernetes}
      <button class="more-item danger" onclick={() => pick('remove')}>Remove</button>
      <button class="more-item danger" onclick={() => pick('removeVolumes')}
        >Remove + Volumes</button
      >
    {/if}
  </div>
{/if}
