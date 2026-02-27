import type { SidebarTab } from '$lib/stores/ui.svelte';

export interface TabDefinition {
  id: SidebarTab;
  label: string;
  icon: string;
  wip?: boolean;
}

export const SIDEBAR_TABS: TabDefinition[] = [
  {
    id: 'conversations',
    label: 'Chats',
    icon: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  },
  {
    id: 'files',
    label: 'Files',
    icon: 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z',
  },
  {
    id: 'search',
    label: 'Search',
    icon: 'M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM21 21l-4.35-4.35',
  },
  {
    id: 'symbols',
    label: 'Symbols',
    icon: 'M4 7h16M4 12h10M4 17h6',
  },
  {
    id: 'work',
    label: 'Work',
    icon: 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
  },
  {
    id: 'memory',
    label: 'Memory',
    icon: 'M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zM12 16v-4M12 8h.01',
  },
  {
    id: 'agents',
    label: 'Agents',
    icon: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
  },
  {
    id: 'mcp',
    label: 'MCP',
    icon: 'M4 4h16v4H4zM4 10h16v4H4zM4 16h16v4H4z',
  },
  {
    id: 'todos',
    label: 'TODOs',
    icon: 'M9 11l3 3 5-5M5 12a7 7 0 1 0 14 0 7 7 0 0 0-14 0z',
  },
  {
    id: 'costs',
    label: 'Costs',
    icon: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8M12 18V6',
  },
  {
    id: 'ambient',
    label: 'Ambient',
    icon: 'M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
    wip: true,
  },
  {
    id: 'digest',
    label: 'Digest',
    icon: 'M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-4 0v-9a2 2 0 0 1 2-2h2M18 14h-8M15 18h-5',
  },
  {
    id: 'custom-tools',
    label: 'Tools',
    icon: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z',
  },
  {
    id: 'initiatives',
    label: 'Initiatives',
    icon: 'M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528',
    wip: true,
  },
  {
    id: 'help',
    label: 'Help',
    icon: 'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zM9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01',
  },
  {
    id: 'git',
    label: 'Git',
    icon: 'M6 3a3 3 0 1 1 0 6 3 3 0 0 1 0-6zm12 12a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM6 9c0 3.314 2.686 6 6 6h2M18 15V9m0 0-2-2m2 2 2-2',
  },
  {
    id: 'artifacts',
    label: 'Artifacts',
    icon: 'M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01',
    wip: true,
  },
  {
    id: 'notes',
    label: 'Notes',
    icon: 'M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-3l-4 4z',
  },
  {
    id: 'manager',
    label: 'Manager',
    icon: 'M3 3h18v4H3zM3 10h18v4H3zM3 17h18v4H3zM7 5v14M17 5v14',
  },
  {
    id: 'commentary',
    label: 'Commentary',
    icon: 'M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8',
    wip: true,
  },
  {
    id: 'golems',
    label: 'Golems',
    icon: 'M12 2a4 4 0 0 0-4 4v1H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2V6a4 4 0 0 0-4-4zM9 12a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zM15 12a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z',
    wip: true,
  },
  {
    id: 'command-history',
    label: 'History',
    icon: 'M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zM12 6v6l4 2',
  },
  {
    id: 'canvas',
    label: 'Canvas',
    icon: 'M3 3h18v18H3zM8 8h8M8 12h8M8 16h5',
  },
  {
    id: 'learning',
    label: 'Learning',
    icon: 'M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4L12 14.01l-3-3',
  },
];

export function getTabDef(id: SidebarTab): TabDefinition {
  const tab = SIDEBAR_TABS.find((t) => t.id === id);
  if (!tab) {
    throw new Error(`Unknown sidebar tab: ${id}`);
  }
  return tab;
}
