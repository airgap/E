<script lang="ts">
  let { children } = $props<{ children: any }>();
</script>

<div class="message-animation-wrapper">
  {@render children()}
</div>

<style>
  .message-animation-wrapper {
    animation: msg-entrance var(--ht-transition-speed, 200ms) ease-out forwards;
  }

  @keyframes msg-entrance {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
</style>
