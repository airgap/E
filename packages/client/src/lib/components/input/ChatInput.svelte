<script lang="ts">
  import { conversationStore } from '$lib/stores/conversation.svelte';
  import { streamStore } from '$lib/stores/stream.svelte';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { workspaceListStore } from '$lib/stores/projects.svelte';
  import { editorStore } from '$lib/stores/editor.svelte';
  import { lspStore } from '$lib/stores/lsp.svelte';
  import { sendAndStream, cancelStream } from '$lib/api/sse';
  import { chirpEngine } from '$lib/audio/chirp-engine';
  import { api } from '$lib/api/client';
  import { executeSlashCommand, type SlashCommandContext } from '$lib/commands/slash-commands';
  import { uiStore, onFocusChatInput } from '$lib/stores/ui.svelte';
  import { workStore } from '$lib/stores/work.svelte';
  import { loopStore } from '$lib/stores/loop.svelte';
  import { draftsStore } from '$lib/stores/drafts.svelte';
  import { voiceStore } from '$lib/stores/voice.svelte';
  import { onMount, tick } from 'svelte';
  import SlashCommandMenu from './SlashCommandMenu.svelte';
  import MentionMenu from './MentionMenu.svelte';
  import MentionFilePicker from './MentionFilePicker.svelte';
  import MentionSymbolPicker from './MentionSymbolPicker.svelte';
  import MentionRulePicker from './MentionRulePicker.svelte';
  import MentionThreadPicker from './MentionThreadPicker.svelte';
  import TaskSplitSuggestion from './TaskSplitSuggestion.svelte';
  import VoiceInputButton from '$lib/components/voice/VoiceInputButton.svelte';
  import ModeSelector, { type ConversationMode } from './ModeSelector.svelte';
  import {
    detectMultiPartRequest,
    type DetectedTask,
    type DetectionResult,
  } from '$lib/utils/task-detector';
  import type { Attachment } from '@e/shared';

  // ── @-mention types ──
  type MentionKind = 'file' | 'symbol' | 'diagnostics' | 'rule' | 'thread';

  interface Mention {
    id: string;
    kind: MentionKind;
    label: string;
    /** Context text to inject, formatted as XML */
    context: string;
    collapsed: boolean;
  }

  let inputText = $state('');
  let textarea: HTMLTextAreaElement;
  let lastShiftTab = 0;
  let localMode = $state<ConversationMode>('normal');

  // Derive the effective mode from the active conversation or local state
  let effectiveMode = $derived<ConversationMode>(
    conversationStore.active
      ? conversationStore.active.planMode
        ? 'plan'
        : conversationStore.active.permissionMode === 'teach'
          ? 'teach'
          : 'normal'
      : localMode,
  );
  let showSlashMenu = $state(false);
  let slashQuery = $state('');
  let showDirPicker = $state(false);
  let dirOptions = $state<{ name: string; path: string }[]>([]);
  let browsedPath = $state('');
  let dirScopeEl: HTMLDivElement;
  let editingPath = $state(false);
  let pathInputValue = $state('');
  let pathInput = $state<HTMLInputElement>();
  let contextFiles = $state<Set<string>>(new Set());
  let diffPreview = $state<any>(null);
  let diffLoading = $state(false);
  let taskSuggestion = $state<DetectionResult | null>(null);
  let pendingMessage = $state('');

  // ── Attachment state ──
  let pendingAttachments = $state<Attachment[]>([]);
  let fileInput: HTMLInputElement;
  let isDragOver = $state(false);

  const ALLOWED_IMAGE_TYPES = [
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'image/svg+xml',
  ];
  const ALLOWED_MISC_EXTENSIONS = [
    '.txt',
    '.md',
    '.json',
    '.csv',
    '.xml',
    '.yaml',
    '.yml',
    '.toml',
    '.js',
    '.ts',
    '.jsx',
    '.tsx',
    '.py',
    '.rb',
    '.rs',
    '.go',
    '.java',
    '.c',
    '.cpp',
    '.h',
    '.hpp',
    '.cs',
    '.swift',
    '.kt',
    '.sh',
    '.bash',
    '.css',
    '.scss',
    '.html',
    '.sql',
    '.graphql',
    '.proto',
    '.env',
    '.log',
    '.conf',
    '.cfg',
    '.ini',
    '.diff',
    '.patch',
  ];
  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

  function isImageFile(file: File): boolean {
    return ALLOWED_IMAGE_TYPES.includes(file.type);
  }

  function isTextFile(file: File): boolean {
    if (file.type.startsWith('text/')) return true;
    const ext = '.' + file.name.split('.').pop()?.toLowerCase();
    return ALLOWED_MISC_EXTENSIONS.includes(ext);
  }

  function readFileAsBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // Strip the data URL prefix (data:image/png;base64,)
        const base64 = result.split(',')[1] || result;
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function readFileAsText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsText(file);
    });
  }

  async function processFiles(files: FileList | File[]) {
    const newAttachments: Attachment[] = [];
    for (const file of Array.from(files)) {
      if (file.size > MAX_FILE_SIZE) {
        uiStore.toast(`File "${file.name}" is too large (max 10MB)`, 'error');
        continue;
      }
      if (isImageFile(file)) {
        const base64 = await readFileAsBase64(file);
        newAttachments.push({
          type: 'image',
          name: file.name,
          mimeType: file.type,
          content: base64,
          size: file.size,
        });
      } else if (isTextFile(file)) {
        const text = await readFileAsText(file);
        newAttachments.push({
          type: 'file',
          name: file.name,
          mimeType: file.type || 'text/plain',
          content: text,
          size: file.size,
        });
      } else {
        uiStore.toast(`Unsupported file type: ${file.name}`, 'error');
      }
    }
    if (newAttachments.length > 0) {
      pendingAttachments = [...pendingAttachments, ...newAttachments];
    }
  }

  function removeAttachment(index: number) {
    pendingAttachments = pendingAttachments.filter((_, i) => i !== index);
  }

  function handleFileInputChange(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files?.length) {
      processFiles(input.files);
      input.value = ''; // reset so the same file can be re-selected
    }
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    isDragOver = true;
  }

  function handleDragLeave(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    isDragOver = false;
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    isDragOver = false;
    if (e.dataTransfer?.files?.length) {
      processFiles(e.dataTransfer.files);
    }
  }

  function handlePaste(e: ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length > 0) {
      e.preventDefault(); // prevent pasting image as text
      processFiles(files);
    }
  }

  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  // ── @-mention state ──
  let showMentionMenu = $state(false);
  let mentionQuery = $state('');
  let mentionAtPos = $state(-1); // position of '@' in inputText
  let activePicker = $state<MentionKind | null>(null);
  let mentions = $state<Mention[]>([]);

  onMount(() => {
    onFocusChatInput(() => {
      // Small delay to let Svelte finish any pending state updates (e.g. clearing active conversation)
      requestAnimationFrame(() => textarea?.focus());
    });

    // Restore any saved draft for the initial conversation on mount
    const savedDraft = draftsStore.get(conversationStore.activeId);
    if (savedDraft) {
      inputText = savedDraft;
      // Defer resize so the textarea DOM node is ready
      requestAnimationFrame(() => resizeTextarea());
    }

    // Save the current draft before page unload (refresh / close)
    function handleBeforeUnload() {
      draftsStore.save(conversationStore.activeId, inputText);
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  });

  // ── Draft persistence ──
  // Track which conversation we last restored a draft for, to avoid loops
  let lastDraftConvId = $state<string | null | undefined>(undefined);

  // Restore draft when switching conversations/tabs
  $effect(() => {
    const convId = conversationStore.activeId;
    // Only restore when the conversation actually changes (not on every render)
    if (convId === lastDraftConvId) return;

    // Save the outgoing conversation's draft before switching
    if (lastDraftConvId !== undefined) {
      draftsStore.save(lastDraftConvId, inputText);
    }

    lastDraftConvId = convId;

    // Restore draft for the incoming conversation
    const saved = draftsStore.get(convId);
    inputText = saved;
    // Defer resize so Svelte applies the binding first
    requestAnimationFrame(() => resizeTextarea());
  });

  function toggleContextFile(tabId: string) {
    const next = new Set(contextFiles);
    if (next.has(tabId)) next.delete(tabId);
    else next.add(tabId);
    contextFiles = next;
  }

  function buildContextPrefix(): string {
    const parts: string[] = [];

    // Editor tab context files (existing behaviour)
    for (const tabId of contextFiles) {
      const tab = editorStore.tabs.find((t) => t.id === tabId);
      if (tab) {
        parts.push(`<file path="${tab.filePath}">\n${tab.content}\n</file>`);
      }
    }

    // @-mention context
    for (const mention of mentions) {
      parts.push(mention.context);
    }

    return parts.length > 0 ? parts.join('\n') + '\n\n' : '';
  }

  // ── Mention helpers ──

  function closeMentionMenu() {
    showMentionMenu = false;
    activePicker = null;
    mentionAtPos = -1;
    mentionQuery = '';
  }

  function removeMentionToken() {
    // Remove the @... token from the input text
    if (mentionAtPos >= 0) {
      const before = inputText.slice(0, mentionAtPos);
      // Remove everything from '@' to end of the mention token (up to next space or end)
      const after = inputText.slice(mentionAtPos);
      const spaceIdx = after.search(/\s/);
      const remaining = spaceIdx >= 0 ? after.slice(spaceIdx) : '';
      inputText = (before + remaining).trimStart();
      resizeTextarea();
    }
    mentionAtPos = -1;
  }

  function addMention(mention: Omit<Mention, 'id' | 'collapsed'>) {
    const id = `mention-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    mentions = [...mentions, { ...mention, id, collapsed: false }];
    removeMentionToken();
    closeMentionMenu();
    textarea?.focus();
  }

  function removeMention(id: string) {
    mentions = mentions.filter((m) => m.id !== id);
  }

  function toggleMentionCollapse(id: string) {
    mentions = mentions.map((m) => (m.id === id ? { ...m, collapsed: !m.collapsed } : m));
  }

  async function handleMentionTypeSelect(type: MentionKind) {
    showMentionMenu = false;
    if (type === 'diagnostics') {
      // @diagnostics: collect all current LSP diagnostics immediately — no secondary picker
      const diagText = await collectDiagnostics();
      addMention({
        kind: 'diagnostics',
        label: '@diagnostics',
        context: `<diagnostics>\n${diagText || 'No active LSP diagnostics found.'}\n</diagnostics>`,
      });
    } else {
      activePicker = type;
    }
  }

  async function collectDiagnostics(): Promise<string> {
    // Collect cached diagnostics from open editor tabs via LSP publishDiagnostics
    // We use a short-lived subscription to gather any pending diagnostics
    const lines: string[] = [];
    // Check all open tabs and request diagnostics from the LSP
    for (const tab of editorStore.tabs) {
      const ext = tab.fileName.split('.').pop() || '';
      const langMap: Record<string, string> = {
        ts: 'typescript',
        tsx: 'typescript',
        js: 'javascript',
        jsx: 'javascript',
        py: 'python',
        rs: 'rust',
        go: 'go',
        cs: 'csharp',
        java: 'java',
      };
      const language = langMap[ext];
      if (!language) continue;
      if (!lspStore.isConnected(language)) continue;
      // Request document diagnostics
      try {
        const result = await lspStore.request(language, 'textDocument/diagnostic', {
          textDocument: { uri: `file://${tab.filePath}` },
        });
        const items = result?.items || result?.diagnostics || [];
        for (const d of items) {
          const severity = d.severity === 1 ? 'error' : d.severity === 2 ? 'warning' : 'info';
          const line = (d.range?.start?.line ?? 0) + 1;
          lines.push(`[${severity}] ${tab.filePath}:${line} — ${d.message}`);
        }
      } catch {
        // LSP may not support pull diagnostics; skip
      }
    }
    return lines.join('\n');
  }

  async function handleFileMentionSelect(filePath: string) {
    try {
      const res = await api.files.read(filePath);
      const content = res.data.content;
      const fileName = filePath.split('/').pop() || filePath;
      addMention({
        kind: 'file',
        label: `@file:${fileName}`,
        context: `<file path="${filePath}">\n${content}\n</file>`,
      });
    } catch {
      closeMentionMenu();
      textarea?.focus();
    }
  }

  function handleSymbolMentionSelect(sym: {
    name: string;
    kind: string;
    filePath: string;
    startRow: number;
    startCol: number;
  }) {
    addMention({
      kind: 'symbol',
      label: `@symbol:${sym.name}`,
      context: `<symbol name="${sym.name}" kind="${sym.kind}" file="${sym.filePath}" line="${sym.startRow + 1}" />`,
    });
  }

  function handleRuleMentionSelect(rule: { name: string; content: string; path: string }) {
    addMention({
      kind: 'rule',
      label: `@rule:${rule.name}`,
      context: `<rule name="${rule.name}">\n${rule.content}\n</rule>`,
    });
  }

  async function handleThreadMentionSelect(conv: {
    id: string;
    title: string;
    messageCount: number;
    compactSummary?: string;
  }) {
    try {
      let summaryText: string;

      if (conv.compactSummary) {
        // Use already-loaded summary from conversation list
        summaryText = conv.compactSummary;
      } else {
        // Request on-demand summary generation (LLM-based, falls back to rule-based)
        const res = await api.conversations.summarize(conv.id);
        summaryText = res.data?.summary || '';
      }

      if (!summaryText) {
        // Final fallback: pull raw messages and excerpt
        const res = await api.conversations.get(conv.id);
        const messages = res.data.messages || [];
        const userMsgs = messages.filter((m: any) => m.role === 'user');
        const assistantMsgs = messages.filter((m: any) => m.role === 'assistant');
        const firstUser = userMsgs[0]?.content?.[0]?.text || '';
        const lastAssistant = assistantMsgs[assistantMsgs.length - 1]?.content?.[0]?.text || '';
        summaryText = [
          firstUser ? `User: ${firstUser.slice(0, 300)}` : '',
          lastAssistant ? `Assistant: ${lastAssistant.slice(0, 300)}` : '',
        ]
          .filter(Boolean)
          .join('\n');
      }

      addMention({
        kind: 'thread',
        label: `@thread:${conv.title.slice(0, 30)}`,
        context: `<thread title="${conv.title}" messages="${conv.messageCount}" source="prior-conversation">\n${summaryText || 'No content available.'}\n</thread>`,
      });
    } catch {
      closeMentionMenu();
      textarea?.focus();
    }
  }

  async function detectAndParseDiff(text: string) {
    const trimmed = text.trim();
    const isGitHubUrl = /https:\/\/github\.com\/[^/]+\/[^/]+\/(pull|commit)\/\w+/.test(trimmed);
    const isRawDiff = trimmed.startsWith('diff --git') || trimmed.startsWith('---');
    if (!isGitHubUrl && !isRawDiff) return;

    diffLoading = true;
    try {
      const res = await api.diff.parse(trimmed, settingsStore.workspacePath || undefined);
      if (res.ok) diffPreview = res.data;
    } catch {
      /* ignore */
    } finally {
      diffLoading = false;
    }
  }

  function getDisplayPath(): string {
    const p = conversationStore.active?.workspacePath || settingsStore.workspacePath;
    return !p || p === '.' ? '~' : p;
  }

  function getBreadcrumbs(): { name: string; path: string }[] {
    const p = getDisplayPath();
    if (p === '~') return [{ name: '~', path: '' }];
    const parts = p.split('/').filter(Boolean);
    return parts.map((name, i) => ({
      name: i === 0 ? '/' + name : name,
      path: '/' + parts.slice(0, i + 1).join('/'),
    }));
  }

  function startEditingPath() {
    pathInputValue = settingsStore.workspacePath === '.' ? '' : settingsStore.workspacePath;
    editingPath = true;
    // Focus after Svelte renders the input
    setTimeout(() => pathInput?.focus(), 0);
  }

  function commitPathInput() {
    editingPath = false;
    const val = pathInputValue.trim();
    if (val && val !== getDisplayPath()) {
      settingsStore.update({ workspacePath: val });
      if (conversationStore.activeId) {
        api.conversations.update(conversationStore.activeId, { workspacePath: val });
        if (conversationStore.active) {
          conversationStore.active.workspacePath = val;
        }
      }
    }
  }

  async function browseDirectories(parentPath?: string) {
    try {
      const res = await api.files.directories(parentPath);
      browsedPath = res.data.parent;
      dirOptions = res.data.directories;
      showDirPicker = true;
    } catch {}
  }

  function selectDirectory(path: string) {
    settingsStore.update({ workspacePath: path });
    showDirPicker = false;
    // If mid-conversation, update the conversation's workspace path too
    if (conversationStore.activeId) {
      api.conversations.update(conversationStore.activeId, { workspacePath: path });
      if (conversationStore.active) {
        conversationStore.active.workspacePath = path;
      }
    }
  }

  async function send() {
    const text = inputText.trim();
    // Block sending if this conversation has an active stream.
    // Only block when there's an actual conversation with an active stream —
    // null === null must not count (no conversation selected, no stream target).
    const isStreamingHere =
      streamStore.isStreaming &&
      conversationStore.activeId != null &&
      streamStore.conversationId === conversationStore.activeId;
    if ((!text && pendingAttachments.length === 0) || isStreamingHere) {
      return;
    }

    // Audio feedback for chat send
    if (settingsStore.soundEnabled) chirpEngine.chirp('chat_send');

    // Intercept `cd` as directory navigation
    if (text === 'cd' || text.startsWith('cd ')) {
      const target = text.slice(2).trim();
      const current = getDisplayPath();
      let newPath: string;
      if (!target || target === '~') {
        newPath = ''; // server defaults to homedir
      } else if (target === '..') {
        newPath = current.split('/').slice(0, -1).join('/') || '/';
      } else if (target.startsWith('/')) {
        newPath = target;
      } else {
        newPath = current === '/' ? '/' + target : current + '/' + target;
      }
      // Verify directory exists via the API then select it
      try {
        const res = await api.files.directories(newPath || undefined);
        selectDirectory(res.data.parent);
      } catch {
        // Directory doesn't exist — let it fall through to Claude
        selectDirectory(newPath);
      }
      inputText = '';
      resizeTextarea();
      return;
    }

    // Intercept "show me <file>" / "open <file>" as quick file open
    const showMatch = text.match(/^(?:show\s+me|open|view)\s+(.+)$/i);
    if (showMatch) {
      const raw = showMatch[1].replace(/^["'`]+|["'`]+$/g, '').trim();
      const wsPath = conversationStore.active?.workspacePath || settingsStore.workspacePath;
      const filePath = raw.startsWith('/')
        ? raw
        : wsPath && wsPath !== '.'
          ? wsPath + '/' + raw
          : raw;
      // Verify the file exists before intercepting — if not, fall through to Claude
      try {
        await api.files.read(filePath);
        await editorStore.openFile(filePath);
        inputText = '';
        resizeTextarea();
        return;
      } catch {
        // Not a real file path — let Claude handle the message
      }
    }

    // Check for slash commands
    if (text.startsWith('/')) {
      const parts = text.split(/\s+/);
      const cmdName = parts[0].slice(1);
      const cmdArgs = parts.slice(1).join(' ');
      const ctx: SlashCommandContext = {
        conversationId: conversationStore.activeId,
        sessionId: streamStore.sessionId,
        args: cmdArgs,
      };
      const result = executeSlashCommand(cmdName, ctx);
      if (result.handled) {
        inputText = '';
        resizeTextarea();
        showSlashMenu = false;
        // If command wants to send text to Claude, fall through below
        if (!result.sendAsMessage) return;
        // Replace text with the passthrough content
        const passthroughText = result.sendAsMessage;
        if (!conversationStore.activeId) {
          await createConversation(passthroughText);
        }
        await sendAndStream(conversationStore.activeId!, passthroughText);
        return;
      }
    }

    // Check for multi-part tasks — suggest splitting into stories
    if (effectiveMode === 'normal') {
      const detection = detectMultiPartRequest(text);
      if (detection.isMultiPart && detection.tasks.length >= 2) {
        pendingMessage = text;
        taskSuggestion = detection;
        inputText = '';
        await tick();
        resizeTextarea();
        return;
      }
    }

    // Normal send
    await sendOriginalMessage(text);
  }

  /** Send a message through the normal flow (conversation creation + stream). */
  async function sendOriginalMessage(text: string) {
    // Capture the draft key BEFORE conversation creation may change activeId
    const draftKey = conversationStore.activeId;

    if (!conversationStore.activeId) {
      await createConversation(text);
    }

    const contextPrefix = buildContextPrefix();
    const diffContext = diffPreview ? diffPreview.contextBlock + '\n\n' : '';
    diffPreview = null;

    // Build text file context as @-mention style context prefix
    let fileAttachmentContext = '';
    const imageAttachments = pendingAttachments.filter((a) => a.type === 'image');
    const textAttachments = pendingAttachments.filter((a) => a.type === 'file');
    for (const att of textAttachments) {
      fileAttachmentContext += `<attached-file name="${att.name}">\n${att.content}\n</attached-file>\n\n`;
    }

    inputText = '';
    contextFiles = new Set();
    mentions = [];
    // Clear draft for the original tab (may differ from activeId after conversation creation)
    draftsStore.clear(draftKey);
    draftsStore.clear(conversationStore.activeId);
    // Sync lastDraftConvId so the $effect doesn't re-save the old draft
    lastDraftConvId = conversationStore.activeId;
    // Wait for Svelte to flush the empty inputText to the DOM, then resize
    await tick();
    resizeTextarea();

    const attachmentsToSend = imageAttachments.length > 0 ? imageAttachments : undefined;
    pendingAttachments = [];

    // Pass voice message metadata if this was from voice input
    const metadata = isVoiceMessage ? { isVoiceMessage: true } : undefined;
    isVoiceMessage = false; // Reset for next message

    await sendAndStream(
      conversationStore.activeId!,
      diffContext + contextPrefix + fileAttachmentContext + text,
      attachmentsToSend,
      metadata,
    );
  }

  // ── Task split suggestion handlers ──

  async function handleTaskConfirm(tasks: DetectedTask[]) {
    const workspacePath = workspaceListStore.activeWorkspace?.path || settingsStore.workspacePath;
    if (!workspacePath) return;

    const selected = tasks.filter((t) => t.selected);
    const result = await workStore.createStandaloneStories(
      workspacePath,
      selected.map((t) => ({ title: t.text })),
    );

    uiStore.toast(`Created ${result.created} stories`, 'success');
    uiStore.setSidebarTab('work');

    taskSuggestion = null;
    pendingMessage = '';
  }

  async function handleTaskConfirmAndLoop(tasks: DetectedTask[]) {
    await handleTaskConfirm(tasks);
    // Clear PRD selection so loop runs on the newly created standalone stories
    loopStore.setSelectedPrdId(null);
    // Open loop config so user can configure and start (only if no loop is already running)
    if (!loopStore.isActive) {
      uiStore.openModal('loop-config');
    }
  }

  function handleTaskDismiss() {
    const text = pendingMessage;
    taskSuggestion = null;
    pendingMessage = '';
    sendOriginalMessage(text);
  }

  function handleToggleTask(index: number) {
    if (!taskSuggestion) return;
    const updated = [...taskSuggestion.tasks];
    updated[index] = { ...updated[index], selected: !updated[index].selected };
    taskSuggestion = { ...taskSuggestion, tasks: updated };
  }

  function handleEditTask(index: number, newText: string) {
    if (!taskSuggestion) return;
    const updated = [...taskSuggestion.tasks];
    updated[index] = { ...updated[index], text: newText };
    taskSuggestion = { ...taskSuggestion, tasks: updated };
  }

  async function createConversation(text: string) {
    // Use active workspace path if available, otherwise fall back to settings
    const workspacePath =
      workspaceListStore.activeWorkspace?.path ||
      (settingsStore.workspacePath !== '.' ? settingsStore.workspacePath : undefined);
    const res = await api.conversations.create({
      title: text.slice(0, 60),
      model: settingsStore.model,
      workspacePath,
      permissionMode: localMode === 'teach' ? 'teach' : settingsStore.permissionMode,
      effort: settingsStore.effort,
      maxBudgetUsd: settingsStore.maxBudgetUsd ?? undefined,
      maxTurns: settingsStore.maxTurns ?? undefined,
      planMode: localMode === 'plan' || undefined,
    });
    const convRes = await api.conversations.get(res.data.id);
    conversationStore.setActive(convRes.data);
    conversationStore.prependConversation({
      id: convRes.data.id,
      title: convRes.data.title,
      createdAt: convRes.data.createdAt,
      updatedAt: convRes.data.updatedAt,
      messageCount: 0,
      model: convRes.data.model,
    });
    localMode = 'normal';
  }

  /** Apply a conversation mode — handles both active-conversation and pre-conversation state. */
  function applyMode(newMode: ConversationMode) {
    if (conversationStore.active) {
      const planMode = newMode === 'plan';
      const permissionMode =
        newMode === 'teach'
          ? 'teach'
          : conversationStore.active.permissionMode === 'teach'
            ? settingsStore.permissionMode
            : conversationStore.active.permissionMode;

      conversationStore.setPlanMode(planMode);
      conversationStore.setActive({
        ...conversationStore.active,
        planMode,
        permissionMode,
      });

      if (conversationStore.activeId) {
        api.conversations.update(conversationStore.activeId, { planMode, permissionMode });
      }
    } else {
      localMode = newMode;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    // Musical typing — play a pentatonic note for each printable keystroke
    if (
      settingsStore.soundEnabled &&
      settingsStore.keyboardSounds &&
      e.key.length === 1 &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey
    ) {
      chirpEngine.playKeystroke();
    }

    // Send: Enter (default) or Ctrl+Enter depending on setting
    if (e.key === 'Enter') {
      if (settingsStore.sendWithEnter) {
        // Enter sends, Shift+Enter for newline
        if (!e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          send();
          return;
        }
      } else {
        // Ctrl/Cmd+Enter sends, plain Enter for newline
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          send();
          return;
        }
      }
    }

    // Shift+Tab x2: cycle mode Normal → Plan → Teach → Normal
    if (e.shiftKey && e.key === 'Tab') {
      e.preventDefault();
      const now = Date.now();
      if (now - lastShiftTab < 500) {
        lastShiftTab = 0;
        const cycle: ConversationMode[] = ['normal', 'plan', 'teach'];
        const nextMode = cycle[(cycle.indexOf(effectiveMode) + 1) % cycle.length];
        applyMode(nextMode);
      } else {
        lastShiftTab = now;
      }
      return;
    }

    // Slash command detection
    if (e.key === '/' && inputText === '') {
      showSlashMenu = true;
      slashQuery = '';
    }

    // @-mention detection
    if (e.key === '@') {
      const cursorPos = textarea?.selectionStart ?? inputText.length;
      // Show mention menu when @ is typed (at any position)
      showMentionMenu = true;
      mentionQuery = '';
      mentionAtPos = cursorPos;
      // Don't prevent default so @ gets inserted into input
    }

    // Escape: cancel streaming or close menus
    if (e.key === 'Escape') {
      if (activePicker) {
        activePicker = null;
        textarea?.focus();
      } else if (showMentionMenu) {
        closeMentionMenu();
      } else if (showSlashMenu) {
        showSlashMenu = false;
      } else if (
        streamStore.isStreaming &&
        streamStore.conversationId === conversationStore.activeId &&
        conversationStore.activeId
      ) {
        cancelStream(conversationStore.activeId);
      }
    }

    // Backspace: if we just deleted the @, close the mention menu
    if (e.key === 'Backspace' && showMentionMenu) {
      const cursorPos = textarea?.selectionStart ?? 0;
      if (cursorPos <= mentionAtPos) {
        closeMentionMenu();
      }
    }
  }

  function handleInput() {
    resizeTextarea();
    // Persist draft as user types
    draftsStore.save(conversationStore.activeId, inputText);
    // Slash command filtering
    if (inputText.startsWith('/')) {
      showSlashMenu = true;
      slashQuery = inputText.slice(1);
    } else {
      showSlashMenu = false;
    }

    // Update mention menu query as user types after '@'
    if (showMentionMenu && mentionAtPos >= 0) {
      const cursorPos = textarea?.selectionStart ?? inputText.length;
      if (cursorPos > mentionAtPos) {
        // Extract query text after '@'
        const textAfterAt = inputText.slice(mentionAtPos + 1, cursorPos);
        // If there's a space, the mention token ended — close menu
        if (/\s/.test(textAfterAt)) {
          closeMentionMenu();
        } else {
          mentionQuery = textAfterAt;
        }
      } else {
        // Cursor went back before '@'
        closeMentionMenu();
      }
    }

    // Detect if the entire input is a diff/URL and show preview
    if (inputText.trim().length > 10) {
      detectAndParseDiff(inputText.trim());
    } else {
      diffPreview = null;
    }
  }

  function resizeTextarea() {
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 300) + 'px';
  }

  // Track if the current message is from voice input
  let isVoiceMessage = $state(false);

  function handleVoiceTranscript(text: string, isWakeWord = false) {
    // Mark this as a voice message
    isVoiceMessage = true;

    if (isWakeWord) {
      // For wake word triggered input, replace the entire input
      inputText = text;
    } else {
      // For push-to-talk, append to existing text
      inputText = inputText ? inputText + ' ' + text : text;
    }

    resizeTextarea();
    draftsStore.save(conversationStore.activeId, inputText);

    // If auto-send is enabled for wake word mode, send the message
    if (isWakeWord && voiceStore.autoSpeak) {
      send();
    }
  }

  // Register voice transcript callback
  $effect(() => {
    voiceStore.setTranscriptCallback(handleVoiceTranscript);
  });

  function selectSlashCommand(command: string) {
    // For commands that need args (theme, model, permissions), put them in the input
    const needsArgs = ['theme', 'model', 'permissions'];
    if (needsArgs.includes(command)) {
      inputText = `/${command} `;
      showSlashMenu = false;
      textarea?.focus();
      return;
    }

    // For no-arg commands, execute immediately
    inputText = `/${command}`;
    showSlashMenu = false;
    send();
  }
</script>

<svelte:window
  onclick={(e) => {
    if (showDirPicker && dirScopeEl && !dirScopeEl.contains(e.target as Node)) {
      showDirPicker = false;
    }
  }}
/>

<!-- Hidden file input for upload button -->
<input
  bind:this={fileInput}
  type="file"
  multiple
  accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml,.txt,.md,.json,.csv,.xml,.yaml,.yml,.toml,.js,.ts,.jsx,.tsx,.py,.rb,.rs,.go,.java,.c,.cpp,.h,.hpp,.cs,.swift,.kt,.sh,.bash,.css,.scss,.html,.sql,.graphql,.proto,.env,.log,.conf,.cfg,.ini,.diff,.patch"
  style="display: none"
  onchange={handleFileInputChange}
/>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="chat-input-container"
  class:drag-over={isDragOver}
  ondragover={handleDragOver}
  ondragleave={handleDragLeave}
  ondrop={handleDrop}
>
  {#if showSlashMenu}
    <SlashCommandMenu
      query={slashQuery}
      onSelect={selectSlashCommand}
      onClose={() => (showSlashMenu = false)}
    />
  {/if}

  {#if showMentionMenu && !activePicker}
    <MentionMenu
      query={mentionQuery}
      onSelect={handleMentionTypeSelect}
      onClose={closeMentionMenu}
    />
  {/if}

  {#if activePicker === 'file'}
    <MentionFilePicker onSelect={handleFileMentionSelect} onClose={closeMentionMenu} />
  {:else if activePicker === 'symbol'}
    <MentionSymbolPicker onSelect={handleSymbolMentionSelect} onClose={closeMentionMenu} />
  {:else if activePicker === 'rule'}
    <MentionRulePicker onSelect={handleRuleMentionSelect} onClose={closeMentionMenu} />
  {:else if activePicker === 'thread'}
    <MentionThreadPicker onSelect={handleThreadMentionSelect} onClose={closeMentionMenu} />
  {/if}

  {#if diffLoading}
    <div class="diff-detecting">Detecting diff...</div>
  {:else if diffPreview}
    <div class="diff-preview">
      <div class="diff-preview-header">
        <span class="diff-type-badge">{diffPreview.type.replace('_', ' ')}</span>
        {#if diffPreview.title}<span class="diff-title">{diffPreview.title}</span>{/if}
        <span class="diff-stats">
          {diffPreview.summary.filesChanged} files
          <span class="insertions">+{diffPreview.summary.insertions}</span>
          <span class="deletions">-{diffPreview.summary.deletions}</span>
        </span>
        <button class="diff-dismiss" onclick={() => (diffPreview = null)}>×</button>
      </div>
      <div class="diff-files">
        {#each diffPreview.files.slice(0, 5) as f}
          <span class="diff-file">{f.path}</span>
        {/each}
        {#if diffPreview.files.length > 5}
          <span class="diff-more">+{diffPreview.files.length - 5} more</span>
        {/if}
      </div>
    </div>
  {/if}

  {#if taskSuggestion}
    <TaskSplitSuggestion
      tasks={taskSuggestion.tasks}
      onConfirm={handleTaskConfirm}
      onConfirmAndLoop={handleTaskConfirmAndLoop}
      onDismiss={handleTaskDismiss}
      onToggleTask={handleToggleTask}
      onEditTask={handleEditTask}
    />
  {/if}

  <div class="dir-scope" bind:this={dirScopeEl}>
    <div class="dir-breadcrumbs">
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        ><path
          d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"
        /></svg
      >
      {#if editingPath}
        <input
          class="dir-path-input"
          bind:this={pathInput}
          bind:value={pathInputValue}
          onkeydown={(e) => {
            if (e.key === 'Enter') {
              commitPathInput();
            }
            if (e.key === 'Escape') {
              editingPath = false;
            }
          }}
          onblur={() => commitPathInput()}
        />
      {:else}
        {#each getBreadcrumbs() as crumb, i}
          {#if i > 0}<span class="breadcrumb-sep">/</span>{/if}
          <button class="breadcrumb" onclick={() => browseDirectories(crumb.path)}
            >{crumb.name}</button
          >
        {/each}
        <button class="breadcrumb-edit" onclick={startEditingPath} title="Type a path">
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            ><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path
              d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"
            /></svg
          >
        </button>
      {/if}
    </div>
    {#if showDirPicker}
      <div class="dir-picker">
        {#if browsedPath !== '/'}
          <button
            class="dir-option"
            onclick={() => {
              const parent = browsedPath.split('/').slice(0, -1).join('/') || '/';
              browseDirectories(parent);
            }}>..</button
          >
        {/if}
        <button class="dir-option dir-select" onclick={() => selectDirectory(browsedPath)}>
          Select this directory
        </button>
        {#each dirOptions as dir}
          <button class="dir-option" onclick={() => browseDirectories(dir.path)}>
            {dir.name}/
          </button>
        {/each}
      </div>
    {/if}
  </div>

  {#if mentions.length > 0}
    <div class="mention-badges">
      {#each mentions as mention (mention.id)}
        <div class="mention-badge" class:collapsed={mention.collapsed}>
          <button
            class="mention-badge-label"
            onclick={() => toggleMentionCollapse(mention.id)}
            title={mention.collapsed ? 'Expand context' : 'Collapse context'}
          >
            <span class="mention-badge-kind">{mention.label}</span>
            <span class="mention-badge-arrow"
              ><svg
                width="8"
                height="8"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="3"
                stroke-linecap="round"
                stroke-linejoin="round"
                style="transform: rotate({mention.collapsed
                  ? '0deg'
                  : '90deg'}); transition: transform 0.15s ease"
                ><polyline points="9 18 15 12 9 6" /></svg
              ></span
            >
          </button>
          {#if !mention.collapsed}
            <div class="mention-badge-preview">
              <pre class="mention-context-text">{mention.context.slice(0, 300)}{mention.context
                  .length > 300
                  ? '…'
                  : ''}</pre>
            </div>
          {/if}
          <button
            class="mention-badge-remove"
            onclick={() => removeMention(mention.id)}
            title="Remove mention">×</button
          >
        </div>
      {/each}
    </div>
  {/if}

  {#if editorStore.tabs.length > 0}
    <div class="context-chips">
      {#each editorStore.tabs as tab}
        <button
          class="context-chip"
          class:active={contextFiles.has(tab.id)}
          onclick={() => toggleContextFile(tab.id)}
          title={tab.filePath}
        >
          {tab.fileName}
        </button>
      {/each}
    </div>
  {/if}

  {#if pendingAttachments.length > 0}
    <div class="attachment-previews">
      {#each pendingAttachments as att, i}
        <div
          class="attachment-preview"
          class:image={att.type === 'image'}
          class:file={att.type === 'file'}
        >
          {#if att.type === 'image' && att.content}
            <img
              src="data:{att.mimeType};base64,{att.content}"
              alt={att.name}
              class="attachment-thumb"
            />
          {:else}
            <div class="attachment-file-icon">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                ><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline
                  points="14 2 14 8 20 8"
                /></svg
              >
            </div>
          {/if}
          <div class="attachment-info">
            <span class="attachment-name" title={att.name}>{att.name}</span>
            {#if att.size}
              <span class="attachment-size">{formatFileSize(att.size)}</span>
            {/if}
          </div>
          <button
            class="attachment-remove"
            onclick={() => removeAttachment(i)}
            title="Remove attachment"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              ><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg
            >
          </button>
        </div>
      {/each}
    </div>
  {/if}

  {#if isDragOver}
    <div class="drag-overlay">
      <div class="drag-overlay-content">
        <svg
          width="32"
          height="32"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          ><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline
            points="17 8 12 3 7 8"
          /><line x1="12" y1="3" x2="12" y2="15" /></svg
        >
        <span>Drop files to attach</span>
      </div>
    </div>
  {/if}

  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="input-wrapper"
    class:plan-active={effectiveMode === 'plan'}
    class:teach-active={effectiveMode === 'teach'}
    onmousedown={(e) => {
      if (e.target !== textarea) {
        e.preventDefault();
        textarea?.focus();
      }
    }}
  >
    <button
      class="btn-icon-sm attach-btn"
      onclick={() => fileInput?.click()}
      title="Attach files (images, code, text)"
      ><svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        ><path
          d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"
        /></svg
      ></button
    >

    <ModeSelector mode={effectiveMode} onchange={applyMode} />

    <textarea
      bind:this={textarea}
      bind:value={inputText}
      onkeydown={handleKeydown}
      oninput={handleInput}
      onpaste={handlePaste}
      placeholder={effectiveMode === 'plan'
        ? 'Describe what you want to plan...'
        : effectiveMode === 'teach'
          ? 'What would you like to learn?'
          : 'Message E...'}
      rows="1"
      disabled={streamStore.status === 'tool_pending'}
    ></textarea>

    <div class="input-actions">
      {#if effectiveMode !== 'normal'}
        <span
          class="mode-indicator"
          class:plan={effectiveMode === 'plan'}
          class:teach={effectiveMode === 'teach'}
        >
          {effectiveMode === 'plan' ? 'PLAN' : 'TEACH'}
        </span>
      {/if}

      <VoiceInputButton />

      {#if streamStore.isStreaming && conversationStore.activeId != null && streamStore.conversationId === conversationStore.activeId}
        <button
          class="btn-action cancel"
          onclick={() => conversationStore.activeId && cancelStream(conversationStore.activeId)}
          title="Cancel (Esc)"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" />
          </svg>
        </button>
      {:else}
        <button
          class="btn-action send"
          onclick={send}
          disabled={!inputText.trim() && pendingAttachments.length === 0}
          title={settingsStore.sendWithEnter ? 'Send (Enter)' : 'Send (Ctrl+Enter)'}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
          </svg>
        </button>
      {/if}
    </div>
  </div>
</div>

<style>
  .chat-input-container {
    position: relative;
    margin: 12px 28px 20px;
    border: var(--ht-input-border-width) var(--ht-input-border-style) var(--border-primary);
    border-radius: var(--radius);
    z-index: 1;
  }

  /* Backdrop blur on a pseudo-element so that absolutely-positioned children
     (slash menu, mention picker, mode selector, etc.) aren't trapped inside
     the compositing layer that backdrop-filter creates. */
  .chat-input-container::before {
    content: '';
    position: absolute;
    inset: 0;
    background: color-mix(in srgb, var(--bg-primary) 50%, transparent);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border-radius: inherit;
    z-index: -1;
    pointer-events: none;
  }

  .dir-scope {
    position: relative;
    margin-bottom: 6px;
  }
  .dir-breadcrumbs {
    display: flex;
    align-items: center;
    gap: 2px;
    font-size: var(--fs-sm);
    color: var(--text-tertiary);
    padding: 4px 8px;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .dir-breadcrumbs::-webkit-scrollbar {
    display: none;
  }
  .breadcrumb {
    color: var(--text-tertiary);
    font-size: var(--fs-sm);
    padding: 1px 4px;
    border-radius: var(--radius-sm);
    white-space: nowrap;
    transition: all var(--transition);
  }
  .breadcrumb:hover {
    color: var(--accent-primary);
    background: var(--bg-hover);
  }
  .breadcrumb-sep {
    color: var(--text-tertiary);
    opacity: 0.4;
    margin: 0 1px;
  }
  .breadcrumb-edit {
    color: var(--text-tertiary);
    opacity: 0.4;
    padding: 2px 4px;
    margin-left: 4px;
    border-radius: var(--radius-sm);
    transition: all var(--transition);
  }
  .breadcrumb-edit:hover {
    opacity: 1;
    color: var(--accent-primary);
    background: var(--bg-hover);
  }
  .dir-path-input {
    flex: 1;
    font-size: var(--fs-sm);
    font-family: var(--font-family-mono, monospace);
    color: var(--text-primary);
    background: var(--bg-input);
    border: 1px solid var(--accent-primary);
    border-radius: var(--radius-sm);
    padding: 2px 8px;
    margin-left: 6px;
    outline: none;
  }

  .dir-picker {
    position: absolute;
    bottom: 100%;
    left: 0;
    right: 0;
    max-height: 240px;
    overflow-y: auto;
    background: var(--bg-elevated);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius);
    padding: 4px;
    z-index: 10;
    box-shadow: var(--shadow-lg);
  }
  .dir-option {
    display: block;
    width: 100%;
    text-align: left;
    padding: 6px 10px;
    font-size: var(--fs-sm);
    color: var(--text-secondary);
    border-radius: var(--radius-sm);
    transition: all var(--transition);
  }
  .dir-option:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .dir-option.dir-select {
    color: var(--accent-primary);
    font-weight: 600;
  }

  .context-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 6px;
    padding: 0 4px;
  }
  .context-chip {
    font-size: var(--fs-xs);
    padding: 2px 10px;
    border-radius: 999px;
    border: 1px solid var(--border-secondary);
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    cursor: pointer;
    transition: all var(--transition);
    white-space: nowrap;
  }
  .context-chip:hover {
    border-color: var(--accent-primary);
    color: var(--text-primary);
  }
  .context-chip.active {
    background: var(--bg-active);
    border-color: var(--accent-primary);
    color: var(--accent-primary);
    font-weight: 600;
  }

  .input-wrapper {
    display: flex;
    align-items: center;
    gap: 10px;
    background: transparent;
    border: none;
    border-radius: var(--radius);
    padding: var(--ht-input-padding);
    transition: all var(--transition);
    cursor: text;
    outline: none;
  }
  .input-wrapper:focus-within {
    border: none;
    box-shadow: none;
    outline: none;
  }
  .input-wrapper.plan-active {
    border: none;
    box-shadow: none;
    outline: none;
  }
  .input-wrapper.plan-active:focus-within {
    border: none;
    box-shadow: none;
    outline: none;
  }

  /* ── Hypertheme input variants ── */

  /* Ethereal */
  :global([data-hypertheme='ethereal']) .input-wrapper {
    border-radius: var(--radius-xl);
  }

  /* Arcane */
  :global([data-hypertheme='arcane']) .input-wrapper {
    background: transparent;
  }

  /* Astral */
  :global([data-hypertheme='astral']) .input-wrapper,
  :global([data-hypertheme='astral-midnight']) .input-wrapper {
    background: transparent;
  }

  /* Study */
  :global([data-hypertheme='study']) .input-wrapper {
    background: transparent;
  }

  textarea {
    flex: 1;
    border: none;
    background: transparent;
    resize: none;
    font-family: var(--font-family-sans);
    font-size: var(--font-size-sans);
    font-weight: 500;
    line-height: 1.5;
    color: var(--text-primary);
    min-height: 24px;
    max-height: 300px;
    padding: 0;
    outline: none;
    box-shadow: none;
    letter-spacing: 0.3px;
  }
  textarea:focus {
    outline: none;
    box-shadow: none;
  }
  textarea::placeholder {
    color: var(--text-tertiary);
    letter-spacing: 0.5px;
  }
  textarea:disabled {
    opacity: 0.4;
  }

  .attach-btn {
    flex-shrink: 0;
  }

  .input-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  .mode-indicator {
    font-size: var(--fs-xxs);
    font-weight: 700;
    padding: 2px 10px;
    border-radius: var(--radius-sm);
    color: var(--text-on-accent);
    letter-spacing: var(--ht-label-spacing);
    text-transform: var(--ht-label-transform);
  }
  .mode-indicator.plan {
    background: var(--accent-warning);
  }
  .mode-indicator.teach {
    background: var(--accent-secondary, #10b981);
  }
  .btn-icon-sm {
    font-size: var(--fs-md);
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-sm);
    transition: all var(--transition);
    color: var(--text-tertiary);
    opacity: 0.6;
  }
  .btn-icon-sm:hover,
  .btn-icon-sm.active {
    opacity: 1;
    background: var(--bg-hover);
  }

  .btn-action {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    border-radius: var(--radius);
    border: 1px solid transparent;
    transition: all var(--transition);
  }
  .btn-action:disabled {
    opacity: 0.2;
    cursor: not-allowed;
  }

  .btn-action.send {
    color: var(--text-tertiary);
  }
  .btn-action.send:hover:not(:disabled) {
    color: var(--accent-primary);
    border-color: var(--accent-primary);
    background: var(--bg-hover);
    box-shadow: var(--shadow-glow-sm);
  }

  .btn-action.cancel {
    color: var(--accent-error);
  }
  .btn-action.cancel:hover {
    border-color: var(--accent-error);
    background: var(--bg-hover);
    box-shadow: var(--shadow-glow-sm);
  }

  .diff-detecting {
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
    padding: 4px 8px;
    animation: pulse 1s infinite;
  }
  .diff-preview {
    margin-bottom: 8px;
    padding: 8px 12px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-primary);
    border-left: 3px solid var(--accent-primary);
    border-radius: var(--radius-sm);
    font-size: var(--fs-sm);
  }
  .diff-preview-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
  }
  .diff-type-badge {
    font-size: var(--fs-xxs);
    font-weight: 700;
    text-transform: uppercase;
    padding: 1px 6px;
    background: var(--bg-active);
    color: var(--accent-primary);
    border-radius: var(--radius-sm);
  }
  .diff-title {
    flex: 1;
    color: var(--text-primary);
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .diff-stats {
    color: var(--text-tertiary);
    font-size: var(--fs-xs);
    margin-left: auto;
    display: flex;
    gap: 6px;
  }
  .insertions {
    color: #22c55e;
  }
  .deletions {
    color: #ef4444;
  }
  .diff-dismiss {
    color: var(--text-tertiary);
    font-size: var(--fs-lg);
    padding: 0 4px;
    margin-left: 4px;
  }
  .diff-dismiss:hover {
    color: var(--text-primary);
  }
  .diff-files {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .diff-file {
    font-size: var(--fs-xxs);
    font-family: var(--font-family);
    color: var(--text-secondary);
    background: var(--bg-hover);
    padding: 1px 6px;
    border-radius: var(--radius-sm);
  }
  .diff-more {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    padding: 1px 6px;
  }

  /* ── @-mention badges ── */
  .mention-badges {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 6px;
    padding: 0 4px;
  }

  .mention-badge {
    background: var(--bg-tertiary);
    border: 1px solid var(--border-secondary);
    border-left: 3px solid var(--accent-primary);
    border-radius: var(--radius-sm);
    font-size: var(--fs-sm);
    overflow: hidden;
    transition: border-color var(--transition);
  }
  .mention-badge:hover {
    border-color: var(--accent-primary);
  }

  .mention-badge-label {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 4px 8px;
    text-align: left;
    cursor: pointer;
    background: transparent;
  }
  .mention-badge-label:hover {
    background: var(--bg-hover);
  }

  .mention-badge-kind {
    font-weight: 600;
    color: var(--accent-primary);
    font-size: var(--fs-xs);
    flex: 1;
  }

  .mention-badge-arrow {
    display: flex;
    align-items: center;
    color: var(--text-tertiary);
    flex-shrink: 0;
  }

  .mention-badge-preview {
    padding: 4px 8px 6px;
    border-top: 1px solid var(--border-secondary);
  }

  .mention-context-text {
    font-family: var(--font-family-mono, monospace);
    font-size: var(--fs-xxs);
    color: var(--text-secondary);
    white-space: pre-wrap;
    word-break: break-all;
    margin: 0;
    max-height: 80px;
    overflow: hidden;
    line-height: 1.4;
  }

  .mention-badge-remove {
    position: absolute;
    top: 3px;
    right: 4px;
    color: var(--text-tertiary);
    font-size: var(--fs-md);
    line-height: 1;
    padding: 0 3px;
    opacity: 0;
    transition: opacity var(--transition);
  }
  .mention-badge {
    position: relative;
  }
  .mention-badge:hover .mention-badge-remove {
    opacity: 1;
  }
  .mention-badge-remove:hover {
    color: var(--accent-error);
  }

  /* ── Attachment previews ── */
  .attachment-previews {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 8px;
    padding: 0 4px;
  }

  .attachment-preview {
    position: relative;
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius);
    padding: 6px 28px 6px 6px;
    max-width: 220px;
    overflow: hidden;
    transition: border-color var(--transition);
  }
  .attachment-preview:hover {
    border-color: var(--accent-primary);
  }

  .attachment-preview.image {
    flex-direction: column;
    padding: 4px 4px 6px;
    max-width: 140px;
    align-items: stretch;
  }

  .attachment-thumb {
    width: 100%;
    max-height: 100px;
    object-fit: cover;
    border-radius: var(--radius-sm);
    background: var(--bg-secondary);
  }

  .attachment-file-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    flex-shrink: 0;
    background: var(--bg-hover);
    border-radius: var(--radius-sm);
    color: var(--text-tertiary);
  }

  .attachment-info {
    display: flex;
    flex-direction: column;
    gap: 1px;
    overflow: hidden;
    min-width: 0;
  }

  .attachment-name {
    font-size: var(--fs-xs);
    font-weight: 500;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .attachment-size {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
  }

  .attachment-remove {
    position: absolute;
    top: 4px;
    right: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--bg-elevated);
    color: var(--text-tertiary);
    border: 1px solid var(--border-secondary);
    cursor: pointer;
    opacity: 0;
    transition: all var(--transition);
  }
  .attachment-preview:hover .attachment-remove {
    opacity: 1;
  }
  .attachment-remove:hover {
    color: var(--accent-error);
    border-color: var(--accent-error);
    background: var(--bg-hover);
  }

  /* ── Drag overlay ── */
  .chat-input-container {
    position: relative;
  }

  .chat-input-container.drag-over {
    outline: 2px dashed var(--accent-primary);
    outline-offset: -2px;
    border-radius: var(--radius);
  }

  .drag-overlay {
    position: absolute;
    inset: 0;
    background: color-mix(in srgb, var(--bg-primary) 85%, transparent);
    border-radius: var(--radius);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 20;
    pointer-events: none;
  }

  .drag-overlay-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    color: var(--accent-primary);
    font-size: var(--fs-sm);
    font-weight: 600;
    letter-spacing: 0.5px;
  }

  /* Mobile-responsive styles for remote access */
  @media (max-width: 768px) {
    .chat-input-wrapper {
      padding: 8px;
    }

    .input-container {
      min-height: 40px;
    }

    .input-actions {
      gap: 4px;
    }

    .toolbar-btn {
      padding: 4px;
    }

    .context-chips {
      gap: 4px;
      flex-wrap: wrap;
    }

    .context-chip {
      font-size: 11px;
      padding: 3px 6px;
    }
  }

  @media (max-width: 480px) {
    .chat-input-wrapper {
      padding: 6px;
    }

    .input-actions {
      gap: 2px;
    }

    .toolbar-btn {
      width: 32px;
      height: 32px;
    }
  }
</style>
