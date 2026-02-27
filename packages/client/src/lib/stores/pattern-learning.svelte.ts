/**
 * Pattern Learning Store
 *
 * Manages detected patterns, skill/rule proposals, and the learning log
 * for the self-improving skills system.
 */
import { api } from '$lib/api/client';
import type {
  PatternDetection,
  SkillProposal,
  LearningLogEntry,
  PatternSensitivity,
} from '@e/shared';

export type LearningTab = 'patterns' | 'proposals' | 'log';
export type ProposalFilter = 'all' | 'pending' | 'approved' | 'rejected';

function createPatternLearningStore() {
  // State
  let patterns = $state<PatternDetection[]>([]);
  let proposals = $state<SkillProposal[]>([]);
  let learningLog = $state<LearningLogEntry[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let currentWorkspacePath = $state<string | null>(null);

  // UI state
  let activeTab = $state<LearningTab>('patterns');
  let proposalFilter = $state<ProposalFilter>('all');
  let selectedPatternId = $state<string | null>(null);
  let selectedProposalId = $state<string | null>(null);

  return {
    // Getters
    get patterns() {
      return patterns;
    },
    get proposals() {
      return proposals;
    },
    get learningLog() {
      return learningLog;
    },
    get loading() {
      return loading;
    },
    get error() {
      return error;
    },
    get activeTab() {
      return activeTab;
    },
    get proposalFilter() {
      return proposalFilter;
    },
    get selectedPatternId() {
      return selectedPatternId;
    },
    get selectedProposalId() {
      return selectedProposalId;
    },

    /** Patterns sorted by confidence (highest first) */
    get sortedPatterns(): PatternDetection[] {
      return [...patterns].sort(
        (a, b) => b.confidence - a.confidence || b.occurrences - a.occurrences,
      );
    },

    /** Proposals filtered by status */
    get filteredProposals(): SkillProposal[] {
      if (proposalFilter === 'all') return proposals;
      return proposals.filter((p) => p.status === proposalFilter);
    },

    /** Count of pending proposals */
    get pendingCount(): number {
      return proposals.filter((p) => p.status === 'pending').length;
    },

    /** Patterns that are eligible for proposals (haven't been proposed yet) */
    get proposablePatterns(): PatternDetection[] {
      return patterns.filter(
        (p) => !p.proposalCreated && p.occurrences >= 3 && p.confidence >= 0.6,
      );
    },

    /** Selected pattern details */
    get selectedPattern(): PatternDetection | null {
      if (!selectedPatternId) return null;
      return patterns.find((p) => p.id === selectedPatternId) ?? null;
    },

    /** Selected proposal details */
    get selectedProposal(): SkillProposal | null {
      if (!selectedProposalId) return null;
      return proposals.find((p) => p.id === selectedProposalId) ?? null;
    },

    // Actions
    setTab(tab: LearningTab) {
      activeTab = tab;
    },

    setProposalFilter(filter: ProposalFilter) {
      proposalFilter = filter;
    },

    selectPattern(id: string | null) {
      selectedPatternId = id;
    },

    selectProposal(id: string | null) {
      selectedProposalId = id;
    },

    /** Load all data for a workspace */
    async load(workspacePath: string) {
      if (loading && currentWorkspacePath === workspacePath) return;
      currentWorkspacePath = workspacePath;
      loading = true;
      error = null;

      try {
        const [patternsRes, proposalsRes, logRes] = await Promise.all([
          api.learning.getPatterns(workspacePath),
          api.learning.getProposals(workspacePath),
          api.learning.getLearningLog(workspacePath),
        ]);

        if (patternsRes.ok) patterns = patternsRes.data;
        if (proposalsRes.ok) proposals = proposalsRes.data;
        if (logRes.ok) learningLog = logRes.data;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        error = msg;
        console.error('[pattern-learning] Failed to load:', msg);
      } finally {
        loading = false;
      }
    },

    /** Refresh patterns only */
    async refreshPatterns() {
      if (!currentWorkspacePath) return;
      try {
        const res = await api.learning.getPatterns(currentWorkspacePath);
        if (res.ok) patterns = res.data;
      } catch {
        /* non-critical */
      }
    },

    /** Refresh proposals only */
    async refreshProposals() {
      if (!currentWorkspacePath) return;
      try {
        const res = await api.learning.getProposals(currentWorkspacePath);
        if (res.ok) proposals = res.data;
      } catch {
        /* non-critical */
      }
    },

    /** Approve a proposal (installs the skill/rule) */
    async approveProposal(proposalId: string): Promise<boolean> {
      try {
        const res = await api.learning.approveProposal(proposalId);
        if (res.ok) {
          // Update local state
          proposals = proposals.map((p) =>
            p.id === proposalId
              ? { ...p, status: 'approved' as const, installedPath: res.data.path }
              : p,
          );
          return true;
        }
      } catch (err) {
        console.error('[pattern-learning] Failed to approve proposal:', err);
      }
      return false;
    },

    /** Reject a proposal */
    async rejectProposal(proposalId: string): Promise<boolean> {
      try {
        const res = await api.learning.rejectProposal(proposalId);
        if (res.ok) {
          proposals = proposals.map((p) =>
            p.id === proposalId ? { ...p, status: 'rejected' as const } : p,
          );
          return true;
        }
      } catch (err) {
        console.error('[pattern-learning] Failed to reject proposal:', err);
      }
      return false;
    },

    /** Trigger check-and-propose for all eligible patterns */
    async checkAndPropose(): Promise<number> {
      if (!currentWorkspacePath) return 0;
      try {
        const res = await api.learning.checkAndPropose(currentWorkspacePath);
        if (res.ok) {
          // Refresh proposals to include new ones
          await this.refreshProposals();
          return res.data.count;
        }
      } catch (err) {
        console.error('[pattern-learning] Failed to check and propose:', err);
      }
      return 0;
    },

    /** Search skills registry for capability gaps */
    async suggestSkills(query: string) {
      try {
        const res = await api.learning.suggestSkills(query);
        if (res.ok) return res.data;
      } catch {
        /* non-critical */
      }
      return [];
    },

    /** Clear the store when switching workspaces */
    clear() {
      patterns = [];
      proposals = [];
      learningLog = [];
      currentWorkspacePath = null;
      selectedPatternId = null;
      selectedProposalId = null;
      error = null;
    },
  };
}

export const patternLearningStore = createPatternLearningStore();
