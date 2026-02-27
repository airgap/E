import type { SidebarTab } from './ui.svelte';
import { onSidebarTabChange } from './ui.svelte';
import { SIDEBAR_TABS, type TabDefinition } from '$lib/config/sidebarTabs';
import { uuid } from '$lib/utils/uuid';

const STORAGE_KEY = 'e-sidebar-layout';

const DEFAULT_TABS: SidebarTab[] = ['conversations', 'files', 'search', 'work'];

// ── New panel-groups data model ──

export interface TabGroup {
  id: string;
  tabs: SidebarTab[];
  activeTab: SidebarTab;
}

export interface PanelColumn {
  groups: TabGroup[];
  width: number;
}

export interface FloatingPanelState {
  tabId: SidebarTab;
  x: number;
  y: number;
  width: number;
  height: number;
}

// ── Persistence ──

interface PersistedStateV2 {
  version: 2;
  leftColumn: PanelColumn | null;
  rightColumn: PanelColumn | null;
  floatingPanels: FloatingPanelState[];
}

// Old format for migration
interface PersistedStateV1 {
  pinnedTabIds: SidebarTab[];
  floatingPanels: Array<{
    tabId: SidebarTab;
    x: number;
    y: number;
    width: number;
    height: number;
    docked?: 'float' | 'left' | 'right';
  }>;
}

type PersistedState = PersistedStateV2 | PersistedStateV1;

function isV2(state: PersistedState): state is PersistedStateV2 {
  return 'version' in state && state.version === 2;
}

function loadFromStorage(): PersistedState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

function saveToStorage(state: PersistedStateV2) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

function allTabIds(): SidebarTab[] {
  return SIDEBAR_TABS.map((t) => t.id);
}

function makeGroupId(): string {
  return uuid();
}

/** Remove invalid tabs from a group, return null if empty */
function validateGroup(group: TabGroup, valid: SidebarTab[]): TabGroup | null {
  const tabs = group.tabs.filter((t) => valid.includes(t));
  if (tabs.length === 0) return null;
  const activeTab = tabs.includes(group.activeTab) ? group.activeTab : tabs[0];
  return { id: group.id || makeGroupId(), tabs, activeTab };
}

function validateColumn(col: PanelColumn | null, valid: SidebarTab[]): PanelColumn | null {
  if (!col) return null;
  const groups = col.groups
    .map((g) => validateGroup(g, valid))
    .filter((g): g is TabGroup => g !== null);
  if (groups.length === 0) return null;
  return { groups, width: Math.max(200, Math.min(600, col.width || 280)) };
}

function migrateV1(old: PersistedStateV1): PersistedStateV2 {
  const valid = allTabIds();

  // Pinned tabs become the first group in the left column
  const pinnedTabs = (old.pinnedTabIds ?? []).filter((id) => valid.includes(id));
  const leftGroups: TabGroup[] = [];

  if (pinnedTabs.length > 0) {
    leftGroups.push({
      id: makeGroupId(),
      tabs: pinnedTabs,
      activeTab: pinnedTabs[0],
    });
  }

  const floatingPanels: FloatingPanelState[] = [];
  const rightGroups: TabGroup[] = [];

  for (const p of old.floatingPanels ?? []) {
    if (!valid.includes(p.tabId)) continue;
    const docked = p.docked ?? 'float';

    if (docked === 'left') {
      // Remove from first group if present, add as new group
      if (leftGroups.length > 0) {
        leftGroups[0].tabs = leftGroups[0].tabs.filter((t) => t !== p.tabId);
      }
      leftGroups.push({
        id: makeGroupId(),
        tabs: [p.tabId],
        activeTab: p.tabId,
      });
    } else if (docked === 'right') {
      rightGroups.push({
        id: makeGroupId(),
        tabs: [p.tabId],
        activeTab: p.tabId,
      });
    } else {
      floatingPanels.push({
        tabId: p.tabId,
        x: p.x,
        y: p.y,
        width: p.width,
        height: p.height,
      });
    }
  }

  // Clean up empty first group
  const cleanedLeftGroups = leftGroups.filter((g) => g.tabs.length > 0);
  if (cleanedLeftGroups.length > 0 && cleanedLeftGroups[0].tabs.length > 0) {
    const first = cleanedLeftGroups[0];
    if (!first.tabs.includes(first.activeTab)) {
      first.activeTab = first.tabs[0];
    }
  }

  return {
    version: 2,
    leftColumn: cleanedLeftGroups.length > 0 ? { groups: cleanedLeftGroups, width: 280 } : null,
    rightColumn: rightGroups.length > 0 ? { groups: rightGroups, width: 320 } : null,
    floatingPanels,
  };
}

// ── Store ──

function createSidebarLayoutStore() {
  let leftColumn = $state<PanelColumn | null>({
    groups: [
      {
        id: makeGroupId(),
        tabs: [...DEFAULT_TABS],
        activeTab: DEFAULT_TABS[0],
      },
    ],
    width: 280,
  });
  let rightColumn = $state<PanelColumn | null>(null);
  let floatingPanels = $state<FloatingPanelState[]>([]);

  // ── Derived ──

  const allDockedTabs = $derived.by(() => {
    const tabs: SidebarTab[] = [];
    for (const col of [leftColumn, rightColumn]) {
      if (!col) continue;
      for (const g of col.groups) {
        tabs.push(...g.tabs);
      }
    }
    return tabs;
  });

  const unplacedTabs = $derived.by(() => {
    const placed = new Set<SidebarTab>([...allDockedTabs, ...floatingPanels.map((p) => p.tabId)]);
    return SIDEBAR_TABS.filter((t) => !placed.has(t.id));
  });

  // ── Helpers ──

  function getColumn(side: 'left' | 'right'): PanelColumn | null {
    return side === 'left' ? leftColumn : rightColumn;
  }

  function setColumn(side: 'left' | 'right', col: PanelColumn | null) {
    if (side === 'left') {
      leftColumn = col;
    } else {
      rightColumn = col;
    }
  }

  function cleanEmptyGroups() {
    for (const side of ['left', 'right'] as const) {
      const col = getColumn(side);
      if (!col) continue;
      const groups = col.groups.filter((g) => g.tabs.length > 0);
      if (groups.length === 0) {
        setColumn(side, null);
      } else if (groups.length !== col.groups.length) {
        setColumn(side, { ...col, groups });
      }
    }
  }

  /** Remove a tab from wherever it currently is (column group or floating) */
  function removeTabFromAll(tabId: SidebarTab) {
    // Remove from columns
    for (const side of ['left', 'right'] as const) {
      const col = getColumn(side);
      if (!col) continue;
      let changed = false;
      const groups = col.groups.map((g) => {
        if (!g.tabs.includes(tabId)) return g;
        changed = true;
        const tabs = g.tabs.filter((t) => t !== tabId);
        const activeTab = g.activeTab === tabId ? (tabs[0] ?? g.activeTab) : g.activeTab;
        return { ...g, tabs, activeTab };
      });
      if (changed) {
        setColumn(side, { ...col, groups });
      }
    }
    // Remove from floating
    floatingPanels = floatingPanels.filter((p) => p.tabId !== tabId);
    cleanEmptyGroups();
  }

  function persist() {
    saveToStorage({
      version: 2,
      leftColumn,
      rightColumn,
      floatingPanels,
    });
  }

  return {
    // ── Getters ──
    get leftColumn() {
      return leftColumn;
    },
    get rightColumn() {
      return rightColumn;
    },
    get floatingPanels() {
      return floatingPanels;
    },
    get unplacedTabs() {
      return unplacedTabs;
    },
    // ── Tab location ──

    findTab(tabId: SidebarTab): { column: 'left' | 'right'; groupIndex: number } | null {
      for (const side of ['left', 'right'] as const) {
        const col = getColumn(side);
        if (!col) continue;
        for (let i = 0; i < col.groups.length; i++) {
          if (col.groups[i].tabs.includes(tabId)) {
            return { column: side, groupIndex: i };
          }
        }
      }
      return null;
    },

    /** Focus a tab wherever it is. If unplaced, add to left column. */
    focusTab(tabId: SidebarTab) {
      // Check columns
      for (const side of ['left', 'right'] as const) {
        const col = getColumn(side);
        if (!col) continue;
        for (let i = 0; i < col.groups.length; i++) {
          if (col.groups[i].tabs.includes(tabId)) {
            const groups = [...col.groups];
            groups[i] = { ...groups[i], activeTab: tabId };
            setColumn(side, { ...col, groups });
            persist();
            return;
          }
        }
      }
      // Check floating — already visible
      if (floatingPanels.some((p) => p.tabId === tabId)) return;
      // Unplaced — add to left column's first group
      this.addTabToColumn(tabId, 'left');
    },

    // ── Group operations ──

    setActiveTabInGroup(column: 'left' | 'right', groupIndex: number, tabId: SidebarTab) {
      const col = getColumn(column);
      if (!col || groupIndex >= col.groups.length) return;
      const group = col.groups[groupIndex];
      if (!group.tabs.includes(tabId)) return;
      const groups = [...col.groups];
      groups[groupIndex] = { ...group, activeTab: tabId };
      setColumn(column, { ...col, groups });
      persist();
    },

    reorderTabsInGroup(column: 'left' | 'right', groupIndex: number, newOrder: SidebarTab[]) {
      const col = getColumn(column);
      if (!col || groupIndex >= col.groups.length) return;
      const group = col.groups[groupIndex];
      // Validate: same tabs, just reordered
      if (newOrder.length !== group.tabs.length || !newOrder.every((t) => group.tabs.includes(t)))
        return;
      const groups = [...col.groups];
      groups[groupIndex] = { ...group, tabs: [...newOrder] };
      setColumn(column, { ...col, groups });
      persist();
    },

    /** Move a tab to a specific group. Removes from previous location first. */
    moveTabToGroup(
      tabId: SidebarTab,
      targetColumn: 'left' | 'right',
      targetGroupIndex: number,
      insertIndex?: number,
    ) {
      removeTabFromAll(tabId);
      let col = getColumn(targetColumn);
      if (!col) {
        col = { groups: [], width: targetColumn === 'left' ? 280 : 320 };
        setColumn(targetColumn, col);
      }
      // Ensure target group exists
      const gi = Math.min(targetGroupIndex, col.groups.length - 1);
      if (gi < 0 || col.groups.length === 0) {
        // No groups — create one
        setColumn(targetColumn, {
          ...col,
          groups: [{ id: makeGroupId(), tabs: [tabId], activeTab: tabId }],
        });
      } else {
        const groups = [...col.groups];
        const group = groups[gi];
        const tabs = [...group.tabs];
        const idx = insertIndex != null ? Math.min(insertIndex, tabs.length) : tabs.length;
        tabs.splice(idx, 0, tabId);
        groups[gi] = { ...group, tabs, activeTab: tabId };
        setColumn(targetColumn, { ...col, groups });
      }
      cleanEmptyGroups();
      persist();
    },

    /** Create a new group by splitting. Tab is removed from its current location. */
    createSplit(tabId: SidebarTab, targetColumn: 'left' | 'right', insertGroupAtIndex: number) {
      removeTabFromAll(tabId);
      let col = getColumn(targetColumn);
      if (!col) {
        col = { groups: [], width: targetColumn === 'left' ? 280 : 320 };
      }
      const groups = [...col.groups];
      const newGroup: TabGroup = {
        id: makeGroupId(),
        tabs: [tabId],
        activeTab: tabId,
      };
      const idx = Math.min(Math.max(0, insertGroupAtIndex), groups.length);
      groups.splice(idx, 0, newGroup);
      setColumn(targetColumn, { ...col, groups });
      cleanEmptyGroups();
      persist();
    },

    /** Add a tab to a column. Appends to last group or creates one. */
    addTabToColumn(tabId: SidebarTab, column: 'left' | 'right') {
      removeTabFromAll(tabId);
      let col = getColumn(column);
      if (!col) {
        col = { groups: [], width: column === 'left' ? 280 : 320 };
      }
      if (col.groups.length === 0) {
        setColumn(column, {
          ...col,
          groups: [{ id: makeGroupId(), tabs: [tabId], activeTab: tabId }],
        });
      } else {
        const groups = [...col.groups];
        const last = groups[groups.length - 1];
        groups[groups.length - 1] = {
          ...last,
          tabs: [...last.tabs, tabId],
          activeTab: tabId,
        };
        setColumn(column, { ...col, groups });
      }
      persist();
    },

    /** Remove a tab from wherever it is. */
    removeTab(tabId: SidebarTab) {
      removeTabFromAll(tabId);
      persist();
    },

    // ── Floating panels ──

    popOutTab(tabId: SidebarTab, position?: { x: number; y: number }) {
      // Don't allow duplicate floating panels
      if (floatingPanels.some((p) => p.tabId === tabId)) return;
      removeTabFromAll(tabId);
      floatingPanels = [
        ...floatingPanels,
        {
          tabId,
          x: position?.x ?? 100,
          y: position?.y ?? 100,
          width: 320,
          height: 400,
        },
      ];
      persist();
    },

    /** Dock a floating panel into a column */
    dockFloatingTab(tabId: SidebarTab, column: 'left' | 'right', groupIndex?: number) {
      if (groupIndex != null) {
        this.moveTabToGroup(tabId, column, groupIndex);
      } else {
        this.addTabToColumn(tabId, column);
      }
    },

    /** Remove a floating panel (close it, don't put it anywhere) */
    closeFloatingPanel(tabId: SidebarTab) {
      floatingPanels = floatingPanels.filter((p) => p.tabId !== tabId);
      persist();
    },

    updatePanelPosition(tabId: SidebarTab, x: number, y: number) {
      floatingPanels = floatingPanels.map((p) => (p.tabId === tabId ? { ...p, x, y } : p));
      persist();
    },

    updatePanelSize(tabId: SidebarTab, width: number, height: number) {
      floatingPanels = floatingPanels.map((p) => (p.tabId === tabId ? { ...p, width, height } : p));
      persist();
    },

    // ── Column operations ──

    setColumnWidth(column: 'left' | 'right', width: number) {
      const col = getColumn(column);
      if (!col) return;
      setColumn(column, { ...col, width: Math.max(200, Math.min(600, width)) });
      persist();
    },

    // ── Persistence ──

    init() {
      const saved = loadFromStorage();
      if (!saved) return;
      const valid = allTabIds();

      let state: PersistedStateV2;
      if (isV2(saved)) {
        state = saved;
      } else {
        state = migrateV1(saved as PersistedStateV1);
      }

      leftColumn = validateColumn(state.leftColumn, valid) ?? {
        groups: [
          {
            id: makeGroupId(),
            tabs: [...DEFAULT_TABS],
            activeTab: DEFAULT_TABS[0],
          },
        ],
        width: 280,
      };
      rightColumn = validateColumn(state.rightColumn, valid);
      floatingPanels = (state.floatingPanels ?? []).filter((p) => valid.includes(p.tabId));
    },

    persist,

    // ── Workspace integration ──

    captureState(): PersistedStateV2 {
      return {
        version: 2,
        leftColumn: leftColumn
          ? {
              groups: leftColumn.groups.map((g) => ({ ...g, tabs: [...g.tabs] })),
              width: leftColumn.width,
            }
          : null,
        rightColumn: rightColumn
          ? {
              groups: rightColumn.groups.map((g) => ({ ...g, tabs: [...g.tabs] })),
              width: rightColumn.width,
            }
          : null,
        floatingPanels: floatingPanels.map((p) => ({ ...p })),
      };
    },

    restoreState(state: PersistedStateV2 | { pinnedTabIds: SidebarTab[]; floatingPanels: any[] }) {
      const valid = allTabIds();

      let v2: PersistedStateV2;
      if ('version' in state && state.version === 2) {
        v2 = state as PersistedStateV2;
      } else {
        // Old workspace snapshot format
        v2 = migrateV1(state as PersistedStateV1);
      }

      leftColumn = validateColumn(v2.leftColumn, valid) ?? {
        groups: [
          {
            id: makeGroupId(),
            tabs: [...DEFAULT_TABS],
            activeTab: DEFAULT_TABS[0],
          },
        ],
        width: 280,
      };
      rightColumn = validateColumn(v2.rightColumn, valid);
      floatingPanels = (v2.floatingPanels ?? []).filter((p) => valid.includes(p.tabId));
    },
  };
}

export const sidebarLayoutStore = createSidebarLayoutStore();

// Wire up the callback so uiStore.setSidebarTab() focuses the tab in the layout
onSidebarTabChange((tab) => sidebarLayoutStore.focusTab(tab));
