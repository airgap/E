import { api } from '$lib/api/client';

export interface SearchMatch {
  file: string;
  relativePath: string;
  line: number;
  column: number;
  content: string;
  matchStart: number;
  matchEnd: number;
  context?: Array<{ line: number; content: string }>;
}

function createSearchStore() {
  let query = $state('');
  let isRegex = $state(false);
  let results = $state<SearchMatch[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let totalMatches = $state(0);
  let fileCount = $state(0);
  let truncated = $state(false);

  const groupedResults = $derived(() => {
    const map = new Map<string, SearchMatch[]>();
    for (const r of results) {
      const group = map.get(r.relativePath) || [];
      group.push(r);
      map.set(r.relativePath, group);
    }
    return map;
  });

  return {
    get query() {
      return query;
    },
    get isRegex() {
      return isRegex;
    },
    get results() {
      return results;
    },
    get loading() {
      return loading;
    },
    get error() {
      return error;
    },
    get totalMatches() {
      return totalMatches;
    },
    get fileCount() {
      return fileCount;
    },
    get truncated() {
      return truncated;
    },
    get groupedResults() {
      return groupedResults;
    },

    setQuery(q: string) {
      query = q;
    },
    setIsRegex(v: boolean) {
      isRegex = v;
    },

    async search(rootPath: string) {
      if (!query.trim()) {
        results = [];
        totalMatches = 0;
        fileCount = 0;
        truncated = false;
        error = null;
        return;
      }

      loading = true;
      error = null;
      try {
        const res = await api.search.query(query, rootPath, isRegex);
        results = res.data.results;
        totalMatches = res.data.totalMatches;
        fileCount = res.data.fileCount;
        truncated = res.data.truncated;
      } catch (e) {
        error = String(e);
        results = [];
      }
      loading = false;
    },

    clear() {
      query = '';
      results = [];
      totalMatches = 0;
      fileCount = 0;
      truncated = false;
      error = null;
    },

    restoreState(state: { query: string; isRegex: boolean }) {
      query = state.query;
      isRegex = state.isRegex;
      // Clear stale results — user can re-search in new workspace context
      results = [];
      totalMatches = 0;
      fileCount = 0;
      truncated = false;
      error = null;
      loading = false;
    },
  };
}

export const searchStore = createSearchStore();
