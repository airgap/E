<script lang="ts">
  import { api, setAuthToken } from '$lib/api/client';
  import SpriteAnimation from '$lib/components/ui/SpriteAnimation.svelte';

  let mode = $state<'login' | 'register'>('login');
  let username = $state('');
  let password = $state('');
  let displayName = $state('');
  let error = $state('');
  let loading = $state(false);

  let { onAuthenticated } = $props<{ onAuthenticated: () => void }>();

  async function handleSubmit() {
    error = '';
    loading = true;
    try {
      if (mode === 'register') {
        const res = await api.auth.register(username, password, displayName || undefined);
        setAuthToken(res.data.token);
      } else {
        const res = await api.auth.login(username, password);
        setAuthToken(res.data.token);
      }
      onAuthenticated();
    } catch (e: any) {
      error = e.message || 'Authentication failed';
    }
    loading = false;
  }
</script>

<div class="login-container">
  <div class="login-card">
    <div class="login-header">
      <SpriteAnimation size={64} class="logo-sprite" />
      <p class="tagline">AI Development Environment</p>
    </div>

    <form
      class="login-form"
      onsubmit={(e) => {
        e.preventDefault();
        handleSubmit();
      }}
    >
      <div class="tab-row">
        <button
          type="button"
          class="tab-btn"
          class:active={mode === 'login'}
          onclick={() => (mode = 'login')}
        >
          Sign In
        </button>
        <button
          type="button"
          class="tab-btn"
          class:active={mode === 'register'}
          onclick={() => (mode = 'register')}
        >
          Register
        </button>
      </div>

      {#if mode === 'register'}
        <input bind:value={displayName} type="text" placeholder="Display name" class="form-input" />
      {/if}

      <input bind:value={username} type="text" placeholder="Username" class="form-input" required />
      <input
        bind:value={password}
        type="password"
        placeholder="Password"
        class="form-input"
        required
      />

      {#if error}
        <div class="error">{error}</div>
      {/if}

      <button type="submit" class="submit-btn" disabled={loading}>
        {loading ? 'Authenticating...' : mode === 'login' ? 'Sign In' : 'Create Account'}
      </button>
    </form>
  </div>
</div>

<style>
  .login-container {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    background: var(--bg-primary);
  }
  .login-card {
    width: 360px;
    padding: 40px 32px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-primary);
  }
  .login-header {
    text-align: center;
    margin-bottom: 32px;
  }
  :global(.logo-sprite) {
    margin: 0 auto;
    filter: drop-shadow(0 0 8px var(--accent-primary));
  }
  .tagline {
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 2px;
    margin: 8px 0 0;
  }
  .login-form {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .tab-row {
    display: flex;
    gap: 0;
    border: 1px solid var(--border-secondary);
  }
  .tab-btn {
    flex: 1;
    padding: 8px;
    font-size: var(--fs-xs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1px;
    background: var(--bg-tertiary);
    color: var(--text-tertiary);
    border: none;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .tab-btn.active {
    background: var(--accent-primary);
    color: var(--bg-primary);
  }
  .form-input {
    padding: 10px 12px;
    font-size: var(--fs-base);
    background: var(--bg-primary);
    border: 1px solid var(--border-secondary);
    color: var(--text-primary);
    font-family: inherit;
    transition: border-color 0.15s ease;
  }
  .form-input:focus {
    border-color: var(--accent-primary);
    outline: none;
  }
  .error {
    font-size: var(--fs-sm);
    color: var(--accent-error);
    padding: 8px;
    background: rgba(255, 51, 68, 0.1);
    border: 1px solid rgba(255, 51, 68, 0.3);
  }
  .submit-btn {
    padding: 10px;
    font-size: var(--fs-sm);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1px;
    background: var(--accent-primary);
    color: var(--bg-primary);
    border: none;
    cursor: pointer;
    transition: opacity 0.15s ease;
  }
  .submit-btn:hover:not(:disabled) {
    opacity: 0.9;
  }
  .submit-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
