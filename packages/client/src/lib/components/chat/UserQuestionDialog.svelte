<script lang="ts">
  import { streamStore } from '$lib/stores/stream.svelte';
  import { conversationStore } from '$lib/stores/conversation.svelte';
  import { api } from '$lib/api/client';
  import type { PendingQuestion } from '$lib/stores/stream.svelte';

  let { question } = $props<{ question: PendingQuestion }>();

  let responding = $state(false);
  /** Track selected option per question index */
  let selections = $state<Record<number, string>>({});

  function selectOption(questionIndex: number, label: string, multiSelect?: boolean) {
    if (responding) return;
    if (multiSelect) {
      // Toggle for multi-select
      const current = selections[questionIndex];
      if (current === label) {
        const next = { ...selections };
        delete next[questionIndex];
        selections = next;
      } else {
        selections = { ...selections, [questionIndex]: label };
      }
    } else {
      selections = { ...selections, [questionIndex]: label };
    }
  }

  /** True when every question has a selection */
  let allAnswered = $derived(
    question.questions.every((_q: any, i: number) => selections[i] !== undefined),
  );

  async function submit() {
    if (responding || !allAnswered) return;
    responding = true;

    // Build answers object keyed by question header or index
    const answers: Record<string, string> = {};
    for (let i = 0; i < question.questions.length; i++) {
      const key = question.questions[i].header || `q${i}`;
      answers[key] = selections[i];
    }

    const convId = conversationStore.active?.id;
    const sessionId = streamStore.sessionId;
    if (convId && sessionId) {
      try {
        await api.stream.answerQuestion(convId, sessionId, question.toolCallId, answers);
      } catch (err) {
        console.error('[UserQuestionDialog] Failed to submit answer:', err);
        responding = false;
        return;
      }
    }

    // Only dismiss the dialog after the answer has been successfully sent
    streamStore.resolveQuestion(question.toolCallId);
  }
</script>

<div class="question-dialog">
  <div class="question-header">
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
    <span class="question-title">Claude has a question</span>
  </div>

  {#each question.questions as q, qi}
    <div class="question-body">
      {#if q.header}
        <span class="question-badge">{q.header}</span>
      {/if}
      <p class="question-text">{q.question}</p>

      {#if q.options && q.options.length > 0}
        <div class="question-options">
          {#each q.options as opt}
            {@const isSelected = selections[qi] === opt.label}
            <button
              class="question-option"
              class:selected={isSelected}
              onclick={() => selectOption(qi, opt.label, q.multiSelect)}
              disabled={responding}
            >
              <span class="option-radio">
                {#if isSelected}
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"><path d="M20 6L9 17l-5-5" /></svg
                  >
                {:else}
                  ○
                {/if}
              </span>
              <div class="option-body">
                <span class="option-label">{opt.label}</span>
                {#if opt.description}
                  <span class="option-desc">{opt.description}</span>
                {/if}
              </div>
            </button>
          {/each}
        </div>
      {/if}
    </div>
  {/each}

  <div class="question-actions">
    <button class="btn btn-submit" onclick={submit} disabled={responding || !allAnswered}>
      {responding ? 'Submitting...' : 'Submit'}
    </button>
  </div>
</div>

<style>
  .question-dialog {
    border: 2px solid var(--accent-primary);
    border-radius: var(--radius);
    overflow: hidden;
    background: var(--bg-elevated);
  }

  .question-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: var(--bg-tertiary);
    color: var(--accent-primary);
    font-size: var(--fs-base);
    font-weight: 600;
  }

  .question-title {
    letter-spacing: var(--ht-label-spacing);
  }

  .question-body {
    padding: 12px;
  }

  .question-badge {
    display: inline-block;
    font-size: var(--fs-xxs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 2px 7px;
    background: color-mix(in srgb, var(--accent-primary) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent-primary) 25%, transparent);
    color: var(--accent-primary);
    border-radius: 3px;
    margin-bottom: 6px;
  }

  .question-text {
    font-size: var(--fs-base);
    line-height: 1.5;
    color: var(--text-primary);
    font-weight: 500;
    margin: 4px 0 10px;
  }

  .question-options {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .question-option {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    padding: 8px 12px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-secondary);
    background: var(--bg-tertiary);
    transition: all var(--transition);
    cursor: pointer;
    text-align: left;
    width: 100%;
  }
  .question-option:hover:not(:disabled) {
    border-color: var(--accent-primary);
    background: color-mix(in srgb, var(--accent-primary) 5%, var(--bg-tertiary));
  }
  .question-option.selected {
    border-color: var(--accent-secondary);
    background: color-mix(in srgb, var(--accent-secondary) 8%, var(--bg-tertiary));
  }
  .question-option:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .option-radio {
    flex-shrink: 0;
    font-size: var(--fs-sm);
    line-height: 18px;
    color: var(--text-tertiary);
    display: flex;
    align-items: center;
    width: 14px;
    justify-content: center;
  }
  .question-option.selected .option-radio {
    color: var(--accent-secondary);
  }

  .option-body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .option-label {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-primary);
  }
  .question-option.selected .option-label {
    color: var(--accent-secondary);
  }

  .option-desc {
    font-size: var(--fs-xs);
    line-height: 1.4;
    color: var(--text-tertiary);
  }

  .question-actions {
    display: flex;
    gap: 8px;
    padding: 8px 12px;
    justify-content: flex-end;
    border-top: 1px solid var(--border-secondary);
  }

  .btn {
    padding: 6px 20px;
    border-radius: var(--radius-sm);
    font-size: var(--fs-base);
    font-weight: 600;
    transition: all var(--transition);
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-submit {
    background: var(--accent-primary);
    color: var(--text-on-accent);
  }
  .btn-submit:hover:not(:disabled) {
    filter: brightness(1.1);
  }
</style>
