<script lang="ts">
  interface Props {
    content: string;
  }

  let { content }: Props = $props();
</script>

<div class="svg-renderer">
  {@html content}
</div>

<style>
  .svg-renderer {
    width: 100%;
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 100px;
  }

  .svg-renderer :global(svg) {
    max-width: 100%;
    height: auto;
  }
</style>
