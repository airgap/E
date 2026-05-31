import { api } from '$lib/api/client';

/**
 * OS code file-type registration (opt-in). Mirrors the server registrar's
 * status object and drives the "Register file types" toggle in Settings.
 */
class FileAssociationsStore {
  registered = $state(false);
  supported = $state(false);
  platform = $state('');
  loading = $state(false);
  error = $state<string | null>(null);

  async load() {
    this.loading = true;
    this.error = null;
    try {
      const status = await api.fileAssociations.status();
      this.registered = status.registered;
      this.supported = status.supported;
      this.platform = status.platform;
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.loading = false;
    }
  }

  async register() {
    this.loading = true;
    this.error = null;
    try {
      const result = await api.fileAssociations.register();
      if (!result.ok) this.error = result.message;
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.loading = false;
      await this.load();
    }
  }

  async unregister() {
    this.loading = true;
    this.error = null;
    try {
      const result = await api.fileAssociations.unregister();
      if (!result.ok) this.error = result.message;
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.loading = false;
      await this.load();
    }
  }
}

export const fileAssociationsStore = new FileAssociationsStore();
