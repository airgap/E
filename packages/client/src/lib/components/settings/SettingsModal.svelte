<script lang="ts">
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { uiStore } from '$lib/stores/ui.svelte';
  import { api, getBaseUrl } from '$lib/api/client';
  import { onMount } from 'svelte';
  import { desktopNotifications } from '$lib/notifications/desktop-notifications';
  import type {
    CliProvider,
    OneshotProvider,
    PermissionRule,
    PermissionRulePreset,
    TerminalCommandPolicy,
    AgentProfile,
    AgentProfileCreateInput,
    ShellInfo,
    CommentaryPersonality,
    CommentaryVerbosity,
  } from '@e/shared';
  import { PERMISSION_PRESETS } from '@e/shared';
  import { profilesStore } from '$lib/stores/profiles.svelte';
  import { MONO_FONTS, SANS_FONTS, findFont } from '$lib/config/fonts';
  import { SIDEBAR_TABS } from '$lib/config/sidebarTabs';
  import { THEMES } from '$lib/config/themes';
  import { workspaceStore } from '$lib/stores/workspace.svelte';
  import WebhookSettings from './WebhookSettings.svelte';
  import RemoteAccessSettings from './RemoteAccessSettings.svelte';
  import NotificationChannelsSettings from './NotificationChannelsSettings.svelte';
  import DeviceSettings from './DeviceSettings.svelte';
  import PatternDetectionSettings from './PatternDetectionSettings.svelte';
  import * as remoteAccessApi from '$lib/api/remote-access';

  const cliProviders: { id: CliProvider; label: string; desc: string }[] = [
    { id: 'claude', label: 'Claude Code', desc: 'Anthropic Claude CLI' },
    { id: 'kiro', label: 'Kiro CLI', desc: 'AWS Kiro CLI' },
    { id: 'gemini-cli', label: 'Gemini CLI', desc: 'Google Gemini CLI' },
    { id: 'copilot', label: 'Copilot CLI', desc: 'GitHub Copilot CLI' },
  ];

  const oneshotProviders: { id: OneshotProvider; label: string; desc: string }[] = [
    { id: 'auto', label: 'Auto', desc: 'Try local Ollama first, fall back to CLI' },
    { id: 'ollama', label: 'Ollama', desc: 'Always use local Ollama' },
    { id: 'cli', label: 'CLI', desc: 'Use the main CLI provider above' },
  ];

  // Check if the profiles tab was requested via localStorage flag
  function getInitialTab():
    | 'general'
    | 'appearance'
    | 'audio'
    | 'commentary'
    | 'editor'
    | 'terminal'
    | 'permissions'
    | 'security'
    | 'mcp'
    | 'keybindings'
    | 'profiles'
    | 'webhooks'
    | 'notifications'
    | 'remote'
    | 'learning' {
    if (typeof localStorage !== 'undefined') {
      const tab = localStorage.getItem('e-settings-tab');
      if (tab) {
        localStorage.removeItem('e-settings-tab');
        return tab as any;
      }
    }
    return 'general';
  }

  let activeTab = $state<
    | 'general'
    | 'appearance'
    | 'audio'
    | 'commentary'
    | 'editor'
    | 'terminal'
    | 'permissions'
    | 'security'
    | 'mcp'
    | 'keybindings'
    | 'profiles'
    | 'webhooks'
    | 'notifications'
    | 'remote'
    | 'device'
    | 'learning'
  >(getInitialTab());

  // --- BYOK state ---
  let apiKeyStatus = $state<Record<string, boolean>>({});
  let apiKeyInputs = $state<Record<string, string>>({});
  let apiKeySaving = $state<Record<string, boolean>>({});

  const apiProviders = [
    { id: 'anthropic', label: 'Anthropic', desc: 'Claude models' },
    { id: 'openai', label: 'OpenAI', desc: 'GPT models' },
    { id: 'google', label: 'Google', desc: 'Gemini models' },
    { id: 'whisper', label: 'Whisper', desc: 'Voice transcription (optional for voice mode)' },
  ];

  async function loadApiKeyStatus() {
    try {
      const res = await api.settings.apiKeysStatus();
      apiKeyStatus = res.data;
    } catch {}
  }

  async function saveApiKey(provider: string) {
    const key = apiKeyInputs[provider]?.trim();
    if (!key) return;
    apiKeySaving = { ...apiKeySaving, [provider]: true };
    try {
      await api.settings.setApiKey(provider, key);
      apiKeyInputs = { ...apiKeyInputs, [provider]: '' };
      await loadApiKeyStatus();
      uiStore.toast(`${provider} API key saved`, 'success');
    } catch {
      uiStore.toast(`Failed to save ${provider} API key`, 'error');
    }
    apiKeySaving = { ...apiKeySaving, [provider]: false };
  }

  // --- Budget state ---
  let budgetValue = $state<string>('');
  let budgetLoading = $state(false);

  async function loadBudget() {
    try {
      const res = await api.settings.getBudget();
      budgetValue = res.data.budgetUsd != null ? String(res.data.budgetUsd) : '';
    } catch {}
  }

  async function saveBudget() {
    budgetLoading = true;
    try {
      const val = budgetValue.trim() ? parseFloat(budgetValue) : null;
      await api.settings.setBudget(val);
      settingsStore.update({ sessionBudgetUsd: val });
      uiStore.toast(val ? `Budget set to $${val.toFixed(2)}` : 'Budget limit removed', 'success');
    } catch {
      uiStore.toast('Failed to save budget', 'error');
    }
    budgetLoading = false;
  }

  // --- Commentary settings state ---
  const commentaryPersonalities: {
    id: CommentaryPersonality;
    label: string;
    description: string;
  }[] = [
    {
      id: 'documentary_narrator',
      label: 'Documentary Narrator',
      description: 'Calm, thoughtful observations on developer behavior',
    },
    {
      id: 'technical_analyst',
      label: 'Technical Analyst',
      description: 'Strategic, engineering-focused analysis',
    },
    {
      id: 'comedic_observer',
      label: 'Comedic Observer',
      description: 'Witty, playful commentary with self-aware humor',
    },
    {
      id: 'project_lead',
      label: 'Project Lead',
      description: 'First-person, authoritative progress updates',
    },
    {
      id: 'wizard',
      label: 'Wizard',
      description: 'Mystical, arcane commentary on the craft of code',
    },
  ];

  const verbosityOptions: { value: CommentaryVerbosity; label: string; description: string }[] = [
    {
      value: 'frequent',
      label: 'Frequent',
      description: 'Commentary every 3-5 seconds on most events',
    },
    {
      value: 'strategic',
      label: 'Strategic Milestones',
      description: 'Key actions: tool use, completions, quality checks',
    },
    {
      value: 'minimal',
      label: 'Minimal',
      description: 'Only major milestones: story completion, errors',
    },
  ];

  let commentaryEnabled = $state(false);
  let commentaryPersonality = $state<CommentaryPersonality>('technical_analyst');
  let commentaryVerbosity = $state<CommentaryVerbosity>('strategic');
  let commentaryLoading = $state(false);
  let commentaryPreviewText = $state('');
  let commentaryPreviewLoading = $state(false);
  let commentarySpatialAudioEnabled = $state(false);
  let commentaryHistoryEnabled = $state(true);

  async function loadCommentarySettings() {
    const wsId = workspaceStore.activeWorkspaceId;
    if (!wsId) return;
    commentaryLoading = true;
    try {
      const res = await api.commentary.getSettings(wsId);
      if (res.ok && res.data) {
        commentaryEnabled = res.data.enabled;
        commentaryPersonality = res.data.personality as CommentaryPersonality;
        commentaryVerbosity = res.data.verbosity as CommentaryVerbosity;
      }
      // Load history-enabled and spatial audio from workspace settings
      const wsRes = await api.workspaces.get(wsId);
      if (wsRes.ok && wsRes.data?.settings) {
        commentaryHistoryEnabled = wsRes.data.settings.commentaryHistoryEnabled !== false;
        commentarySpatialAudioEnabled = wsRes.data.settings.commentarySpatialAudioEnabled === true;
      }
    } catch {
      /* settings unavailable — keep defaults */
    }
    commentaryLoading = false;
  }

  async function saveCommentarySetting(update: {
    enabled?: boolean;
    personality?: string;
    verbosity?: string;
  }) {
    const wsId = workspaceStore.activeWorkspaceId;
    if (!wsId) return;
    try {
      const res = await api.commentary.updateSettings(wsId, update);
      if (res.ok && res.data) {
        commentaryEnabled = res.data.enabled;
        commentaryPersonality = res.data.personality as CommentaryPersonality;
        commentaryVerbosity = res.data.verbosity as CommentaryVerbosity;
      }
    } catch {
      uiStore.toast('Failed to save commentary settings', 'error');
    }
  }

  async function previewCommentary() {
    commentaryPreviewLoading = true;
    commentaryPreviewText = '';
    const personality = commentaryPersonalities.find((p) => p.id === commentaryPersonality);
    const sampleTexts: Record<CommentaryPersonality, string> = {
      documentary_narrator:
        'Here we observe the developer in their natural habitat, methodically restructuring the codebase. Notice the careful, deliberate keystrokes — each one a small step in the eternal dance of software evolution.',
      technical_analyst:
        'Interesting architectural decision here. The developer is extracting shared logic into a utility module — this should reduce coupling between the service layer and the route handlers. Clean separation of concerns.',
      comedic_observer:
        "Oh look, another TODO comment. I'm sure that'll get addressed right after the heat death of the universe. Meanwhile, our hero boldly copy-pastes from Stack Overflow — as the ancients intended.",
      project_lead:
        "Good progress on the settings module. We're on track to have the commentary system fully integrated by end of sprint. The architecture is solid and the team's velocity is looking strong.",
      wizard:
        'The arcane runes take shape upon the screen... A new incantation is being woven into the great tapestry of code. The developer channels ancient wisdom through their mechanical familiar.',
    };
    commentaryPreviewText = sampleTexts[commentaryPersonality] || sampleTexts.technical_analyst;
    commentaryPreviewLoading = false;
  }

  // --- Sandbox state ---
  let sandboxEnabled = $state(false);
  let sandboxPaths = $state<string[]>([]);
  let sandboxNewPath = $state('');
  let sandboxLoading = $state(false);

  async function loadSandbox() {
    try {
      const res = await api.workspaces.getSandbox(settingsStore.workspacePath);
      sandboxEnabled = res.data.enabled;
      sandboxPaths = res.data.allowedPaths;
    } catch {}
  }

  async function saveSandbox() {
    sandboxLoading = true;
    try {
      await api.workspaces.updateSandbox({
        workspacePath: settingsStore.workspacePath,
        enabled: sandboxEnabled,
        allowedPaths: sandboxPaths,
      });
      uiStore.toast('Sandbox settings saved', 'success');
    } catch {
      uiStore.toast('Failed to save sandbox settings', 'error');
    }
    sandboxLoading = false;
  }

  function addSandboxPath() {
    const p = sandboxNewPath.trim();
    if (p && !sandboxPaths.includes(p)) {
      sandboxPaths = [...sandboxPaths, p];
      sandboxNewPath = '';
    }
  }

  function removeSandboxPath(path: string) {
    sandboxPaths = sandboxPaths.filter((p) => p !== path);
  }

  // --- Remote Access state ---
  let remoteAccessEnabled = $state(false);
  let remoteAccessMode = $state<'disabled' | 'tailscale' | 'ssh'>('disabled');
  let remoteAccessLoading = $state(false);
  let tailscaleStatus = $state<remoteAccessApi.TailscaleStatusData | null>(null);
  let sshTunnelCommand = $state<remoteAccessApi.SSHTunnelCommandData | null>(null);
  let remoteClients = $state<any[]>([]);
  let tailscaleUrl = $state<string | null>(null);
  let tailscaleConfiguring = $state(false);
  let sshRemoteHost = $state('');

  async function loadRemoteAccessSettings() {
    remoteAccessLoading = true;
    try {
      const status = await remoteAccessApi.getRemoteAccessStatus();
      remoteAccessEnabled = status.config.enabled;
      tailscaleStatus = status.tailscaleStatus;
      sshTunnelCommand = status.sshTunnel;

      // Determine mode based on settings
      if (status.config.tailscaleEnabled) {
        remoteAccessMode = 'tailscale';
      } else if (status.config.sshTunnelEnabled) {
        remoteAccessMode = 'ssh';
      } else {
        remoteAccessMode = 'disabled';
      }
    } catch (error) {
      console.error('Failed to load remote access settings:', error);
    }
    remoteAccessLoading = false;
  }

  async function loadRemoteClients() {
    try {
      remoteClients = await remoteAccessApi.getRemoteClients();
    } catch (error) {
      console.error('Failed to load remote clients:', error);
    }
  }

  async function toggleRemoteAccess() {
    try {
      const newEnabled = !remoteAccessEnabled;
      await remoteAccessApi.updateRemoteAccessConfig({
        enabled: newEnabled,
        tailscaleEnabled: remoteAccessMode === 'tailscale',
        sshTunnelEnabled: remoteAccessMode === 'ssh',
        requireAuth: true,
      });
      remoteAccessEnabled = newEnabled;
      uiStore.toast(newEnabled ? 'Remote access enabled' : 'Remote access disabled', 'success');
    } catch (error) {
      uiStore.toast('Failed to update remote access settings', 'error');
    }
  }

  async function updateRemoteAccessMode(mode: 'disabled' | 'tailscale' | 'ssh') {
    try {
      remoteAccessMode = mode;
      await remoteAccessApi.updateRemoteAccessConfig({
        enabled: mode !== 'disabled',
        tailscaleEnabled: mode === 'tailscale',
        sshTunnelEnabled: mode === 'ssh',
        requireAuth: true,
      });
      remoteAccessEnabled = mode !== 'disabled';
      uiStore.toast('Remote access mode updated', 'success');

      // Reload status to get updated info
      await loadRemoteAccessSettings();
    } catch (error) {
      uiStore.toast('Failed to update remote access mode', 'error');
    }
  }

  async function configureTailscaleServe() {
    tailscaleConfiguring = true;
    try {
      const result = await remoteAccessApi.configureTailscale(false);
      tailscaleUrl = result.url;
      uiStore.toast('Tailscale serve configured', 'success');
      await loadRemoteAccessSettings();
    } catch (error: any) {
      uiStore.toast(error.message || 'Failed to configure Tailscale', 'error');
    }
    tailscaleConfiguring = false;
  }

  async function stopTailscaleServe() {
    tailscaleConfiguring = true;
    try {
      await remoteAccessApi.stopTailscale();
      tailscaleUrl = null;
      uiStore.toast('Tailscale serve stopped', 'success');
      await loadRemoteAccessSettings();
    } catch (error: any) {
      uiStore.toast(error.message || 'Failed to stop Tailscale', 'error');
    }
    tailscaleConfiguring = false;
  }

  async function updateSshTunnelCommand() {
    try {
      sshTunnelCommand = await remoteAccessApi.getSSHTunnelCommand(sshRemoteHost || undefined);
    } catch (error) {
      console.error('Failed to get SSH tunnel command:', error);
    }
  }

  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      uiStore.toast('Copied to clipboard', 'success');
    } catch (error) {
      uiStore.toast('Failed to copy to clipboard', 'error');
    }
  }

  // --- Snippet import state ---
  let snippetLanguage = $state('javascript');
  let snippetFileInput: HTMLInputElement;

  const supportedLanguages = [
    'javascript',
    'typescript',
    'python',
    'rust',
    'go',
    'java',
    'cpp',
    'css',
    'html',
    'json',
    'markdown',
    'sql',
    'shell',
    'xml',
  ];

  function handleSnippetImport(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const json = JSON.parse(reader.result as string);
        const count = settingsStore.importSnippets(json, snippetLanguage);
        uiStore.toast(`Imported ${count} snippets for ${snippetLanguage}`, 'success');
      } catch {
        uiStore.toast('Invalid snippet JSON file', 'error');
      }
      input.value = '';
    };
    reader.readAsText(file);
  }

  // --- Theme import state ---
  let themeFileInput: HTMLInputElement;

  function handleThemeImport(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const json = JSON.parse(reader.result as string);
        const id = settingsStore.importTheme(json);
        settingsStore.setTheme(id);
        uiStore.toast('Theme imported and applied', 'success');
      } catch {
        uiStore.toast('Invalid theme JSON file', 'error');
      }
      input.value = '';
    };
    reader.readAsText(file);
  }

  const cloudModels = [
    { id: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    { id: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5' },
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
  ];

  let ollamaAvailable = $state(false);
  let ollamaModels = $state<Array<{ name: string; size: number }>>([]);
  let models = $state(cloudModels);

  // --- Mobile nav tab customization ---
  /** All available choices for mobile nav bar (special views + sidebar tabs) */
  const MOBILE_NAV_CHOICES: Array<{ id: string; label: string; icon: string }> = [
    {
      id: 'chat',
      label: 'Chat',
      icon: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
    },
    { id: 'terminal', label: 'Terminal', icon: 'M4 17l6-6-6-6M12 19h8' },
    ...SIDEBAR_TABS.map((t) => ({ id: t.id, label: t.label, icon: t.icon })),
  ];

  function mobileNavIsSelected(id: string): boolean {
    return settingsStore.mobileNavTabs.includes(id);
  }

  function mobileNavToggle(id: string) {
    const current = [...settingsStore.mobileNavTabs];
    const idx = current.indexOf(id);
    if (idx >= 0) {
      current.splice(idx, 1);
    } else if (current.length < 10) {
      current.push(id);
    }
    settingsStore.update({ mobileNavTabs: current });
  }

  function mobileNavMove(id: string, direction: -1 | 1) {
    const current = [...settingsStore.mobileNavTabs];
    const idx = current.indexOf(id);
    if (idx < 0) return;
    const target = idx + direction;
    if (target < 0 || target >= current.length) return;
    [current[idx], current[target]] = [current[target], current[idx]];
    settingsStore.update({ mobileNavTabs: current });
  }

  // --- Terminal settings state ---
  let detectedShells = $state<ShellInfo[]>([]);
  let shellsLoading = $state(false);

  // --- Terminal profile editing state ---
  let termProfileEditing = $state(false);
  let termProfileEditId = $state<string | null>(null);
  let termProfileName = $state('');
  let termProfileShellPath = $state('');
  let termProfileArgs = $state('');
  let termProfileEnvText = $state('');
  let termProfileCwd = $state('');
  let termProfileIcon = $state('terminal');

  function startNewTermProfile() {
    termProfileEditing = true;
    termProfileEditId = null;
    termProfileName = '';
    termProfileShellPath = '';
    termProfileArgs = '';
    termProfileEnvText = '';
    termProfileCwd = '';
    termProfileIcon = 'terminal';
  }

  function startEditTermProfile(id: string) {
    const p = settingsStore.terminalProfiles.find((prof) => prof.id === id);
    if (!p) return;
    termProfileEditing = true;
    termProfileEditId = id;
    termProfileName = p.name;
    termProfileShellPath = p.shellPath;
    termProfileArgs = (p.args || []).join(' ');
    termProfileEnvText = Object.entries(p.env || {})
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');
    termProfileCwd = p.cwd || '';
    termProfileIcon = p.icon || 'terminal';
  }

  function cancelTermProfileEdit() {
    termProfileEditing = false;
    termProfileEditId = null;
  }

  function saveTermProfile() {
    if (!termProfileName.trim() || !termProfileShellPath.trim()) return;

    const args = termProfileArgs.trim() ? termProfileArgs.trim().split(/\s+/) : [];
    const env: Record<string, string> = {};
    for (const line of termProfileEnvText.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.includes('=')) continue;
      const eqIdx = trimmed.indexOf('=');
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (key) env[key] = val;
    }

    if (termProfileEditId) {
      settingsStore.updateTerminalProfile(termProfileEditId, {
        name: termProfileName.trim(),
        shellPath: termProfileShellPath.trim(),
        args,
        env,
        cwd: termProfileCwd.trim() || undefined,
        icon: termProfileIcon,
      });
    } else {
      const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      settingsStore.addTerminalProfile({
        id,
        name: termProfileName.trim(),
        shellPath: termProfileShellPath.trim(),
        args,
        env,
        cwd: termProfileCwd.trim() || undefined,
        icon: termProfileIcon,
      });
    }

    termProfileEditing = false;
    termProfileEditId = null;
  }

  function deleteTermProfile(id: string) {
    settingsStore.deleteTerminalProfile(id);
  }

  function setTermDefaultProfile(id: string) {
    if (settingsStore.termDefaultProfileId === id) {
      settingsStore.setDefaultProfileId('');
    } else {
      settingsStore.setDefaultProfileId(id);
    }
  }

  async function loadDetectedShells() {
    shellsLoading = true;
    try {
      const res = await fetch(`${getBaseUrl()}/terminal/shells`);
      const json = await res.json();
      if (json.ok && json.data) {
        detectedShells = json.data;
      }
    } catch {
      /* shells not available */
    }
    shellsLoading = false;
  }

  onMount(async () => {
    let combined = [...cloudModels];

    // Ollama local models
    try {
      const status = await api.settings.ollamaStatus();
      ollamaAvailable = status.data.available;
      if (ollamaAvailable) {
        const res = await api.settings.ollamaModels();
        ollamaModels = res.data;
        combined = [
          ...combined,
          ...ollamaModels.map((m) => ({
            id: `ollama:${m.name}`,
            label: `${m.name} (local)`,
          })),
        ];
      }
    } catch {
      /* Ollama not available */
    }

    // Pre-load security data so we know which keys are set before fetching remote models
    await loadApiKeyStatus();

    // OpenAI models (only if key is configured)
    if (apiKeyStatus['openai']) {
      try {
        const res = await api.settings.openaiModels();
        if (res.data?.length) {
          combined = [
            ...combined,
            ...res.data.map((m) => ({ id: `openai:${m.id}`, label: `${m.name} (OpenAI)` })),
          ];
        }
      } catch {
        /* OpenAI not available */
      }
    }

    // Google Gemini models (only if key is configured)
    if (apiKeyStatus['google']) {
      try {
        const res = await api.settings.geminiModels();
        if (res.data?.length) {
          combined = [
            ...combined,
            ...res.data.map((m) => ({ id: `gemini:${m.id}`, label: `${m.name} (Gemini)` })),
          ];
        }
      } catch {
        /* Gemini not available */
      }
    }

    models = combined;
    loadBudget();
    loadSandbox();
    loadPermissionRules();
    loadDetectedShells();
    loadCommentarySettings();
    profilesStore.load();
  });

  const permModes = [
    { id: 'plan', label: 'Plan', desc: 'Read-only, plan before executing' },
    { id: 'safe', label: 'Safe', desc: 'Prompts for all modifications' },
    { id: 'fast', label: 'Fast', desc: 'Auto-approves safe commands' },
    { id: 'unrestricted', label: 'Yolo', desc: 'All tools auto-approved — no prompts, ever' },
  ];

  const terminalPolicies: { id: TerminalCommandPolicy; label: string; desc: string }[] = [
    { id: 'off', label: 'Off', desc: 'Terminal commands are blocked' },
    { id: 'auto', label: 'Auto', desc: 'Follows the general permission mode' },
    { id: 'turbo', label: 'Turbo', desc: 'All terminal commands auto-approved' },
    { id: 'custom', label: 'Custom', desc: 'Use per-tool rules for Bash' },
  ];

  // --- Permission rules state ---
  let permRules = $state<PermissionRule[]>([]);
  let permRulesLoading = $state(false);
  let permRulesScope = $state<'global' | 'project' | 'session'>('global');
  let newRuleType = $state<'allow' | 'deny' | 'ask'>('allow');
  let newRuleTool = $state('');
  let newRulePattern = $state('');
  let editingRuleId = $state<string | null>(null);

  const builtinToolNames = [
    'Read',
    'Write',
    'Edit',
    'Glob',
    'Grep',
    'Bash',
    'WebFetch',
    'WebSearch',
    'NotebookEdit',
    '*',
  ];

  async function loadPermissionRules() {
    permRulesLoading = true;
    try {
      const res = await api.settings.getPermissionRules({
        scope: permRulesScope,
        workspacePath: permRulesScope === 'project' ? settingsStore.workspacePath : undefined,
      });
      permRules = res.data;
    } catch {
      permRules = [];
    }
    permRulesLoading = false;
  }

  async function addPermissionRule() {
    if (!newRuleTool.trim()) return;
    try {
      const res = await api.settings.createPermissionRule({
        type: newRuleType,
        tool: newRuleTool.trim(),
        pattern: newRulePattern.trim() || undefined,
        scope: permRulesScope,
        workspacePath: permRulesScope === 'project' ? settingsStore.workspacePath : undefined,
      });
      permRules = [...permRules, res.data];
      newRuleTool = '';
      newRulePattern = '';
      uiStore.toast('Permission rule added', 'success');
    } catch {
      uiStore.toast('Failed to add rule', 'error');
    }
  }

  async function deleteRule(ruleId: string) {
    try {
      await api.settings.deletePermissionRule(ruleId);
      permRules = permRules.filter((r) => r.id !== ruleId);
      uiStore.toast('Rule removed', 'success');
    } catch {
      uiStore.toast('Failed to delete rule', 'error');
    }
  }

  async function applyPreset(presetId: string) {
    try {
      const res = await api.settings.applyPermissionPreset({
        presetId,
        scope: permRulesScope,
        workspacePath: permRulesScope === 'project' ? settingsStore.workspacePath : undefined,
      });
      permRules = res.data;
      uiStore.toast('Preset applied', 'success');
    } catch {
      uiStore.toast('Failed to apply preset', 'error');
    }
  }

  // --- Agent Profiles state ---
  let showProfileForm = $state(false);
  let editingProfile = $state<AgentProfile | null>(null);
  let profileFormName = $state('');
  let profileFormDescription = $state('');
  let profileFormPermissionMode = $state<'plan' | 'safe' | 'fast' | 'unrestricted'>('unrestricted');
  let profileFormAllowedTools = $state('');
  let profileFormDisallowedTools = $state('');
  let profileFormSystemPrompt = $state('');
  let profileFormSaving = $state(false);

  function openNewProfileForm() {
    editingProfile = null;
    profileFormName = '';
    profileFormDescription = '';
    profileFormPermissionMode = 'unrestricted';
    profileFormAllowedTools = '';
    profileFormDisallowedTools = '';
    profileFormSystemPrompt = '';
    showProfileForm = true;
  }

  function openEditProfileForm(profile: AgentProfile) {
    editingProfile = profile;
    profileFormName = profile.name;
    profileFormDescription = profile.description ?? '';
    profileFormPermissionMode = profile.permissionMode as any;
    profileFormAllowedTools = profile.allowedTools.join(', ');
    profileFormDisallowedTools = profile.disallowedTools.join(', ');
    profileFormSystemPrompt = profile.systemPrompt ?? '';
    showProfileForm = true;
  }

  function closeProfileForm() {
    showProfileForm = false;
    editingProfile = null;
  }

  function parseToolList(str: string): string[] {
    return str
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  async function saveProfile() {
    if (!profileFormName.trim()) return;
    profileFormSaving = true;
    try {
      const input: AgentProfileCreateInput = {
        name: profileFormName.trim(),
        description: profileFormDescription.trim() || undefined,
        permissionMode: profileFormPermissionMode,
        allowedTools: parseToolList(profileFormAllowedTools),
        disallowedTools: parseToolList(profileFormDisallowedTools),
        systemPrompt: profileFormSystemPrompt.trim() || undefined,
      };
      if (editingProfile) {
        await profilesStore.update(editingProfile.id, input);
        uiStore.toast('Profile updated', 'success');
      } else {
        await profilesStore.create(input);
        uiStore.toast('Profile created', 'success');
      }
      closeProfileForm();
    } catch {
      uiStore.toast('Failed to save profile', 'error');
    }
    profileFormSaving = false;
  }

  async function deleteProfile(id: string) {
    try {
      await profilesStore.delete(id);
      uiStore.toast('Profile deleted', 'success');
    } catch {
      uiStore.toast('Failed to delete profile', 'error');
    }
  }

  function close() {
    uiStore.closeModal();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="modal-overlay" onclick={close}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal" onclick={(e) => e.stopPropagation()}>
    <div class="modal-header">
      <h2>Settings</h2>
      <button class="close-btn" onclick={close}>
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
    </div>

    <div class="modal-body">
      <nav class="settings-tabs">
        <span class="settings-section-header">Interface</span>
        {#each ['general', 'appearance', 'audio', 'commentary', 'editor', 'terminal', 'keybindings'] as tab}
          <button
            class="settings-tab"
            class:active={activeTab === tab}
            onclick={() => (activeTab = tab as any)}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        {/each}
        <span class="settings-section-header">Access Control</span>
        {#each ['permissions', 'profiles', 'security', 'device'] as tab}
          <button
            class="settings-tab"
            class:active={activeTab === tab}
            onclick={() => (activeTab = tab as any)}
          >
            {tab === 'device' ? 'Device Capabilities' : tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        {/each}
        <span class="settings-section-header">Integrations</span>
        {#each ['mcp', 'webhooks', 'notifications', 'remote', 'learning'] as tab}
          <button
            class="settings-tab"
            class:active={activeTab === tab}
            onclick={() => (activeTab = tab as any)}
          >
            {tab === 'mcp'
              ? 'MCP'
              : tab === 'remote'
                ? 'Remote Access'
                : tab === 'learning'
                  ? 'Pattern Learning'
                  : tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        {/each}
      </nav>

      <div class="settings-content">
        {#if activeTab === 'general'}
          <div class="setting-group">
            <label class="setting-label">CLI Provider</label>
            <p class="setting-hint">Choose which coding agent CLI powers your sessions</p>
            <div class="provider-grid">
              {#each cliProviders as p}
                <button
                  class="provider-option"
                  class:active={settingsStore.cliProvider === p.id}
                  onclick={() => settingsStore.update({ cliProvider: p.id })}
                >
                  <span class="provider-name">{p.label}</span>
                  <span class="provider-desc">{p.desc}</span>
                </button>
              {/each}
            </div>
          </div>
          <div class="setting-group">
            <label class="setting-label">Model</label>
            <select
              value={settingsStore.model}
              onchange={(e) => settingsStore.setModel((e.target as HTMLSelectElement).value)}
            >
              {#each models as m}<option value={m.id}>{m.label}</option>{/each}
            </select>
          </div>
          <div class="setting-group">
            <label class="setting-label">One-shot LLM Provider</label>
            <p class="setting-hint">
              How to run lightweight AI tasks (commentary, code actions, commit messages)
            </p>
            <div class="provider-grid">
              {#each oneshotProviders as p}
                <button
                  class="provider-option"
                  class:active={settingsStore.oneshotProvider === p.id}
                  onclick={() => settingsStore.update({ oneshotProvider: p.id })}
                >
                  <span class="provider-name">{p.label}</span>
                  <span class="provider-desc">{p.desc}</span>
                </button>
              {/each}
            </div>
          </div>
          {#if settingsStore.oneshotProvider !== 'cli'}
            <div class="setting-group">
              <label class="setting-label">One-shot Model</label>
              <p class="setting-hint">
                Local Ollama model for one-shot tasks{ollamaAvailable
                  ? ''
                  : ' (Ollama not detected)'}
              </p>
              {#if ollamaAvailable && ollamaModels.length > 0}
                <select
                  value={settingsStore.oneshotModel}
                  onchange={(e) =>
                    settingsStore.update({ oneshotModel: (e.target as HTMLSelectElement).value })}
                >
                  {#each ollamaModels as m}
                    <option value={m.name}>{m.name} ({(m.size / 1e9).toFixed(1)}GB)</option>
                  {/each}
                </select>
              {:else}
                <input
                  type="text"
                  class="setting-text-input"
                  value={settingsStore.oneshotModel}
                  placeholder="e.g. qwen3:1.7b"
                  onchange={(e) =>
                    settingsStore.update({ oneshotModel: (e.target as HTMLInputElement).value })}
                />
                {#if !ollamaAvailable}
                  <p class="setting-desc setting-warn">
                    Ollama not running. Install from ollama.com and run <code
                      >ollama pull qwen3:1.7b</code
                    >
                  </p>
                {/if}
              {/if}
            </div>
          {/if}
          <div class="setting-group">
            <label class="setting-label">Auto-scroll</label>
            <label class="toggle">
              <input
                type="checkbox"
                checked={settingsStore.autoScroll}
                onchange={() => settingsStore.update({ autoScroll: !settingsStore.autoScroll })}
              />
              <span class="toggle-slider"></span>
            </label>
          </div>
          <div class="setting-group">
            <label class="setting-label">Send with Enter</label>
            <label class="toggle">
              <input
                type="checkbox"
                checked={settingsStore.sendWithEnter}
                onchange={() =>
                  settingsStore.update({ sendWithEnter: !settingsStore.sendWithEnter })}
              />
              <span class="toggle-slider"></span>
            </label>
            <p class="setting-desc">When off, use Ctrl+Enter to send</p>
          </div>
          <div class="setting-group">
            <label class="setting-label">Show thinking blocks</label>
            <label class="toggle">
              <input
                type="checkbox"
                checked={settingsStore.showThinkingBlocks}
                onchange={() =>
                  settingsStore.update({ showThinkingBlocks: !settingsStore.showThinkingBlocks })}
              />
              <span class="toggle-slider"></span>
            </label>
          </div>
          <div class="setting-group">
            <label class="setting-label">Show tool details</label>
            <label class="toggle">
              <input
                type="checkbox"
                checked={settingsStore.showToolDetails}
                onchange={() =>
                  settingsStore.update({ showToolDetails: !settingsStore.showToolDetails })}
              />
              <span class="toggle-slider"></span>
            </label>
          </div>
          <div class="setting-group">
            <label class="setting-label">Auto-memory</label>
            <label class="toggle">
              <input
                type="checkbox"
                checked={settingsStore.autoMemoryEnabled}
                onchange={() =>
                  settingsStore.update({ autoMemoryEnabled: !settingsStore.autoMemoryEnabled })}
              />
              <span class="toggle-slider"></span>
            </label>
          </div>

          <!-- Mobile Navigation Bar -->
          <div class="setting-group">
            <label class="setting-label">Mobile navigation bar</label>
            <p class="setting-desc">
              Choose up to 10 tabs for the bottom nav bar on mobile. "More" is always appended.
            </p>

            <!-- Currently selected tabs (ordered) -->
            {#if settingsStore.mobileNavTabs.length > 0}
              <div class="mobile-nav-selected">
                {#each settingsStore.mobileNavTabs as tabId, i (tabId)}
                  {@const choice = MOBILE_NAV_CHOICES.find((c) => c.id === tabId)}
                  {#if choice}
                    <div class="mobile-nav-chip">
                      <span class="mobile-nav-chip-order">{i + 1}</span>
                      <svg
                        class="mobile-nav-chip-icon"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <path d={choice.icon} />
                      </svg>
                      <span class="mobile-nav-chip-label">{choice.label}</span>
                      <div class="mobile-nav-chip-actions">
                        <button
                          class="mobile-nav-chip-btn"
                          title="Move up"
                          disabled={i === 0}
                          onclick={() => mobileNavMove(tabId, -1)}>&#x25B2;</button
                        >
                        <button
                          class="mobile-nav-chip-btn"
                          title="Move down"
                          disabled={i === settingsStore.mobileNavTabs.length - 1}
                          onclick={() => mobileNavMove(tabId, 1)}>&#x25BC;</button
                        >
                        <button
                          class="mobile-nav-chip-btn remove"
                          title="Remove"
                          onclick={() => mobileNavToggle(tabId)}>&#x2715;</button
                        >
                      </div>
                    </div>
                  {/if}
                {/each}
              </div>
            {/if}

            <!-- Available tabs to add -->
            <div class="mobile-nav-available">
              {#each MOBILE_NAV_CHOICES as choice (choice.id)}
                {#if !mobileNavIsSelected(choice.id)}
                  <button
                    class="mobile-nav-add-btn"
                    disabled={settingsStore.mobileNavTabs.length >= 10}
                    onclick={() => mobileNavToggle(choice.id)}
                    title="Add {choice.label}"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <path d={choice.icon} />
                    </svg>
                    {choice.label}
                  </button>
                {/if}
              {/each}
            </div>
          </div>
        {:else if activeTab === 'appearance'}
          <div class="setting-group">
            <label class="setting-label">Immersive Themes</label>
            <div class="hypertheme-grid">
              {#each THEMES.filter((t) => t.category === 'immersive') as ht}
                <button
                  class="hypertheme-option"
                  class:active={settingsStore.theme === ht.id}
                  onclick={() => settingsStore.setTheme(ht.id)}
                >
                  <span class="ht-icon"
                    ><svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"><path d={ht.icon} /></svg
                    ></span
                  >
                  <span class="ht-label">{ht.label}</span>
                </button>
              {/each}
            </div>
          </div>

          <div class="setting-group">
            <label class="setting-label">Color Palettes</label>
            <div class="theme-grid">
              {#each THEMES.filter((t) => t.category === 'standard') as theme}
                <button
                  class="theme-option"
                  class:active={settingsStore.theme === theme.id}
                  onclick={() => settingsStore.setTheme(theme.id)}
                >
                  <div class="theme-preview" data-theme={theme.id}>
                    <div class="tp-bar"></div>
                    <div class="tp-body">
                      <div class="tp-sidebar"></div>
                      <div class="tp-main"></div>
                    </div>
                  </div>
                  <span>{theme.label}</span>
                </button>
              {/each}
            </div>
          </div>

          <!-- Custom imported themes -->
          {#if Object.keys(settingsStore.customThemes).length > 0}
            <div class="setting-group">
              <label class="setting-label">Imported Themes</label>
              <div class="theme-grid">
                {#each Object.entries(settingsStore.customThemes) as [id, ct]}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <!-- svelte-ignore a11y_click_events_have_key_events -->
                  <div
                    class="theme-option"
                    class:active={settingsStore.theme === id}
                    onclick={() => settingsStore.setTheme(id)}
                    role="button"
                    tabindex="0"
                  >
                    <div class="theme-swatch">
                      <div
                        class="swatch-half"
                        style="background: {ct.cssVars['--bg-primary'] || '#1e1e1e'}"
                      ></div>
                      <div
                        class="swatch-half"
                        style="background: {ct.cssVars['--accent-primary'] || '#007acc'}"
                      ></div>
                    </div>
                    <span>{ct.name}</span>
                    <button
                      class="delete-theme-btn"
                      onclick={(e) => {
                        e.stopPropagation();
                        settingsStore.deleteCustomTheme(id);
                      }}
                      title="Delete theme">x</button
                    >
                  </div>
                {/each}
              </div>
            </div>
          {/if}

          <div class="setting-group">
            <input
              type="file"
              accept=".json"
              style="display:none"
              bind:this={themeFileInput}
              onchange={handleThemeImport}
            />
            <button class="btn-secondary" onclick={() => themeFileInput.click()}>
              Import VS Code Theme
            </button>
          </div>

          <div class="setting-group">
            <label class="setting-label">Font Size Presets</label>
            <div class="font-size-presets">
              {#each [{ label: 'S', code: 12, ui: 12 }, { label: 'M', code: 14, ui: 14 }, { label: 'L', code: 16, ui: 16 }, { label: 'XL', code: 18, ui: 18 }, { label: '2XL', code: 20, ui: 20 }] as preset (preset.label)}
                <button
                  class="preset-btn"
                  class:active={settingsStore.fontSize === preset.code &&
                    settingsStore.effectiveUiFontSize === preset.ui}
                  onclick={() =>
                    settingsStore.update({
                      fontSize: preset.code,
                      uiFontSize: preset.ui === preset.code ? null : preset.ui,
                    })}>{preset.label}</button
                >
              {/each}
              <button
                class="preset-btn reset-btn"
                onclick={() => settingsStore.update({ fontSize: 14, uiFontSize: null })}
                title="Reset to defaults"
              >
                <svg
                  viewBox="0 0 24 24"
                  width="14"
                  height="14"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  ><path d="M3 12a9 9 0 1 1 3 6.75" /><polyline points="3 17 3 12 8 12" /></svg
                >
              </button>
            </div>
          </div>

          <div class="setting-group">
            <label class="setting-label">Code font size: {settingsStore.fontSize}px</label>
            <input
              type="range"
              min="10"
              max="28"
              value={settingsStore.fontSize}
              oninput={(e) =>
                settingsStore.update({ fontSize: Number((e.target as HTMLInputElement).value) })}
            />
            <div class="font-size-input-row">
              <button
                class="font-size-step"
                onclick={() =>
                  settingsStore.update({ fontSize: Math.max(10, settingsStore.fontSize - 1) })}
                >−</button
              >
              <input
                type="number"
                class="font-size-number"
                min="10"
                max="28"
                value={settingsStore.fontSize}
                onchange={(e) => {
                  const v = Math.min(
                    28,
                    Math.max(10, Number((e.target as HTMLInputElement).value)),
                  );
                  settingsStore.update({ fontSize: v });
                }}
              />
              <button
                class="font-size-step"
                onclick={() =>
                  settingsStore.update({ fontSize: Math.min(28, settingsStore.fontSize + 1) })}
                >+</button
              >
            </div>
          </div>

          <div class="setting-group">
            <label class="setting-label">
              UI font size: {settingsStore.effectiveUiFontSize}px
              {#if settingsStore.uiFontSize === null}<span class="setting-badge">linked</span>{/if}
            </label>
            <div class="ui-font-link">
              <label class="toggle" title="Link UI font size to code font size">
                <input
                  type="checkbox"
                  checked={settingsStore.uiFontSize === null}
                  onchange={() => {
                    if (settingsStore.uiFontSize === null) {
                      settingsStore.update({ uiFontSize: settingsStore.fontSize });
                    } else {
                      settingsStore.update({ uiFontSize: null });
                    }
                  }}
                />
                <span class="toggle-slider"></span>
              </label>
              <span class="setting-desc" style="margin:0">Follow code font size</span>
            </div>
            {#if settingsStore.uiFontSize !== null}
              <input
                type="range"
                min="10"
                max="28"
                value={settingsStore.uiFontSize}
                oninput={(e) =>
                  settingsStore.update({
                    uiFontSize: Number((e.target as HTMLInputElement).value),
                  })}
              />
              <div class="font-size-input-row">
                <button
                  class="font-size-step"
                  onclick={() =>
                    settingsStore.update({
                      uiFontSize: Math.max(
                        10,
                        (settingsStore.uiFontSize ?? settingsStore.fontSize) - 1,
                      ),
                    })}>−</button
                >
                <input
                  type="number"
                  class="font-size-number"
                  min="10"
                  max="28"
                  value={settingsStore.uiFontSize}
                  onchange={(e) => {
                    const v = Math.min(
                      28,
                      Math.max(10, Number((e.target as HTMLInputElement).value)),
                    );
                    settingsStore.update({ uiFontSize: v });
                  }}
                />
                <button
                  class="font-size-step"
                  onclick={() =>
                    settingsStore.update({
                      uiFontSize: Math.min(
                        28,
                        (settingsStore.uiFontSize ?? settingsStore.fontSize) + 1,
                      ),
                    })}>+</button
                >
              </div>
            {/if}
            <p class="setting-desc">
              Tip: Use <kbd>Ctrl</kbd>+<kbd>=</kbd> / <kbd>Ctrl</kbd>+<kbd>−</kbd> to adjust
              quickly, <kbd>Ctrl</kbd>+<kbd>0</kbd> to reset
            </p>
          </div>

          <div class="setting-group">
            <label class="setting-label">Code Font</label>
            <select
              class="font-select"
              value={settingsStore.fontFamily}
              onchange={(e) =>
                settingsStore.update({ fontFamily: (e.target as HTMLSelectElement).value })}
              style="font-family: {findFont(settingsStore.fontFamily)?.family || 'monospace'}"
            >
              {#each MONO_FONTS as font (font.id)}
                <option value={font.id}>{font.label}{!font.googleFont ? ' (local)' : ''}</option>
              {/each}
            </select>
            <div
              class="font-preview mono"
              style="font-family: {findFont(settingsStore.fontFamily)?.family || 'monospace'}"
            >
              const e = "Hello, World!"; // 0O1lI
            </div>
          </div>

          <div class="setting-group">
            <label class="setting-label">UI Font</label>
            <select
              class="font-select"
              value={settingsStore.fontFamilySans}
              onchange={(e) =>
                settingsStore.update({ fontFamilySans: (e.target as HTMLSelectElement).value })}
              style="font-family: {findFont(settingsStore.fontFamilySans)?.family || 'sans-serif'}"
            >
              {#each SANS_FONTS as font (font.id)}
                <option value={font.id}>{font.label}{!font.googleFont ? ' (local)' : ''}</option>
              {/each}
            </select>
            <div
              class="font-preview sans"
              style="font-family: {findFont(settingsStore.fontFamilySans)?.family || 'sans-serif'}"
            >
              The quick brown fox jumps over the lazy dog
            </div>
          </div>

          <div class="setting-group">
            <label class="setting-label">Compact messages</label>
            <label class="toggle">
              <input
                type="checkbox"
                checked={settingsStore.compactMessages}
                onchange={() =>
                  settingsStore.update({ compactMessages: !settingsStore.compactMessages })}
              />
              <span class="toggle-slider"></span>
            </label>
          </div>
          <div class="setting-group">
            <label class="setting-label">Auto-compact context</label>
            <label class="toggle">
              <input
                type="checkbox"
                checked={settingsStore.autoCompaction}
                onchange={() =>
                  settingsStore.update({ autoCompaction: !settingsStore.autoCompaction })}
              />
              <span class="toggle-slider"></span>
            </label>
            <p class="setting-desc">
              Automatically compact conversation history when context window usage exceeds threshold
            </p>
          </div>
          {#if settingsStore.autoCompaction}
            <div class="setting-group">
              <label class="setting-label"
                >Auto-compact threshold: {settingsStore.autoCompactionThreshold}%</label
              >
              <input
                type="range"
                min="70"
                max="95"
                step="5"
                value={settingsStore.autoCompactionThreshold}
                oninput={(e) =>
                  settingsStore.update({
                    autoCompactionThreshold: parseInt(e.currentTarget.value),
                  })}
                class="slider"
              />
              <p class="setting-desc">
                When context usage exceeds this percentage, older messages will be summarized
              </p>
            </div>
            <div class="setting-group">
              <label class="setting-label"
                >Keep recent messages: {settingsStore.compactionRetentionCount}</label
              >
              <input
                type="range"
                min="10"
                max="50"
                step="5"
                value={settingsStore.compactionRetentionCount}
                oninput={(e) =>
                  settingsStore.update({
                    compactionRetentionCount: parseInt(e.currentTarget.value),
                  })}
                class="slider"
              />
              <p class="setting-desc">
                Number of recent messages to preserve verbatim (older messages get summarized)
              </p>
            </div>
          {/if}
          <div class="setting-group">
            <label class="setting-label">Show budget in status bar</label>
            <label class="toggle">
              <input
                type="checkbox"
                checked={settingsStore.showBudgetDisplay}
                onchange={() =>
                  settingsStore.update({ showBudgetDisplay: !settingsStore.showBudgetDisplay })}
              />
              <span class="toggle-slider"></span>
            </label>
          </div>
          <div class="setting-group">
            <label class="setting-label">Startup tips</label>
            <label class="toggle">
              <input
                type="checkbox"
                checked={settingsStore.showStartupTips}
                onchange={() =>
                  settingsStore.update({ showStartupTips: !settingsStore.showStartupTips })}
              />
              <span class="toggle-slider"></span>
            </label>
            <p class="setting-desc">
              Show a rotating tip on each startup to help you discover features and shortcuts
            </p>
          </div>

          {#if settingsStore.visualStyle === 'study'}
            <div class="setting-group">
              <label class="setting-label">Snappy cursor</label>
              <label class="toggle">
                <input
                  type="checkbox"
                  checked={settingsStore.snappyCursor}
                  onchange={() =>
                    settingsStore.update({ snappyCursor: !settingsStore.snappyCursor })}
                />
                <span class="toggle-slider"></span>
              </label>
              <p class="setting-desc">
                Enable velocity prediction for the sparkle cursor (reduces jitter but makes cursor
                feel more responsive)
              </p>
            </div>
          {/if}

          <div class="setting-group">
            <label class="setting-label">Streaming Animations</label>
            <div class="streaming-options">
              <div class="streaming-option-row">
                <span class="streaming-option-label">Header indicator</span>
                <select
                  value={settingsStore.streamingIndicator}
                  onchange={(e) =>
                    settingsStore.update({
                      streamingIndicator: (e.target as HTMLSelectElement).value as any,
                    })}
                >
                  <option value="dots">Dots</option>
                  <option value="spinner">Spinner</option>
                  <option value="pulse">Pulse</option>
                  <option value="none">None</option>
                </select>
              </div>
              <div class="streaming-option-row">
                <span class="streaming-option-label">Progress bar</span>
                <select
                  value={settingsStore.streamingProgressBar}
                  onchange={(e) =>
                    settingsStore.update({
                      streamingProgressBar: (e.target as HTMLSelectElement).value as any,
                    })}
                >
                  <option value="rainbow">Rainbow</option>
                  <option value="accent">Accent</option>
                  <option value="pulse">Pulse</option>
                  <option value="neon">Neon</option>
                  <option value="cylon">Cylon</option>
                  <option value="matrix">Matrix</option>
                  <option value="comet">Comet</option>
                  <option value="helix">Helix</option>
                  <option value="fire">Fire</option>
                  <option value="ocean">Ocean</option>
                  <option value="electric">Electric</option>
                  <option value="candy">Candy</option>
                  <option value="vapor">Vapor</option>
                  <option value="none">None</option>
                </select>
              </div>
              <div class="streaming-option-row">
                <span class="streaming-option-label">Text cursor</span>
                <select
                  value={settingsStore.streamingCursor}
                  onchange={(e) =>
                    settingsStore.update({
                      streamingCursor: (e.target as HTMLSelectElement).value as any,
                    })}
                >
                  <option value="block">Block &#x258A;</option>
                  <option value="line">Line |</option>
                  <option value="underscore">Underscore _</option>
                  <option value="none">None</option>
                </select>
              </div>
            </div>
          </div>
        {:else if activeTab === 'audio'}
          <div class="setting-group">
            <label class="setting-label">Sound effects</label>
            <div class="audio-toggle-row">
              <label class="toggle">
                <input
                  type="checkbox"
                  checked={settingsStore.soundEnabled}
                  onchange={() =>
                    settingsStore.update({ soundEnabled: !settingsStore.soundEnabled })}
                />
                <span class="toggle-slider"></span>
              </label>
              <span class="audio-toggle-label">
                {settingsStore.soundEnabled ? 'Enabled' : 'Disabled'}
              </span>
            </div>
            <p class="setting-desc">Generative audio chirps for each stream event type</p>
          </div>

          <div class="setting-group" class:muted={!settingsStore.soundEnabled}>
            <label class="setting-label">
              Volume — {settingsStore.soundVolume}%
            </label>
            <div class="volume-row">
              <span class="volume-icon"
                ><svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  ><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /></svg
                ></span
              >
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={settingsStore.soundVolume}
                disabled={!settingsStore.soundEnabled}
                oninput={(e) =>
                  settingsStore.update({
                    soundVolume: Number((e.target as HTMLInputElement).value),
                  })}
              />
              <span class="volume-icon"
                ><svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  ><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path
                    d="M19.07 4.93a10 10 0 0 1 0 14.14"
                  /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /></svg
                ></span
              >
            </div>
          </div>

          <div class="setting-group" class:muted={!settingsStore.soundEnabled}>
            <label class="setting-label">Sound style</label>
            <div class="sound-style-row">
              {#each [{ value: 'melodic', label: 'Melodic', desc: 'Warm additive synthesis — marimba, vibraphone, bells' }, { value: 'classic', label: 'Classic', desc: 'Original oscillator chirps — the vintage E sound' }, { value: 'whimsy', label: 'Whimsy', desc: 'Music box, toy piano, kalimba & rubber-duck squeaks' }, { value: 'forest', label: 'Forest', desc: 'Woodland flutes, owl hoots, raindrops & fairy sparkles' }, { value: 'wind-chime', label: 'Wind Chime', desc: 'Shimmering tubes, crystal tinkles, bamboo knocks & bell chimes' }] as opt}
                <button
                  class="sound-style-btn"
                  class:active={settingsStore.soundStyle === opt.value}
                  disabled={!settingsStore.soundEnabled}
                  onclick={() =>
                    settingsStore.update({
                      soundStyle: opt.value as
                        | 'classic'
                        | 'melodic'
                        | 'whimsy'
                        | 'forest'
                        | 'wind-chime',
                    })}
                >
                  <span class="sound-style-name">{opt.label}</span>
                  <span class="sound-style-desc">{opt.desc}</span>
                </button>
              {/each}
            </div>
          </div>

          <div class="setting-group">
            <label class="setting-label">Desktop notifications</label>
            <p class="setting-desc">
              OS-level notifications when events occur while this tab is in the background.
              {#if desktopNotifications.isSupported}
                {#if desktopNotifications.permission === 'granted'}
                  <span class="notify-status granted">Permitted</span>
                {:else if desktopNotifications.permission === 'denied'}
                  <span class="notify-status denied">Blocked — enable in browser settings</span>
                {:else}
                  <button
                    class="btn-secondary notify-request-btn"
                    onclick={async () => {
                      const result = await desktopNotifications.requestPermission();
                      if (result === 'granted') {
                        uiStore.toast('Desktop notifications enabled', 'success');
                      } else if (result === 'denied') {
                        uiStore.toast('Notifications blocked by browser', 'error');
                      }
                    }}>Enable notifications</button
                  >
                {/if}
              {:else}
                <span class="notify-status denied">Not supported in this browser</span>
              {/if}
            </p>
            <div class="notify-options">
              <div class="notify-option-row">
                <span class="notify-option-label">On completion</span>
                <label class="toggle">
                  <input
                    type="checkbox"
                    checked={settingsStore.notifyOnCompletion}
                    onchange={() =>
                      settingsStore.update({
                        notifyOnCompletion: !settingsStore.notifyOnCompletion,
                      })}
                  />
                  <span class="toggle-slider"></span>
                </label>
              </div>
              <div class="notify-option-row">
                <span class="notify-option-label">On failure</span>
                <label class="toggle">
                  <input
                    type="checkbox"
                    checked={settingsStore.notifyOnFailure}
                    onchange={() =>
                      settingsStore.update({ notifyOnFailure: !settingsStore.notifyOnFailure })}
                  />
                  <span class="toggle-slider"></span>
                </label>
              </div>
              <div class="notify-option-row">
                <span class="notify-option-label">On approval needed</span>
                <label class="toggle">
                  <input
                    type="checkbox"
                    checked={settingsStore.notifyOnApproval}
                    onchange={() =>
                      settingsStore.update({ notifyOnApproval: !settingsStore.notifyOnApproval })}
                  />
                  <span class="toggle-slider"></span>
                </label>
              </div>
            </div>
          </div>

          <div class="setting-group" class:muted={!settingsStore.soundEnabled}>
            <label class="setting-label">Event sounds</label>
            <div class="chirp-legend">
              {#each [{ event: 'Response start', desc: 'Ascending tone when Claude begins responding' }, { event: 'Text block', desc: 'Soft click as a new text block opens' }, { event: 'Streaming text', desc: 'Gentle trickle while text flows (throttled)' }, { event: 'Thinking', desc: 'Low hum when extended thinking begins' }, { event: 'Tool call', desc: 'Mechanical blip on each tool invocation' }, { event: 'Tool success', desc: 'Bright major-third chord on completion' }, { event: 'Tool error', desc: 'Descending sawtooth on tool failure' }, { event: 'Approval needed', desc: 'Sustained chime awaiting your approval' }, { event: 'Question asked', desc: 'Three-note rising arpeggio with upward lilt — the classic "huh?" contour' }, { event: 'Response done', desc: 'Resolved interval when the response completes' }, { event: 'Error', desc: 'Warning buzz on stream error' }, { event: 'Cancelled', desc: 'Soft fade when you stop the response' }] as row}
                <div class="chirp-row">
                  <span class="chirp-event">{row.event}</span>
                  <span class="chirp-desc">{row.desc}</span>
                </div>
              {/each}
            </div>
          </div>

          <!-- Voice Mode Settings -->
          <div class="setting-group">
            <label class="setting-label">Voice Mode</label>
            <p class="setting-desc">
              Bidirectional voice interaction — speak to E and hear responses aloud
            </p>
            <div class="voice-mode-options">
              {#each [{ value: 'disabled', label: 'Disabled', desc: 'No voice input' }, { value: 'push-to-talk', label: 'Push to Talk', desc: 'Hold Space to speak' }, { value: 'always-on', label: 'Always On', desc: 'Continuous listening with wake word' }] as opt}
                <label
                  class="voice-mode-option"
                  class:active={settingsStore.voiceMode === opt.value}
                >
                  <input
                    type="radio"
                    name="voiceMode"
                    value={opt.value}
                    checked={settingsStore.voiceMode === opt.value}
                    onchange={() => settingsStore.update({ voiceMode: opt.value as any })}
                  />
                  <div class="voice-mode-content">
                    <span class="voice-mode-name">{opt.label}</span>
                    <span class="voice-mode-desc">{opt.desc}</span>
                  </div>
                </label>
              {/each}
            </div>
          </div>

          {#if settingsStore.voiceMode !== 'disabled'}
            <div class="setting-group">
              <label class="setting-label">Voice Input Provider</label>
              <p class="setting-desc">Choose the speech recognition engine</p>
              <select
                class="select"
                value={settingsStore.voiceInputProvider}
                onchange={(e) =>
                  settingsStore.update({
                    voiceInputProvider: (e.target as HTMLSelectElement).value as
                      | 'browser'
                      | 'whisper',
                  })}
              >
                <option value="browser">Browser (Web Speech API)</option>
                <option value="whisper">Whisper API (requires API key)</option>
              </select>
            </div>

            {#if settingsStore.voiceMode === 'always-on'}
              <div class="setting-group">
                <label class="setting-label">Wake Word</label>
                <p class="setting-desc">Phrase to activate voice input in always-on mode</p>
                <input
                  type="text"
                  class="text-input"
                  value={settingsStore.voiceWakeWord}
                  oninput={(e) =>
                    settingsStore.update({
                      voiceWakeWord: (e.target as HTMLInputElement).value,
                    })}
                  placeholder="Hey E"
                />
              </div>
            {/if}

            <div class="setting-group">
              <label class="setting-label">Voice Language</label>
              <p class="setting-desc">Language for speech recognition</p>
              <select
                class="select"
                value={settingsStore.voiceLanguage}
                onchange={(e) =>
                  settingsStore.update({
                    voiceLanguage: (e.target as HTMLSelectElement).value,
                  })}
              >
                <option value="en-US">English (US)</option>
                <option value="en-GB">English (UK)</option>
                <option value="en-AU">English (Australia)</option>
                <option value="es-ES">Spanish</option>
                <option value="fr-FR">French</option>
                <option value="de-DE">German</option>
                <option value="it-IT">Italian</option>
                <option value="pt-BR">Portuguese (Brazil)</option>
                <option value="ja-JP">Japanese</option>
                <option value="zh-CN">Chinese (Simplified)</option>
                <option value="ko-KR">Korean</option>
              </select>
            </div>

            <div class="setting-group">
              <label class="toggle-label">
                <label class="toggle">
                  <input
                    type="checkbox"
                    checked={settingsStore.voiceAutoSpeak}
                    onchange={() =>
                      settingsStore.update({ voiceAutoSpeak: !settingsStore.voiceAutoSpeak })}
                  />
                  <span class="toggle-slider"></span>
                </label>
                <div>
                  <span class="toggle-label-text">Auto-speak responses</span>
                  <p class="setting-hint">Read agent responses aloud using text-to-speech</p>
                </div>
              </label>
            </div>
          {/if}
        {:else if activeTab === 'commentary'}
          <div class="setting-group">
            <label class="setting-label">AI Commentary</label>
            <p class="setting-desc">
              Live AI-generated commentary on your coding sessions. An AI personality watches stream
              events and provides entertaining or insightful narration.
            </p>
            {#if !workspaceStore.activeWorkspaceId}
              <p class="commentary-no-workspace">
                Open a workspace to configure commentary settings.
              </p>
            {:else}
              <div class="audio-toggle-row">
                <label class="toggle">
                  <input
                    type="checkbox"
                    checked={commentaryEnabled}
                    disabled={commentaryLoading}
                    onchange={() => {
                      commentaryEnabled = !commentaryEnabled;
                      saveCommentarySetting({ enabled: commentaryEnabled });
                    }}
                  />
                  <span class="toggle-slider"></span>
                </label>
                <span class="audio-toggle-label">
                  {commentaryEnabled ? 'Enabled' : 'Disabled'}
                </span>
              </div>
            {/if}
          </div>

          {#if workspaceStore.activeWorkspaceId}
            <div class="setting-group" class:muted={!commentaryEnabled}>
              <label class="setting-label">Personality</label>
              <p class="setting-hint">Choose the style and tone of your AI commentator</p>
              <div class="commentary-personality-grid">
                {#each commentaryPersonalities as p}
                  <button
                    class="commentary-personality-option"
                    class:active={commentaryPersonality === p.id}
                    disabled={!commentaryEnabled}
                    onclick={() => {
                      commentaryPersonality = p.id;
                      saveCommentarySetting({ personality: p.id });
                    }}
                  >
                    <span class="commentary-personality-name">{p.label}</span>
                    <span class="commentary-personality-desc">{p.description}</span>
                  </button>
                {/each}
              </div>
            </div>

            <div class="setting-group" class:muted={!commentaryEnabled}>
              <label class="setting-label">Verbosity</label>
              <p class="setting-hint">How often the commentator chimes in</p>
              <div class="commentary-verbosity-options">
                {#each verbosityOptions as opt}
                  <label
                    class="commentary-verbosity-option"
                    class:active={commentaryVerbosity === opt.value}
                  >
                    <input
                      type="radio"
                      name="commentary-verbosity"
                      value={opt.value}
                      checked={commentaryVerbosity === opt.value}
                      disabled={!commentaryEnabled}
                      onchange={() => {
                        commentaryVerbosity = opt.value;
                        saveCommentarySetting({ verbosity: opt.value });
                      }}
                    />
                    <div class="commentary-verbosity-content">
                      <span class="commentary-verbosity-label">{opt.label}</span>
                      <span class="commentary-verbosity-desc">{opt.description}</span>
                    </div>
                  </label>
                {/each}
              </div>
            </div>

            <div class="setting-group" class:muted={!commentaryEnabled}>
              <label class="setting-label">Preview</label>
              <p class="setting-hint">
                Test what commentary sounds like with the selected personality
              </p>
              <button
                class="btn-secondary commentary-preview-btn"
                disabled={!commentaryEnabled || commentaryPreviewLoading}
                onclick={previewCommentary}
              >
                {commentaryPreviewLoading ? 'Generating...' : 'Preview Commentary'}
              </button>
              {#if commentaryPreviewText}
                <div class="commentary-preview-box">
                  <div class="commentary-preview-header">
                    <span class="commentary-preview-personality">
                      {commentaryPersonalities.find((p) => p.id === commentaryPersonality)?.label ??
                        commentaryPersonality}
                    </span>
                  </div>
                  <p class="commentary-preview-text">{commentaryPreviewText}</p>
                </div>
              {/if}
            </div>

            <div class="setting-group">
              <label class="setting-label">History &amp; Privacy</label>
              <p class="setting-hint">
                Store commentary history in the database so you can review past narrations
              </p>
              <div class="audio-toggle-row">
                <label class="toggle">
                  <input
                    type="checkbox"
                    checked={commentaryHistoryEnabled}
                    disabled={commentaryLoading}
                    onchange={async () => {
                      commentaryHistoryEnabled = !commentaryHistoryEnabled;
                      const wsId = workspaceStore.activeWorkspaceId;
                      if (wsId) {
                        try {
                          await api.workspaces.update(wsId, {
                            settings: { commentaryHistoryEnabled },
                          });
                          uiStore.toast(
                            commentaryHistoryEnabled
                              ? 'Commentary history enabled'
                              : 'Commentary history disabled — new commentary will not be stored',
                            'info',
                          );
                        } catch {
                          uiStore.toast('Failed to save history setting', 'error');
                        }
                      }
                    }}
                  />
                  <span class="toggle-slider"></span>
                </label>
                <span class="audio-toggle-label">
                  {commentaryHistoryEnabled ? 'Store history' : 'History disabled (privacy mode)'}
                </span>
              </div>
              <p class="setting-hint" style="margin-top: 4px;">
                {#if commentaryHistoryEnabled}
                  Commentary will be saved and can be reviewed in the Commentary panel timeline.
                {:else}
                  Commentary is ephemeral — it will only appear in the live feed and won't be
                  persisted.
                {/if}
              </p>
            </div>

            <div class="setting-group" class:muted={!commentaryEnabled}>
              <label class="setting-label">
                Spatial Audio
                <span class="experimental-badge">Experimental</span>
              </label>
              <p class="setting-hint">
                When monitoring 3+ workspaces, position each commentator's audio in stereo space
                (left / center / right) so you can distinguish them by ear. Cloud TTS providers
                (ElevenLabs, Google) get true stereo panning; browser TTS uses subtle pitch/rate
                variations as a perceptual substitute.
              </p>
              <div class="audio-toggle-row">
                <label class="toggle">
                  <input
                    type="checkbox"
                    checked={commentarySpatialAudioEnabled}
                    disabled={!commentaryEnabled || commentaryLoading}
                    onchange={async () => {
                      commentarySpatialAudioEnabled = !commentarySpatialAudioEnabled;
                      const wsId = workspaceStore.activeWorkspaceId;
                      if (wsId) {
                        try {
                          await api.workspaces.update(wsId, {
                            settings: { commentarySpatialAudioEnabled },
                          });
                          uiStore.toast(
                            commentarySpatialAudioEnabled
                              ? 'Spatial audio enabled — workspaces will be positioned L/C/R'
                              : 'Spatial audio disabled',
                            'info',
                          );
                        } catch {
                          uiStore.toast('Failed to save spatial audio setting', 'error');
                        }
                      }
                    }}
                  />
                  <span class="toggle-slider"></span>
                </label>
                <span class="audio-toggle-label">
                  {commentarySpatialAudioEnabled
                    ? 'Spatial positioning on'
                    : 'Spatial positioning off'}
                </span>
              </div>
            </div>
          {/if}
        {:else if activeTab === 'editor'}
          <div class="setting-group">
            <label class="setting-label">Import VS Code Snippets</label>
            <p class="setting-desc">Import snippet JSON files from VS Code to use in the editor.</p>
            <div class="snippet-import-row">
              <select bind:value={snippetLanguage}>
                {#each supportedLanguages as lang}
                  <option value={lang}>{lang}</option>
                {/each}
              </select>
              <input
                type="file"
                accept=".json"
                style="display:none"
                bind:this={snippetFileInput}
                onchange={handleSnippetImport}
              />
              <button class="btn-secondary" onclick={() => snippetFileInput.click()}>
                Import Snippets
              </button>
            </div>
          </div>

          {#if Object.keys(settingsStore.customSnippets).length > 0}
            <div class="setting-group">
              <label class="setting-label">Imported Snippets</label>
              <div class="snippet-list">
                {#each Object.entries(settingsStore.customSnippets) as [lang, snippets]}
                  <div class="snippet-row">
                    <span class="snippet-lang">{lang}</span>
                    <span class="snippet-count"
                      >{snippets.length} snippet{snippets.length !== 1 ? 's' : ''}</span
                    >
                    <button class="btn-danger-sm" onclick={() => settingsStore.clearSnippets(lang)}>
                      Clear
                    </button>
                  </div>
                {/each}
              </div>
            </div>
          {/if}
        {:else if activeTab === 'terminal'}
          <!-- Font Family -->
          <div class="setting-group">
            <label class="setting-label">Font family</label>
            <p class="setting-desc">Monospace font used in terminal panes</p>
            <input
              type="text"
              class="setting-text-input"
              value={settingsStore.termFontFamily}
              oninput={(e) =>
                settingsStore.update({ termFontFamily: (e.target as HTMLInputElement).value })}
            />
          </div>

          <!-- Font Size -->
          <div class="setting-group">
            <label class="setting-label">Font size — {settingsStore.termFontSize}px</label>
            <p class="setting-desc">Terminal text size (9-24)</p>
            <input
              type="range"
              min="9"
              max="24"
              step="1"
              value={settingsStore.termFontSize}
              oninput={(e) =>
                settingsStore.update({
                  termFontSize: Number((e.target as HTMLInputElement).value),
                })}
            />
          </div>

          <!-- Cursor Style -->
          <div class="setting-group">
            <label class="setting-label">Cursor style</label>
            <select
              value={settingsStore.termCursorStyle}
              onchange={(e) =>
                settingsStore.update({
                  termCursorStyle: (e.target as HTMLSelectElement).value as
                    | 'block'
                    | 'underline'
                    | 'bar',
                })}
            >
              <option value="block">Block</option>
              <option value="underline">Underline</option>
              <option value="bar">Bar</option>
            </select>
          </div>

          <!-- Cursor Blink -->
          <div class="setting-group">
            <label class="setting-label">Cursor blink</label>
            <label class="toggle">
              <input
                type="checkbox"
                checked={settingsStore.termCursorBlink}
                onchange={() =>
                  settingsStore.update({ termCursorBlink: !settingsStore.termCursorBlink })}
              />
              <span class="toggle-slider"></span>
            </label>
          </div>

          <!-- Scrollback Lines -->
          <div class="setting-group">
            <label class="setting-label"
              >Scrollback lines — {settingsStore.termScrollback.toLocaleString()}</label
            >
            <p class="setting-desc">Number of lines retained in terminal history (1,000-100,000)</p>
            <input
              type="range"
              min="1000"
              max="100000"
              step="1000"
              value={settingsStore.termScrollback}
              oninput={(e) =>
                settingsStore.update({
                  termScrollback: Number((e.target as HTMLInputElement).value),
                })}
            />
          </div>

          <!-- Bell Style -->
          <div class="setting-group">
            <label class="setting-label">Bell style</label>
            <select
              value={settingsStore.termBellStyle}
              onchange={(e) =>
                settingsStore.update({
                  termBellStyle: (e.target as HTMLSelectElement).value as
                    | 'none'
                    | 'visual'
                    | 'audio'
                    | 'both',
                })}
            >
              <option value="none">None</option>
              <option value="visual">Visual</option>
              <option value="audio">Audio</option>
              <option value="both">Both</option>
            </select>
          </div>

          <!-- Copy on Select -->
          <div class="setting-group">
            <label class="setting-label">Copy on select</label>
            <p class="setting-desc">Automatically copy selected text to clipboard</p>
            <label class="toggle">
              <input
                type="checkbox"
                checked={settingsStore.termCopyOnSelect}
                onchange={() =>
                  settingsStore.update({ termCopyOnSelect: !settingsStore.termCopyOnSelect })}
              />
              <span class="toggle-slider"></span>
            </label>
          </div>

          <!-- Default Shell -->
          <div class="setting-group">
            <label class="setting-label">Default shell</label>
            <p class="setting-desc">Shell used when opening new terminal tabs</p>
            {#if shellsLoading}
              <select disabled><option>Loading shells...</option></select>
            {:else}
              <select
                value={settingsStore.termDefaultShell}
                onchange={(e) =>
                  settingsStore.update({ termDefaultShell: (e.target as HTMLSelectElement).value })}
              >
                <option value="">System default</option>
                {#each detectedShells as shell}
                  <option value={shell.path}
                    >{shell.name}{shell.version ? ` (${shell.version})` : ''}</option
                  >
                {/each}
              </select>
            {/if}
          </div>

          <!-- Shell Integration -->
          <div class="setting-group">
            <label class="setting-label">Shell integration</label>
            <p class="setting-desc">Enable CWD tracking and command boundary detection</p>
            <label class="toggle">
              <input
                type="checkbox"
                checked={settingsStore.termEnableShellIntegration}
                onchange={() =>
                  settingsStore.update({
                    termEnableShellIntegration: !settingsStore.termEnableShellIntegration,
                  })}
              />
              <span class="toggle-slider"></span>
            </label>
          </div>

          <!-- Inline Images -->
          <div class="setting-group">
            <label class="setting-label">Inline images</label>
            <p class="setting-desc">
              Render images inline via iTerm2 and Sixel protocols (for imgcat, viu, timg,
              matplotlib)
            </p>
            <label class="toggle">
              <input
                type="checkbox"
                checked={settingsStore.termEnableImages}
                onchange={() =>
                  settingsStore.update({ termEnableImages: !settingsStore.termEnableImages })}
              />
              <span class="toggle-slider"></span>
            </label>
          </div>

          {#if settingsStore.termEnableImages}
            <!-- Image Max Dimensions -->
            <div class="setting-group">
              <label class="setting-label"
                >Max image dimensions — {settingsStore.termImageMaxWidth} &times; {settingsStore.termImageMaxHeight}px</label
              >
              <p class="setting-desc">Maximum width and height for rendered images</p>
              <div class="image-dimension-row">
                <label class="image-dim-label">
                  Width
                  <input
                    type="range"
                    min="200"
                    max="4000"
                    step="100"
                    value={settingsStore.termImageMaxWidth}
                    oninput={(e) =>
                      settingsStore.update({
                        termImageMaxWidth: Number((e.target as HTMLInputElement).value),
                      })}
                  />
                </label>
                <label class="image-dim-label">
                  Height
                  <input
                    type="range"
                    min="200"
                    max="4000"
                    step="100"
                    value={settingsStore.termImageMaxHeight}
                    oninput={(e) =>
                      settingsStore.update({
                        termImageMaxHeight: Number((e.target as HTMLInputElement).value),
                      })}
                  />
                </label>
              </div>
            </div>

            <!-- Image Storage Limit -->
            <div class="setting-group">
              <label class="setting-label"
                >Image cache limit — {settingsStore.termImageStorageLimit} MB</label
              >
              <p class="setting-desc">
                Maximum memory for cached images (older images are evicted when exceeded)
              </p>
              <input
                type="range"
                min="16"
                max="256"
                step="16"
                value={settingsStore.termImageStorageLimit}
                oninput={(e) =>
                  settingsStore.update({
                    termImageStorageLimit: Number((e.target as HTMLInputElement).value),
                  })}
              />
            </div>
          {/if}

          <!-- Agent Terminal Integration -->
          <div class="setting-group">
            <label class="setting-label">Agent terminal</label>
            <p class="setting-desc">
              Show AI tool execution (Bash commands) in a dedicated read-only terminal tab
            </p>
            <label class="toggle">
              <input
                type="checkbox"
                checked={settingsStore.agentTerminalEnabled}
                onchange={() =>
                  settingsStore.update({
                    agentTerminalEnabled: !settingsStore.agentTerminalEnabled,
                  })}
              />
              <span class="toggle-slider"></span>
            </label>
          </div>

          <!-- ─── Terminal Profiles ─── -->
          <div class="setting-group">
            <label class="setting-label">Terminal profiles</label>
            <p class="setting-desc">Named configurations for quick terminal creation</p>

            <!-- Auto-detected profiles (read-only) -->
            {#if detectedShells.length > 0}
              <div class="term-profiles-section">
                <div class="term-profiles-section-label">Detected Shells</div>
                {#each detectedShells as shell}
                  {@const autoId = `auto-${shell.name.toLowerCase()}`}
                  {@const isDefault = settingsStore.termDefaultProfileId === autoId}
                  <div class="term-profile-row">
                    <svg
                      class="term-profile-icon"
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                    >
                      <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
                    </svg>
                    <div class="term-profile-info">
                      <span class="term-profile-name"
                        >{shell.name}{shell.version ? ` (${shell.version})` : ''}</span
                      >
                      <span class="term-profile-path">{shell.path}</span>
                    </div>
                    <div class="term-profile-actions">
                      <button
                        class="term-profile-action-btn"
                        class:is-default={isDefault}
                        title={isDefault ? 'Remove as default' : 'Set as default'}
                        onclick={() => setTermDefaultProfile(autoId)}
                      >
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill={isDefault ? 'currentColor' : 'none'}
                          stroke="currentColor"
                          stroke-width="2"
                        >
                          <polygon
                            points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
                          />
                        </svg>
                      </button>
                      <span class="term-profile-badge read-only">auto</span>
                    </div>
                  </div>
                {/each}
              </div>
            {/if}

            <!-- Custom profiles -->
            <div class="term-profiles-section">
              <div class="term-profiles-section-label">Custom Profiles</div>
              {#if settingsStore.terminalProfiles.length === 0 && !termProfileEditing}
                <p class="setting-desc" style="margin: 4px 0 8px; font-style: italic;">
                  No custom profiles yet
                </p>
              {/if}
              {#each settingsStore.terminalProfiles as tp (tp.id)}
                {@const isDefault = settingsStore.termDefaultProfileId === tp.id}
                <div class="term-profile-row">
                  <svg
                    class="term-profile-icon"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    {#if tp.icon === 'code'}
                      <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
                    {:else if tp.icon === 'server'}
                      <rect x="2" y="2" width="20" height="8" rx="2" /><rect
                        x="2"
                        y="14"
                        width="20"
                        height="8"
                        rx="2"
                      /><circle cx="6" cy="6" r="1" fill="currentColor" /><circle
                        cx="6"
                        cy="18"
                        r="1"
                        fill="currentColor"
                      />
                    {:else}
                      <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
                    {/if}
                  </svg>
                  <div class="term-profile-info">
                    <span class="term-profile-name">{tp.name}</span>
                    <span class="term-profile-path"
                      >{tp.shellPath}{tp.args?.length ? ' ' + tp.args.join(' ') : ''}</span
                    >
                  </div>
                  <div class="term-profile-actions">
                    <button
                      class="term-profile-action-btn"
                      class:is-default={isDefault}
                      title={isDefault ? 'Remove as default' : 'Set as default'}
                      onclick={() => setTermDefaultProfile(tp.id)}
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill={isDefault ? 'currentColor' : 'none'}
                        stroke="currentColor"
                        stroke-width="2"
                      >
                        <polygon
                          points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
                        />
                      </svg>
                    </button>
                    <button
                      class="term-profile-action-btn"
                      title="Edit profile"
                      onclick={() => startEditTermProfile(tp.id)}
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                      >
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path
                          d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"
                        />
                      </svg>
                    </button>
                    <button
                      class="term-profile-action-btn danger"
                      title="Delete profile"
                      onclick={() => deleteTermProfile(tp.id)}
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                      >
                        <polyline points="3 6 5 6 21 6" /><path
                          d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
                        />
                      </svg>
                    </button>
                  </div>
                </div>
              {/each}

              {#if !termProfileEditing}
                <button class="btn-secondary term-profile-add-btn" onclick={startNewTermProfile}>
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  Add Profile
                </button>
              {/if}
            </div>

            <!-- Profile editor form -->
            {#if termProfileEditing}
              <div class="term-profile-editor">
                <div class="term-profile-editor-title">
                  {termProfileEditId ? 'Edit' : 'New'} Profile
                </div>
                <div class="term-profile-field">
                  <label class="term-profile-field-label">Name</label>
                  <input
                    type="text"
                    class="setting-text-input"
                    placeholder="My Profile"
                    bind:value={termProfileName}
                  />
                </div>
                <div class="term-profile-field">
                  <label class="term-profile-field-label">Shell path</label>
                  <input
                    type="text"
                    class="setting-text-input"
                    placeholder="/bin/bash"
                    bind:value={termProfileShellPath}
                  />
                </div>
                <div class="term-profile-field">
                  <label class="term-profile-field-label">Arguments</label>
                  <input
                    type="text"
                    class="setting-text-input"
                    placeholder="--login"
                    bind:value={termProfileArgs}
                  />
                  <span class="term-profile-field-hint">Space-separated shell arguments</span>
                </div>
                <div class="term-profile-field">
                  <label class="term-profile-field-label">Environment variables</label>
                  <textarea
                    class="setting-textarea"
                    placeholder={'KEY=value\nANOTHER=value'}
                    rows="3"
                    bind:value={termProfileEnvText}
                  ></textarea>
                  <span class="term-profile-field-hint">One per line: KEY=value</span>
                </div>
                <div class="term-profile-field">
                  <label class="term-profile-field-label">Working directory</label>
                  <input
                    type="text"
                    class="setting-text-input"
                    placeholder="(uses workspace default)"
                    bind:value={termProfileCwd}
                  />
                </div>
                <div class="term-profile-field">
                  <label class="term-profile-field-label">Icon</label>
                  <select bind:value={termProfileIcon}>
                    <option value="terminal">Terminal</option>
                    <option value="code">Code</option>
                    <option value="server">Server</option>
                  </select>
                </div>
                <div class="term-profile-editor-actions">
                  <button class="btn-secondary" onclick={cancelTermProfileEdit}>Cancel</button>
                  <button
                    class="btn-primary"
                    onclick={saveTermProfile}
                    disabled={!termProfileName.trim() || !termProfileShellPath.trim()}
                  >
                    {termProfileEditId ? 'Save' : 'Create'}
                  </button>
                </div>
              </div>
            {/if}

            <!-- Default profile selector -->
            <div class="term-profiles-section" style="margin-top: 12px;">
              <div class="term-profiles-section-label">Default Profile</div>
              <p class="setting-desc">
                Profile used when opening new terminal tabs with no specific selection
              </p>
              <select
                value={settingsStore.termDefaultProfileId}
                onchange={(e) =>
                  settingsStore.setDefaultProfileId((e.target as HTMLSelectElement).value)}
              >
                <option value="">System default shell</option>
                {#each detectedShells as shell}
                  <option value={`auto-${shell.name.toLowerCase()}`}
                    >{shell.name}{shell.version ? ` (${shell.version})` : ''}</option
                  >
                {/each}
                {#each settingsStore.terminalProfiles as tp2}
                  <option value={tp2.id}>{tp2.name}</option>
                {/each}
              </select>
            </div>
          </div>
        {:else if activeTab === 'permissions'}
          <div class="setting-group">
            <label class="setting-label">Permission mode</label>
            <div class="perm-options">
              {#each permModes as mode}
                <button
                  class="perm-option"
                  class:active={settingsStore.permissionMode === mode.id}
                  onclick={() => settingsStore.setPermissionMode(mode.id as any)}
                >
                  <span class="perm-name">{mode.label}</span>
                  <span class="perm-desc">{mode.desc}</span>
                </button>
              {/each}
            </div>
          </div>

          <!-- Terminal Command Policy -->
          <div class="setting-group">
            <label class="setting-label">Terminal command policy</label>
            <p class="setting-desc">Independent control for Bash/terminal tool execution</p>
            <div class="perm-options terminal-policy-options">
              {#each terminalPolicies as pol}
                <button
                  class="perm-option terminal-policy-option"
                  class:active={settingsStore.terminalCommandPolicy === pol.id}
                  onclick={() => settingsStore.setTerminalCommandPolicy(pol.id)}
                >
                  <span class="perm-name">{pol.label}</span>
                  <span class="perm-desc">{pol.desc}</span>
                </button>
              {/each}
            </div>
          </div>

          <!-- Permission Rules Editor -->
          <div class="setting-group">
            <label class="setting-label">Permission rules</label>
            <p class="setting-desc">
              Fine-grained allow/deny/ask rules per tool. Rules override the general permission
              mode.
            </p>

            <!-- Scope selector -->
            <div class="perm-scope-row">
              {#each [{ id: 'global', label: 'Global' }, { id: 'project', label: 'Project' }, { id: 'session', label: 'Session' }] as s}
                <button
                  class="perm-scope-btn"
                  class:active={permRulesScope === s.id}
                  onclick={() => {
                    permRulesScope = s.id as any;
                    loadPermissionRules();
                  }}
                >
                  {s.label}
                </button>
              {/each}
            </div>

            <!-- Presets -->
            <div class="perm-presets-row">
              <span class="perm-presets-label">Presets:</span>
              {#each PERMISSION_PRESETS as preset}
                <button
                  class="perm-preset-btn"
                  title={preset.description}
                  onclick={() => applyPreset(preset.id)}
                >
                  {preset.name}
                </button>
              {/each}
            </div>

            <!-- Add rule form -->
            <div class="perm-add-rule">
              <select class="perm-rule-select" bind:value={newRuleType}>
                <option value="allow">Allow</option>
                <option value="deny">Deny</option>
                <option value="ask">Ask</option>
              </select>
              <select class="perm-rule-select perm-tool-select" bind:value={newRuleTool}>
                <option value="" disabled>Tool...</option>
                {#each builtinToolNames as t}
                  <option value={t}>{t === '*' ? '* (all)' : t}</option>
                {/each}
              </select>
              <input
                type="text"
                class="perm-pattern-input"
                placeholder="Pattern (optional, e.g. rm -rf *)"
                bind:value={newRulePattern}
                onkeydown={(e) => {
                  if (e.key === 'Enter') addPermissionRule();
                }}
              />
              <button
                class="btn-secondary perm-add-btn"
                onclick={addPermissionRule}
                disabled={!newRuleTool.trim()}
              >
                Add
              </button>
            </div>

            <!-- Rules list -->
            {#if permRulesLoading}
              <div class="perm-rules-loading">Loading...</div>
            {:else if permRules.length === 0}
              <div class="perm-rules-empty">
                No rules configured for this scope. Add rules above or apply a preset.
              </div>
            {:else}
              <div class="perm-rules-list">
                {#each permRules as rule (rule.id)}
                  <div class="perm-rule-row">
                    <span
                      class="perm-rule-type"
                      class:allow={rule.type === 'allow'}
                      class:deny={rule.type === 'deny'}
                      class:ask={rule.type === 'ask'}
                    >
                      {rule.type}
                    </span>
                    <span class="perm-rule-tool">{rule.tool}</span>
                    {#if rule.pattern}
                      <span class="perm-rule-pattern">{rule.pattern}</span>
                    {/if}
                    <span class="perm-rule-scope-badge">{rule.scope}</span>
                    <button
                      class="btn-danger-sm perm-rule-delete"
                      onclick={() => deleteRule(rule.id)}>x</button
                    >
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {:else if activeTab === 'security'}
          <!-- API Keys (BYOK) -->
          <div class="setting-group">
            <label class="setting-label">API Keys</label>
            <p class="setting-desc">
              Bring your own API keys. Keys are stored server-side and never sent back to the
              client.
            </p>
            <div class="api-keys-list">
              {#each apiProviders as provider}
                <div class="api-key-row">
                  <div class="api-key-info">
                    <span class="api-key-name">{provider.label}</span>
                    <span class="api-key-desc">{provider.desc}</span>
                    {#if apiKeyStatus[`${provider.id}Configured`]}
                      <span class="api-key-badge configured">Configured</span>
                    {:else}
                      <span class="api-key-badge not-configured">Not set</span>
                    {/if}
                  </div>
                  <div class="api-key-input-row">
                    <input
                      type="password"
                      class="api-key-input"
                      placeholder={apiKeyStatus[`${provider.id}Configured`]
                        ? '••••••••'
                        : `Enter ${provider.label} API key`}
                      value={apiKeyInputs[provider.id] || ''}
                      oninput={(e) => {
                        apiKeyInputs = {
                          ...apiKeyInputs,
                          [provider.id]: (e.target as HTMLInputElement).value,
                        };
                      }}
                      onkeydown={(e) => {
                        if (e.key === 'Enter') saveApiKey(provider.id);
                      }}
                    />
                    <button
                      class="btn-secondary"
                      onclick={() => saveApiKey(provider.id)}
                      disabled={apiKeySaving[provider.id] || !apiKeyInputs[provider.id]?.trim()}
                    >
                      {apiKeySaving[provider.id] ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                </div>
              {/each}
            </div>
          </div>

          <!-- Budget -->
          <div class="setting-group">
            <label class="setting-label">Session Budget</label>
            <p class="setting-desc">Set a maximum spend per session. Leave empty for no limit.</p>
            <div class="budget-row">
              <span class="budget-prefix">$</span>
              <input
                type="number"
                class="budget-input"
                placeholder="No limit"
                step="0.50"
                min="0"
                value={budgetValue}
                oninput={(e) => {
                  budgetValue = (e.target as HTMLInputElement).value;
                }}
                onkeydown={(e) => {
                  if (e.key === 'Enter') saveBudget();
                }}
              />
              <button class="btn-secondary" onclick={saveBudget} disabled={budgetLoading}>
                {budgetLoading ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>

          <!-- Sandbox -->
          <div class="setting-group">
            <label class="setting-label">Filesystem Sandbox</label>
            <p class="setting-desc">Restrict agent file access to specific directories.</p>
            <div class="sandbox-toggle-row">
              <label class="toggle">
                <input
                  type="checkbox"
                  checked={sandboxEnabled}
                  onchange={() => {
                    sandboxEnabled = !sandboxEnabled;
                  }}
                />
                <span class="toggle-slider"></span>
              </label>
              <span class="sandbox-status">{sandboxEnabled ? 'Enabled' : 'Disabled'}</span>
            </div>
            {#if sandboxEnabled}
              <div class="sandbox-paths">
                <label class="setting-label" style="font-size: var(--fs-sm);">Allowed Paths</label>
                {#each sandboxPaths as path}
                  <div class="sandbox-path-row">
                    <code class="sandbox-path">{path}</code>
                    <button class="btn-danger-sm" onclick={() => removeSandboxPath(path)}>x</button>
                  </div>
                {/each}
                <div class="sandbox-add-row">
                  <input
                    type="text"
                    class="sandbox-path-input"
                    placeholder="/path/to/allow"
                    value={sandboxNewPath}
                    oninput={(e) => {
                      sandboxNewPath = (e.target as HTMLInputElement).value;
                    }}
                    onkeydown={(e) => {
                      if (e.key === 'Enter') addSandboxPath();
                    }}
                  />
                  <button class="btn-secondary" onclick={addSandboxPath}>Add</button>
                </div>
              </div>
              <button
                class="btn-primary"
                style="margin-top: 10px;"
                onclick={saveSandbox}
                disabled={sandboxLoading}
              >
                {sandboxLoading ? 'Saving...' : 'Save Sandbox Config'}
              </button>
            {/if}
          </div>

          <!-- Device Capabilities -->
          <div class="setting-group">
            <label class="setting-label">Device Capabilities</label>
            <p class="setting-desc">
              Allow agents to access device-level features (screenshot, camera, location). All
              features are opt-in and respect OS permissions. Only available in desktop app.
            </p>
            <div class="device-capabilities">
              <div class="capability-row">
                <label class="toggle">
                  <input
                    type="checkbox"
                    checked={settingsStore.deviceCapabilities.screenshotEnabled}
                    onchange={() => {
                      settingsStore.update({
                        deviceCapabilities: {
                          ...settingsStore.deviceCapabilities,
                          screenshotEnabled: !settingsStore.deviceCapabilities.screenshotEnabled,
                        },
                      });
                    }}
                  />
                  <span class="toggle-slider"></span>
                </label>
                <div class="capability-info">
                  <span class="capability-name">Screenshot Capture</span>
                  <span class="capability-desc"
                    >Allow agents to capture screenshots for visual debugging and documentation</span
                  >
                </div>
              </div>
              <div class="capability-row">
                <label class="toggle">
                  <input
                    type="checkbox"
                    checked={settingsStore.deviceCapabilities.cameraEnabled}
                    onchange={() => {
                      settingsStore.update({
                        deviceCapabilities: {
                          ...settingsStore.deviceCapabilities,
                          cameraEnabled: !settingsStore.deviceCapabilities.cameraEnabled,
                        },
                      });
                    }}
                  />
                  <span class="toggle-slider"></span>
                </label>
                <div class="capability-info">
                  <span class="capability-name">Camera Access</span>
                  <span class="capability-desc"
                    >Allow agents to capture photos and scan barcodes/QR codes (requires OS camera
                    permissions)</span
                  >
                </div>
              </div>
              <div class="capability-row">
                <label class="toggle">
                  <input
                    type="checkbox"
                    checked={settingsStore.deviceCapabilities.locationEnabled}
                    onchange={() => {
                      settingsStore.update({
                        deviceCapabilities: {
                          ...settingsStore.deviceCapabilities,
                          locationEnabled: !settingsStore.deviceCapabilities.locationEnabled,
                        },
                      });
                    }}
                  />
                  <span class="toggle-slider"></span>
                </label>
                <div class="capability-info">
                  <span class="capability-name">Location Access</span>
                  <span class="capability-desc"
                    >Allow agents to access approximate location for timezone-aware scheduling (uses
                    IP-based geolocation, no GPS)</span
                  >
                </div>
              </div>
            </div>
            <div class="device-storage-info">
              <label class="setting-label" style="font-size: var(--fs-sm); margin-top: 12px;"
                >Storage</label
              >
              <div class="storage-row">
                <span class="storage-label">Capture directory:</span>
                <code class="storage-path"
                  >{settingsStore.deviceCapabilities.captureStorageDir}</code
                >
              </div>
              <div class="storage-row">
                <span class="storage-label">Storage limit:</span>
                <span class="storage-value"
                  >{settingsStore.deviceCapabilities.captureStorageLimitMb} MB</span
                >
              </div>
            </div>
          </div>
        {:else if activeTab === 'mcp'}
          <div class="setting-group">
            <p class="mcp-info">
              MCP servers can be configured to extend Claude's capabilities with custom tools and
              resources.
            </p>
            <button
              class="btn-primary"
              onclick={() => {
                uiStore.closeModal();
                uiStore.setSidebarTab('mcp');
              }}>Manage MCP Servers</button
            >
          </div>
        {:else if activeTab === 'profiles'}
          <div class="profiles-section">
            <div class="profiles-header">
              <div>
                <p class="setting-desc">
                  Agent profiles bundle permission mode, allowed/disallowed tools, and an optional
                  system prompt override. Select a profile from the top bar or via <kbd
                    >Ctrl+Shift+,</kbd
                  >.
                </p>
              </div>
              <button class="btn-secondary" onclick={openNewProfileForm}>+ New Profile</button>
            </div>

            <div class="profiles-list">
              {#each profilesStore.profiles as profile (profile.id)}
                <div class="profile-card" class:built-in={profile.isBuiltIn}>
                  <div class="profile-card-left">
                    <div class="profile-card-name">
                      {profile.name}
                      {#if profile.isBuiltIn}
                        <span class="built-in-badge">built-in</span>
                      {/if}
                    </div>
                    {#if profile.description}
                      <div class="profile-card-desc">{profile.description}</div>
                    {/if}
                    <div class="profile-card-meta">
                      <span class="meta-chip mode-{profile.permissionMode}"
                        >{profile.permissionMode}</span
                      >
                      {#if profile.allowedTools.length > 0}
                        <span class="meta-chip allow-chip"
                          >allow: {profile.allowedTools.slice(0, 3).join(', ')}{profile.allowedTools
                            .length > 3
                            ? ' +' + (profile.allowedTools.length - 3)
                            : ''}</span
                        >
                      {/if}
                      {#if profile.disallowedTools.length > 0}
                        <span class="meta-chip deny-chip"
                          >deny: {profile.disallowedTools.slice(0, 3).join(', ')}{profile
                            .disallowedTools.length > 3
                            ? ' +' + (profile.disallowedTools.length - 3)
                            : ''}</span
                        >
                      {/if}
                    </div>
                  </div>
                  <div class="profile-card-actions">
                    {#if !profile.isBuiltIn}
                      <button class="btn-secondary" onclick={() => openEditProfileForm(profile)}
                        >Edit</button
                      >
                      <button class="btn-danger-sm" onclick={() => deleteProfile(profile.id)}
                        >Delete</button
                      >
                    {/if}
                  </div>
                </div>
              {/each}
            </div>

            {#if showProfileForm}
              <div class="profile-form-overlay">
                <div class="profile-form">
                  <div class="profile-form-header">
                    <h3>{editingProfile ? 'Edit Profile' : 'New Profile'}</h3>
                    <button class="close-btn" onclick={closeProfileForm}>
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                      >
                        <path d="M18 6L6 18M6 6l12 12" />
                      </svg>
                    </button>
                  </div>

                  <div class="profile-form-body">
                    <div class="setting-group">
                      <label class="setting-label">Name <span class="required">*</span></label>
                      <input type="text" bind:value={profileFormName} placeholder="My Profile" />
                    </div>

                    <div class="setting-group">
                      <label class="setting-label">Description</label>
                      <input
                        type="text"
                        bind:value={profileFormDescription}
                        placeholder="Short description (optional)"
                      />
                    </div>

                    <div class="setting-group">
                      <label class="setting-label">Permission Mode</label>
                      <div class="perm-options">
                        {#each permModes as mode}
                          <button
                            class="perm-option"
                            class:active={profileFormPermissionMode === mode.id}
                            onclick={() => (profileFormPermissionMode = mode.id as any)}
                          >
                            <span class="perm-name">{mode.label}</span>
                            <span class="perm-desc">{mode.desc}</span>
                          </button>
                        {/each}
                      </div>
                    </div>

                    <div class="setting-group">
                      <label class="setting-label">Allowed Tools</label>
                      <input
                        type="text"
                        bind:value={profileFormAllowedTools}
                        placeholder="Read, Glob, Grep (comma-separated, * for all)"
                      />
                      <p class="setting-desc">
                        Tools that are always allowed. Use * to allow all tools.
                      </p>
                    </div>

                    <div class="setting-group">
                      <label class="setting-label">Disallowed Tools</label>
                      <input
                        type="text"
                        bind:value={profileFormDisallowedTools}
                        placeholder="Write, Edit, Bash (comma-separated, * for all)"
                      />
                      <p class="setting-desc">
                        Tools that are always blocked. Use * to block all tools.
                      </p>
                    </div>

                    <div class="setting-group">
                      <label class="setting-label">System Prompt Override</label>
                      <textarea
                        bind:value={profileFormSystemPrompt}
                        placeholder="Optional: override the system prompt when this profile is active"
                        rows="4"
                      ></textarea>
                    </div>

                    <div class="profile-form-footer">
                      <button class="btn-secondary" onclick={closeProfileForm}>Cancel</button>
                      <button
                        class="btn-primary"
                        onclick={saveProfile}
                        disabled={profileFormSaving || !profileFormName.trim()}
                      >
                        {profileFormSaving
                          ? 'Saving...'
                          : editingProfile
                            ? 'Update Profile'
                            : 'Create Profile'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            {/if}
          </div>
        {:else if activeTab === 'webhooks'}
          <WebhookSettings />
        {:else if activeTab === 'notifications'}
          <NotificationChannelsSettings />
        {:else if activeTab === 'device'}
          <DeviceSettings />
        {:else if activeTab === 'learning'}
          <PatternDetectionSettings />
        {:else if activeTab === 'remote'}
          <RemoteAccessSettings />
        {:else}
          <!-- keybindings (last branch — no explicit type check needed) -->
          <div class="keybindings-list">
            {#each settingsStore.keybindings as binding}
              <div class="keybinding-row">
                <span class="kb-action">{binding.description || binding.action}</span>
                <kbd class="kb-keys">{binding.keys}</kbd>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  </div>
</div>

<style>
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }
  .modal {
    background: var(--bg-elevated);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-lg);
    width: 600px;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    box-shadow: var(--shadow-lg);
  }
  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border-primary);
  }
  .modal-header h2 {
    font-size: var(--fs-lg);
    font-weight: 700;
  }
  .close-btn {
    color: var(--text-tertiary);
    padding: 4px;
    border-radius: var(--radius-sm);
  }
  .close-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .modal-body {
    display: flex;
    flex: 1;
    min-height: 0;
  }

  .settings-tabs {
    display: flex;
    flex-direction: column;
    padding: 8px;
    border-right: 1px solid var(--border-secondary);
    min-width: 140px;
  }
  .settings-tab {
    padding: 8px 12px;
    border-radius: var(--radius-sm);
    font-size: var(--fs-base);
    text-align: left;
    color: var(--text-secondary);
    transition: all var(--transition);
  }
  .settings-tab:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .settings-tab.active {
    background: var(--bg-active);
    color: var(--accent-primary);
    font-weight: 600;
  }

  .settings-section-header {
    display: block;
    font-size: var(--fs-xxs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-tertiary);
    padding: 10px 12px 4px;
    user-select: none;
  }
  .settings-section-header:first-child {
    padding-top: 4px;
  }

  .settings-content {
    flex: 1;
    padding: 16px 20px;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }

  .setting-group {
    margin-bottom: 20px;
  }
  .setting-label {
    display: block;
    font-size: var(--fs-base);
    font-weight: 600;
    margin-bottom: 8px;
    color: var(--text-primary);
  }

  select,
  input[type='range'] {
    width: 100%;
  }

  .setting-text-input {
    width: 100%;
    padding: 6px 10px;
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    background: var(--bg-primary);
    color: var(--text-primary);
    font-family: var(--font-family-mono);
    font-size: var(--fs-sm);
  }
  .setting-text-input:focus {
    outline: none;
    border-color: var(--accent-primary);
  }

  /* Toggle */
  .toggle {
    position: relative;
    display: inline-block;
    width: 44px;
    height: 24px;
    cursor: pointer;
  }
  .toggle input {
    opacity: 0;
    width: 0;
    height: 0;
  }
  .toggle-slider {
    position: absolute;
    inset: 0;
    background: var(--bg-tertiary);
    border-radius: 12px;
    transition: background var(--transition);
  }
  .toggle-slider::before {
    content: '';
    position: absolute;
    width: 20px;
    height: 20px;
    left: 2px;
    bottom: 2px;
    background: var(--text-primary);
    border-radius: 50%;
    transition: transform var(--transition);
  }
  .toggle input:checked + .toggle-slider {
    background: var(--accent-primary);
  }
  .toggle input:checked + .toggle-slider::before {
    transform: translateX(20px);
  }

  /* Image dimension controls */
  .image-dimension-row {
    display: flex;
    gap: 16px;
  }
  .image-dim-label {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: var(--fs-sm);
    color: var(--text-secondary);
  }
  .image-dim-label input[type='range'] {
    width: 100%;
  }

  /* Hypertheme grid */
  .hypertheme-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
  }
  .hypertheme-option {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 10px 6px;
    border: 2px solid var(--border-secondary);
    border-radius: var(--radius);
    transition: all var(--transition);
    text-align: center;
  }
  .hypertheme-option:hover {
    border-color: var(--border-primary);
    background: var(--bg-hover);
  }
  .hypertheme-option.active {
    border-color: var(--accent-primary);
    background: var(--bg-active);
  }
  .ht-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-secondary);
  }
  .hypertheme-option.active .ht-icon {
    color: var(--accent-primary);
  }
  .ht-label {
    font-size: var(--fs-xs);
    font-weight: 700;
    letter-spacing: var(--ht-label-spacing);
    color: var(--text-primary);
  }
  .ht-desc {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    line-height: 1.2;
  }

  /* Theme grid */
  .theme-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
  }
  .theme-option {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 8px;
    border: 2px solid var(--border-secondary);
    border-radius: var(--radius);
    transition: all var(--transition);
    font-size: var(--fs-xs);
  }
  .theme-option:hover {
    border-color: var(--border-primary);
  }
  .theme-option.active {
    border-color: var(--accent-primary);
  }
  .theme-preview {
    width: 100%;
    height: 48px;
    border-radius: var(--radius-sm);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .tp-bar {
    height: 6px;
    background: var(--bg-tertiary);
  }
  .tp-body {
    flex: 1;
    display: flex;
  }
  .tp-sidebar {
    width: 30%;
    background: var(--bg-secondary);
  }
  .tp-main {
    flex: 1;
    background: var(--bg-primary);
  }

  /* CLI Provider */
  .provider-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
  }
  .provider-option {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    padding: 10px 12px;
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
    text-align: left;
    transition: all var(--transition);
    cursor: pointer;
    background: var(--bg-primary);
  }
  .provider-option:hover {
    border-color: var(--border-primary);
    background: var(--bg-hover);
  }
  .provider-option.active {
    border-color: var(--accent-primary);
    background: var(--bg-active);
  }
  .provider-name {
    font-size: var(--fs-base);
    font-weight: 600;
  }
  .provider-desc {
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
  }
  .setting-hint {
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
    margin: 0 0 8px 0;
  }

  /* Permission modes */
  .perm-options {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .perm-option {
    display: flex;
    flex-direction: column;
    padding: 10px 12px;
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
    text-align: left;
    transition: all var(--transition);
  }
  .perm-option:hover {
    border-color: var(--border-primary);
  }
  .perm-option.active {
    border-color: var(--accent-primary);
    background: var(--bg-active);
  }
  .perm-name {
    font-size: var(--fs-base);
    font-weight: 600;
  }
  .perm-desc {
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
  }

  /* MCP */
  .mcp-info {
    font-size: var(--fs-base);
    color: var(--text-secondary);
    margin-bottom: 12px;
  }
  .btn-primary {
    padding: 8px 16px;
    background: var(--accent-primary);
    color: var(--text-on-accent);
    border-radius: var(--radius-sm);
    font-size: var(--fs-base);
    font-weight: 600;
  }

  /* Keybindings */
  .keybindings-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .keybinding-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 0;
    border-bottom: 1px solid var(--border-secondary);
  }
  .kb-action {
    font-size: var(--fs-base);
    color: var(--text-primary);
  }
  .kb-keys {
    font-size: var(--fs-sm);
    padding: 2px 8px;
    background: var(--bg-tertiary);
    border-radius: var(--radius-sm);
    font-family: var(--font-family);
  }

  /* Snippets */
  .setting-desc {
    font-size: var(--fs-sm);
    color: var(--text-tertiary);
    margin-bottom: 10px;
  }
  .setting-warn {
    color: var(--text-warning, #d4a017);
  }
  .setting-warn code {
    background: color-mix(in srgb, var(--text-warning, #d4a017) 15%, transparent);
    padding: 1px 5px;
    border-radius: 3px;
    font-size: var(--fs-xs);
  }
  .snippet-import-row {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .snippet-import-row select {
    flex: 1;
    padding: 6px 8px;
    font-size: var(--fs-base);
    background: var(--bg-input);
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
  }
  .snippet-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .snippet-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 8px;
    background: var(--bg-tertiary);
    border-radius: var(--radius-sm);
  }
  .snippet-lang {
    font-size: var(--fs-base);
    font-weight: 600;
    text-transform: var(--ht-label-transform);
    color: var(--text-primary);
    min-width: 90px;
  }
  .snippet-count {
    font-size: var(--fs-sm);
    color: var(--text-secondary);
    flex: 1;
  }
  .btn-secondary {
    padding: 6px 14px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-secondary);
    color: var(--text-primary);
    border-radius: var(--radius-sm);
    font-size: var(--fs-sm);
    font-weight: 600;
    cursor: pointer;
    transition: all var(--transition);
  }
  .btn-secondary:hover {
    border-color: var(--accent-primary);
    color: var(--accent-primary);
  }
  .btn-danger-sm {
    padding: 3px 10px;
    background: transparent;
    border: 1px solid var(--accent-error);
    color: var(--accent-error);
    border-radius: var(--radius-sm);
    font-size: var(--fs-xs);
    font-weight: 600;
    cursor: pointer;
  }
  .btn-danger-sm:hover {
    background: var(--accent-error);
    color: var(--bg-primary);
  }

  /* Custom theme swatches */
  .theme-swatch {
    width: 100%;
    height: 48px;
    border-radius: var(--radius-sm);
    overflow: hidden;
    display: flex;
  }
  .swatch-half {
    flex: 1;
  }
  .delete-theme-btn {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 24px;
    height: 24px;
    font-size: var(--fs-xs);
    line-height: 24px;
    text-align: center;
    padding: 0;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
    color: var(--text-tertiary);
    cursor: pointer;
    opacity: 0;
    transition: opacity var(--transition);
  }
  .theme-option {
    position: relative;
  }
  .theme-option:hover .delete-theme-btn {
    opacity: 1;
  }
  .delete-theme-btn:hover {
    background: var(--accent-error);
    color: white;
    border-color: var(--accent-error);
  }

  /* API Keys */
  .api-keys-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .api-key-row {
    padding: 10px 12px;
    background: var(--bg-tertiary);
    border-radius: var(--radius-sm);
  }
  .api-key-info {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }
  .api-key-name {
    font-size: var(--fs-base);
    font-weight: 600;
    color: var(--text-primary);
  }
  .api-key-desc {
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
  }
  .api-key-badge {
    font-size: var(--fs-xxs);
    font-weight: 700;
    padding: 1px 8px;
    border-radius: var(--radius-sm);
    text-transform: var(--ht-label-transform);
    letter-spacing: var(--ht-label-spacing);
    margin-left: auto;
  }
  .api-key-badge.configured {
    color: var(--accent-secondary);
    border: 1px solid var(--accent-secondary);
  }
  .api-key-badge.not-configured {
    color: var(--text-tertiary);
    border: 1px solid var(--border-secondary);
  }
  .api-key-input-row {
    display: flex;
    gap: 6px;
  }
  .api-key-input {
    flex: 1;
    padding: 6px 10px;
    font-size: var(--fs-sm);
    background: var(--bg-input);
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-family: var(--font-family);
  }
  .api-key-input:focus {
    border-color: var(--accent-primary);
    outline: none;
  }

  /* Budget */
  .budget-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .budget-prefix {
    font-size: var(--fs-md);
    font-weight: 700;
    color: var(--text-secondary);
  }
  .budget-input {
    width: 120px;
    padding: 6px 10px;
    font-size: var(--fs-base);
    background: var(--bg-input);
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-family: var(--font-family);
  }
  .budget-input:focus {
    border-color: var(--accent-primary);
    outline: none;
  }

  /* Sandbox */
  .sandbox-toggle-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 12px;
  }
  .sandbox-status {
    font-size: var(--fs-sm);
    color: var(--text-secondary);
    font-weight: 600;
  }
  .sandbox-paths {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 8px;
  }
  .sandbox-path-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 8px;
    background: var(--bg-tertiary);
    border-radius: var(--radius-sm);
  }
  .sandbox-path {
    flex: 1;
    font-size: var(--fs-sm);
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sandbox-add-row {
    display: flex;
    gap: 6px;
  }
  .sandbox-path-input {
    flex: 1;
    padding: 6px 10px;
    font-size: var(--fs-sm);
    background: var(--bg-input);
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-family: var(--font-family);
  }
  .sandbox-path-input:focus {
    border-color: var(--accent-primary);
    outline: none;
  }

  /* Streaming animation options */
  .streaming-options {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .streaming-option-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 6px 10px;
    background: var(--bg-tertiary);
    border-radius: var(--radius-sm);
  }
  .streaming-option-label {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-secondary);
  }
  .streaming-option-row select {
    width: 130px;
    padding: 4px 8px;
    font-size: var(--fs-sm);
    background: var(--bg-input);
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
  }
  .streaming-option-row select:focus {
    border-color: var(--accent-primary);
    outline: none;
  }

  /* Font picker */
  .font-select {
    width: 100%;
    padding: 8px 10px;
    font-size: var(--fs-base);
    background: var(--bg-input);
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    cursor: pointer;
  }
  .font-select:focus {
    border-color: var(--accent-primary);
    outline: none;
  }
  /* Font size presets & controls */
  .font-size-presets {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .preset-btn {
    padding: 4px 12px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius);
    color: var(--text-secondary);
    font-family: var(--font-family-sans);
    font-size: var(--fs-sans-sm);
    font-weight: 600;
    cursor: pointer;
    transition: all var(--transition);
  }
  .preset-btn:hover {
    background: var(--bg-elevated);
    color: var(--text-primary);
    border-color: var(--border-focus);
  }
  .preset-btn.active {
    background: var(--accent-primary);
    color: var(--bg-primary);
    border-color: var(--accent-primary);
  }
  .preset-btn.reset-btn {
    padding: 4px 8px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .font-size-input-row {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 6px;
  }
  .font-size-step {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius);
    color: var(--text-secondary);
    font-size: var(--fs-sans-md);
    font-weight: 700;
    cursor: pointer;
    transition: all var(--transition);
  }
  .font-size-step:hover {
    background: var(--bg-elevated);
    color: var(--text-primary);
    border-color: var(--border-focus);
  }
  .font-size-number {
    width: 56px;
    height: 28px;
    text-align: center;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius);
    color: var(--text-primary);
    font-family: var(--font-family);
    font-size: var(--fs-sm);
  }
  .font-size-number:focus {
    border-color: var(--accent-primary);
    outline: none;
  }
  .ui-font-link {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
  }
  .setting-badge {
    display: inline-block;
    margin-left: 6px;
    padding: 1px 6px;
    background: var(--accent-primary);
    color: var(--bg-primary);
    font-size: var(--fs-sans-xxs);
    font-weight: 700;
    border-radius: var(--radius-sm);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  kbd {
    display: inline-block;
    padding: 1px 5px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
    font-family: var(--font-family);
    font-size: var(--fs-xs);
    color: var(--text-secondary);
    line-height: 1.4;
  }

  .font-preview {
    margin-top: 8px;
    padding: 10px 12px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    font-size: var(--fs-md);
    line-height: 1.5;
  }
  .font-preview.mono {
    font-size: var(--fs-base);
    letter-spacing: 0.3px;
  }

  /* Audio tab */
  .audio-toggle-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 6px;
  }
  .audio-toggle-label {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-secondary);
  }
  .volume-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .volume-row input[type='range'] {
    flex: 1;
  }
  .volume-icon {
    display: flex;
    align-items: center;
    color: var(--text-tertiary);
    user-select: none;
  }
  .muted {
    opacity: 0.4;
    pointer-events: none;
  }
  .sound-style-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .sound-style-btn {
    flex: 1 1 calc(50% - 4px);
    min-width: 140px;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    padding: 10px 12px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
    cursor: pointer;
    text-align: left;
    transition:
      border-color 0.15s,
      background 0.15s;
  }
  .sound-style-btn:hover:not(:disabled) {
    border-color: var(--accent-primary);
    background: var(--bg-secondary);
  }
  .sound-style-btn.active {
    border-color: var(--accent-primary);
    background: color-mix(in srgb, var(--accent-primary) 10%, var(--bg-tertiary));
  }
  .sound-style-btn:disabled {
    cursor: not-allowed;
  }
  .sound-style-name {
    font-size: var(--fs-sm);
    font-weight: 700;
    color: var(--text-primary);
    font-family: var(--font-family-sans);
  }
  .sound-style-btn.active .sound-style-name {
    color: var(--accent-primary);
  }
  .sound-style-desc {
    font-size: var(--fs-xs);
    color: var(--text-secondary);
    line-height: 1.4;
  }
  .chirp-legend {
    display: flex;
    flex-direction: column;
    gap: 0;
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .chirp-row {
    display: flex;
    align-items: baseline;
    gap: 12px;
    padding: 7px 12px;
    border-bottom: 1px solid var(--border-secondary);
  }
  .chirp-row:last-child {
    border-bottom: none;
  }
  .chirp-row:nth-child(even) {
    background: var(--bg-tertiary);
  }
  .chirp-event {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--accent-primary);
    min-width: 130px;
    flex-shrink: 0;
  }
  .chirp-desc {
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
    line-height: 1.4;
  }

  /* Desktop notifications */
  .notify-status {
    font-size: var(--fs-xs);
    font-weight: 600;
    margin-left: 4px;
  }
  .notify-status.granted {
    color: var(--accent-secondary);
  }
  .notify-status.denied {
    color: var(--accent-error);
  }
  .notify-request-btn {
    margin-left: 4px;
    padding: 2px 10px;
    font-size: var(--fs-xs);
  }
  .notify-options {
    display: flex;
    flex-direction: column;
    gap: 0;
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .notify-option-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border-secondary);
  }
  .notify-option-row:last-child {
    border-bottom: none;
  }
  .notify-option-row:nth-child(even) {
    background: var(--bg-tertiary);
  }
  .notify-option-label {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-secondary);
  }

  /* Commentary settings */
  .commentary-no-workspace {
    font-size: var(--fs-sm);
    color: var(--text-tertiary);
    font-style: italic;
    padding: 12px;
    background: var(--bg-tertiary);
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-secondary);
  }
  .commentary-personality-grid {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .commentary-personality-option {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 3px;
    padding: 10px 12px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
    cursor: pointer;
    text-align: left;
    transition:
      border-color 0.15s,
      background 0.15s;
  }
  .commentary-personality-option:hover:not(:disabled) {
    border-color: var(--accent-primary);
    background: var(--bg-secondary);
  }
  .commentary-personality-option.active {
    border-color: var(--accent-primary);
    background: color-mix(in srgb, var(--accent-primary) 10%, var(--bg-tertiary));
  }
  .commentary-personality-option:disabled {
    cursor: not-allowed;
  }
  .commentary-personality-name {
    font-size: var(--fs-sm);
    font-weight: 700;
    color: var(--text-primary);
    font-family: var(--font-family-sans);
  }
  .commentary-personality-option.active .commentary-personality-name {
    color: var(--accent-primary);
  }
  .commentary-personality-desc {
    font-size: var(--fs-xs);
    color: var(--text-secondary);
    line-height: 1.4;
  }
  .commentary-verbosity-options {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .commentary-verbosity-option {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition:
      border-color 0.15s,
      background 0.15s;
  }
  .commentary-verbosity-option:hover {
    border-color: var(--border-primary);
    background: var(--bg-hover);
  }
  .commentary-verbosity-option.active {
    border-color: var(--accent-primary);
    background: color-mix(in srgb, var(--accent-primary) 10%, var(--bg-tertiary));
  }
  .commentary-verbosity-option input[type='radio'] {
    width: auto;
    accent-color: var(--accent-primary);
    flex-shrink: 0;
  }
  .commentary-verbosity-content {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .commentary-verbosity-label {
    font-size: var(--fs-sm);
    font-weight: 700;
    color: var(--text-primary);
  }
  .commentary-verbosity-option.active .commentary-verbosity-label {
    color: var(--accent-primary);
  }
  .commentary-verbosity-desc {
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
  }
  .commentary-preview-btn {
    margin-bottom: 10px;
  }
  .commentary-preview-box {
    background: var(--bg-tertiary);
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
    padding: 12px;
    margin-top: 8px;
  }
  .commentary-preview-header {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 8px;
  }
  .commentary-preview-personality {
    font-size: var(--fs-xs);
    font-weight: 700;
    color: var(--accent-primary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .commentary-preview-text {
    font-size: var(--fs-sm);
    color: var(--text-secondary);
    line-height: 1.6;
    font-style: italic;
    margin: 0;
  }

  .experimental-badge {
    display: inline-block;
    font-size: var(--fs-sans-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 1px 5px;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--accent-warning, #f0a030) 15%, transparent);
    color: var(--accent-warning, #f0a030);
    border: 1px solid color-mix(in srgb, var(--accent-warning, #f0a030) 30%, transparent);
    vertical-align: middle;
    margin-left: 6px;
  }

  /* Terminal command policy */
  .terminal-policy-options {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
  }
  .terminal-policy-option {
    padding: 8px 10px;
  }

  /* Permission rules scope selector */
  .perm-scope-row {
    display: flex;
    gap: 4px;
    margin-bottom: 10px;
    padding: 2px;
    background: var(--bg-tertiary);
    border-radius: var(--radius-sm);
  }
  .perm-scope-btn {
    flex: 1;
    padding: 5px 10px;
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-secondary);
    border-radius: var(--radius-sm);
    transition: all var(--transition);
    text-align: center;
  }
  .perm-scope-btn:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }
  .perm-scope-btn.active {
    color: var(--accent-primary);
    background: var(--bg-elevated);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
  }

  /* Presets row */
  .perm-presets-row {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 10px;
    flex-wrap: wrap;
  }
  .perm-presets-label {
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .perm-preset-btn {
    padding: 3px 10px;
    font-size: var(--fs-xs);
    font-weight: 600;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    cursor: pointer;
    transition: all var(--transition);
  }
  .perm-preset-btn:hover {
    border-color: var(--accent-primary);
    color: var(--accent-primary);
    background: var(--bg-hover);
  }

  /* Add rule form */
  .perm-add-rule {
    display: flex;
    gap: 4px;
    margin-bottom: 10px;
    align-items: center;
  }
  .perm-rule-select {
    padding: 5px 8px;
    font-size: var(--fs-sm);
    background: var(--bg-input);
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    min-width: 70px;
  }
  .perm-tool-select {
    min-width: 100px;
  }
  .perm-pattern-input {
    flex: 1;
    padding: 5px 8px;
    font-size: var(--fs-sm);
    background: var(--bg-input);
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-family: var(--font-family);
  }
  .perm-pattern-input:focus,
  .perm-rule-select:focus {
    border-color: var(--accent-primary);
    outline: none;
  }
  .perm-add-btn {
    padding: 5px 12px;
    font-size: var(--fs-sm);
    white-space: nowrap;
  }

  /* Rules list */
  .perm-rules-list {
    display: flex;
    flex-direction: column;
    gap: 0;
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .perm-rule-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--border-secondary);
    font-size: var(--fs-sm);
  }
  .perm-rule-row:last-child {
    border-bottom: none;
  }
  .perm-rule-row:nth-child(even) {
    background: var(--bg-tertiary);
  }
  .perm-rule-type {
    font-size: var(--fs-xxs);
    font-weight: 700;
    padding: 1px 6px;
    border-radius: 3px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    flex-shrink: 0;
  }
  .perm-rule-type.allow {
    color: var(--accent-secondary);
    background: color-mix(in srgb, var(--accent-secondary) 15%, transparent);
  }
  .perm-rule-type.deny {
    color: var(--accent-error);
    background: color-mix(in srgb, var(--accent-error) 15%, transparent);
  }
  .perm-rule-type.ask {
    color: var(--accent-warning);
    background: color-mix(in srgb, var(--accent-warning) 15%, transparent);
  }
  .perm-rule-tool {
    font-weight: 600;
    color: var(--text-primary);
    flex-shrink: 0;
  }
  .perm-rule-pattern {
    font-family: var(--font-family);
    color: var(--text-secondary);
    font-size: var(--fs-xs);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }
  .perm-rule-scope-badge {
    font-size: var(--fs-xxs);
    font-weight: 700;
    padding: 1px 5px;
    border-radius: 3px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-secondary);
    color: var(--text-tertiary);
    flex-shrink: 0;
  }
  .perm-rule-delete {
    flex-shrink: 0;
    margin-left: auto;
  }
  .perm-rules-loading,
  .perm-rules-empty {
    font-size: var(--fs-sm);
    color: var(--text-tertiary);
    padding: 16px 0;
    text-align: center;
  }

  /* ── Agent Profiles ── */
  .profiles-section {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .profiles-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
  }
  .profiles-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .profile-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 14px;
    border-radius: var(--radius);
    background: var(--bg-tertiary);
    border: 1px solid var(--border-secondary);
    transition: border-color var(--transition);
  }
  .profile-card.built-in {
    border-color: var(--border-primary);
  }
  .profile-card:hover {
    border-color: var(--accent-primary);
  }
  .profile-card-left {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .profile-card-name {
    font-size: var(--fs-base);
    font-weight: 600;
    color: var(--text-primary);
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .built-in-badge {
    font-size: var(--fs-xxs);
    font-weight: 600;
    padding: 2px 7px;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--accent-primary) 15%, transparent);
    color: var(--accent-primary);
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }
  .profile-card-desc {
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
  }
  .profile-card-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 4px;
  }
  .meta-chip {
    font-size: var(--fs-xxs);
    font-weight: 600;
    padding: 2px 7px;
    border-radius: var(--radius-sm);
    background: var(--bg-secondary);
    border: 1px solid var(--border-secondary);
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .allow-chip {
    color: var(--accent-success, #4ade80);
    border-color: color-mix(in srgb, var(--accent-success, #4ade80) 30%, transparent);
  }
  .deny-chip {
    color: var(--accent-danger, #f87171);
    border-color: color-mix(in srgb, var(--accent-danger, #f87171) 30%, transparent);
  }
  .profile-card-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  /* Profile form overlay */
  .profile-form-overlay {
    position: fixed;
    inset: 0;
    z-index: 500;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    backdrop-filter: blur(4px);
  }
  .profile-form {
    width: 540px;
    max-width: 90vw;
    max-height: 85vh;
    overflow-y: auto;
    background: var(--bg-secondary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-lg, var(--radius));
    box-shadow: var(--shadow-xl, var(--shadow-lg));
  }
  .profile-form-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border-secondary);
  }
  .profile-form-header h3 {
    font-size: var(--fs-md);
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
  }
  .profile-form-body {
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .profile-form-footer {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 8px;
  }
  .required {
    color: var(--accent-danger, #f87171);
  }
  .btn-primary {
    padding: 7px 18px;
    font-size: var(--fs-base);
    font-weight: 600;
    border-radius: var(--radius-sm);
    background: var(--accent-primary);
    color: var(--text-on-accent, #fff);
    border: none;
    cursor: pointer;
    transition: all var(--transition);
  }
  .btn-primary:hover:not(:disabled) {
    opacity: 0.9;
  }
  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Terminal settings */
  .setting-input {
    width: 100%;
    padding: 8px 10px;
    font-size: var(--fs-base);
    background: var(--bg-input);
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-family: var(--font-family);
  }
  .setting-input:focus {
    border-color: var(--accent-primary);
    outline: none;
  }

  /* ── Terminal Profiles ── */
  .term-profiles-section {
    margin-top: 8px;
  }
  .term-profiles-section-label {
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 6px;
  }
  .term-profile-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
    margin-bottom: 4px;
    background: var(--bg-secondary);
    transition: border-color var(--transition);
  }
  .term-profile-row:hover {
    border-color: var(--border-primary);
  }
  .term-profile-icon {
    flex-shrink: 0;
    color: var(--text-tertiary);
  }
  .term-profile-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .term-profile-name {
    font-size: var(--fs-sm);
    color: var(--text-primary);
    font-weight: 500;
  }
  .term-profile-path {
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
    font-family: var(--font-family-mono, monospace);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .term-profile-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }
  .term-profile-action-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
    transition:
      color var(--transition),
      background var(--transition);
    padding: 0;
  }
  .term-profile-action-btn:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }
  .term-profile-action-btn.is-default {
    color: var(--accent-warning, #ffaa00);
  }
  .term-profile-action-btn.danger:hover {
    color: var(--accent-error);
    background: color-mix(in srgb, var(--accent-error) 12%, transparent);
  }
  .term-profile-badge {
    font-size: var(--fs-sans-xs);
    padding: 1px 5px;
    border-radius: var(--radius-sm);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    flex-shrink: 0;
  }
  .term-profile-badge.read-only {
    background: color-mix(in srgb, var(--text-tertiary) 15%, transparent);
    color: var(--text-tertiary);
  }
  .term-profile-add-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 6px;
  }

  /* Terminal profile editor form */
  .term-profile-editor {
    margin-top: 10px;
    padding: 12px;
    border: 1px solid var(--border-primary);
    border-radius: var(--radius);
    background: var(--bg-secondary);
  }
  .term-profile-editor-title {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-primary);
    margin-bottom: 10px;
  }
  .term-profile-field {
    margin-bottom: 10px;
  }
  .term-profile-field-label {
    display: block;
    font-size: var(--fs-xs);
    color: var(--text-secondary);
    margin-bottom: 3px;
  }
  .term-profile-field-hint {
    display: block;
    font-size: var(--fs-sans-xs);
    color: var(--text-tertiary);
    margin-top: 2px;
  }
  .setting-textarea {
    width: 100%;
    padding: 6px 8px;
    background: var(--bg-input);
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-family: var(--font-family-mono, monospace);
    font-size: var(--fs-xs);
    resize: vertical;
    min-height: 60px;
  }
  .setting-textarea:focus {
    border-color: var(--accent-primary);
    outline: none;
  }
  .term-profile-editor-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 12px;
  }
  .btn-primary {
    padding: 5px 14px;
    background: var(--accent-primary);
    color: var(--bg-primary);
    border: none;
    border-radius: var(--radius-sm);
    font-size: var(--fs-xs);
    cursor: pointer;
    transition: opacity var(--transition);
  }
  .btn-primary:hover {
    opacity: 0.9;
  }
  .btn-primary:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  /* ── Mobile nav tab customization ── */
  .mobile-nav-selected {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 12px;
  }
  .mobile-nav-chip {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    background: var(--bg-input);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
  }
  .mobile-nav-chip-order {
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
    width: 16px;
    text-align: center;
    flex-shrink: 0;
  }
  .mobile-nav-chip-icon {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
    color: var(--text-secondary);
  }
  .mobile-nav-chip-label {
    flex: 1;
    font-size: var(--fs-sm);
    color: var(--text-primary);
  }
  .mobile-nav-chip-actions {
    display: flex;
    gap: 2px;
    flex-shrink: 0;
  }
  .mobile-nav-chip-btn {
    width: 24px;
    height: 24px;
    min-height: 24px;
    min-width: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-xs);
    color: var(--text-tertiary);
    font-size: 10px;
    cursor: pointer;
    padding: 0;
  }
  .mobile-nav-chip-btn:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .mobile-nav-chip-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }
  .mobile-nav-chip-btn.remove:hover:not(:disabled) {
    color: var(--accent-error);
    border-color: var(--accent-error);
  }
  .mobile-nav-available {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .mobile-nav-add-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 10px;
    background: none;
    border: 1px dashed var(--border-primary);
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    font-size: var(--fs-xs);
    cursor: pointer;
    min-height: 28px;
    min-width: 28px;
  }
  .mobile-nav-add-btn svg {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
  }
  .mobile-nav-add-btn:hover:not(:disabled) {
    background: var(--bg-hover);
    border-color: var(--accent-primary);
    color: var(--accent-primary);
  }
  .mobile-nav-add-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  /* ── Mobile settings modal overrides ── */
  @media (max-width: 640px) {
    .modal-overlay {
      align-items: stretch;
      justify-content: stretch;
      padding: 0;
    }
    .modal {
      width: 100%;
      max-height: 100%;
      height: 100%;
      border-radius: 0;
      border: none;
    }
    .modal-body {
      flex-direction: column;
      min-height: 0;
    }
    .settings-tabs {
      flex-direction: row;
      flex-wrap: wrap;
      min-width: 0;
      border-right: none;
      border-bottom: 1px solid var(--border-secondary);
      padding: 6px;
      gap: 2px;
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
    }
    .settings-section-header {
      display: none;
    }
    .settings-tab {
      padding: 6px 10px;
      font-size: var(--fs-xs);
      white-space: nowrap;
    }
    .settings-content {
      padding: 12px 16px;
    }
  }

  /* Voice mode settings */
  .voice-mode-options {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .voice-mode-option {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 12px;
    border: 2px solid var(--border-secondary);
    border-radius: var(--radius);
    cursor: pointer;
    transition: all var(--transition);
  }

  .voice-mode-option:hover {
    border-color: var(--border-primary);
    background: var(--bg-hover);
  }

  .voice-mode-option.active {
    border-color: var(--accent-primary);
    background: var(--bg-active);
  }

  .voice-mode-option input[type='radio'] {
    margin-top: 2px;
  }

  .voice-mode-content {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: 1;
  }

  .voice-mode-name {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-primary);
  }

  .voice-mode-desc {
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
  }

  .text-input {
    width: 100%;
    padding: 8px 12px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius);
    color: var(--text-primary);
    font-size: var(--fs-sm);
    font-family: var(--font-family);
    transition: all var(--transition);
  }

  .text-input:focus {
    outline: none;
    border-color: var(--accent-primary);
    background: var(--bg-secondary);
  }

  .toggle-label {
    display: flex;
    align-items: flex-start;
    gap: 10px;
  }

  .toggle-label-text {
    font-size: var(--fs-sm);
    font-weight: 500;
    color: var(--text-primary);
  }

  .setting-hint {
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
    margin-top: 2px;
  }

  /* ── Device capabilities ── */
  .device-capabilities {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .capability-row {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 12px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-md);
  }
  .capability-info {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: 1;
  }
  .capability-name {
    font-size: var(--fs-base);
    font-weight: 500;
    color: var(--text-primary);
  }
  .capability-desc {
    font-size: var(--fs-sm);
    color: var(--text-secondary);
    line-height: 1.5;
  }
  .device-storage-info {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-md);
    margin-top: 8px;
  }
  .storage-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: var(--fs-sm);
  }
  .storage-label {
    color: var(--text-secondary);
    min-width: 120px;
  }
  .storage-path {
    color: var(--text-primary);
    background: var(--bg-secondary);
    padding: 2px 6px;
    border-radius: var(--radius-xs);
    font-size: var(--fs-xs);
    font-family: var(--font-mono);
  }
  .storage-value {
    color: var(--text-primary);
  }
</style>
