/**
 * Curated coding & nerd font selections.
 *
 * Each entry has:
 * - id: stored in settings
 * - label: display name
 * - family: CSS font-family value
 * - googleFont: Google Fonts family name (null = system/locally-installed only)
 * - category: 'mono' for monospace code fonts, 'sans' for UI fonts
 */

export interface FontOption {
  id: string;
  label: string;
  family: string;
  googleFont: string | null;
  category: 'mono' | 'sans';
  /** Pixel offset added to the base font-size to compensate for visual sizing differences between typefaces. */
  sizeAdjust?: number;
}

export const MONO_FONTS: FontOption[] = [
  {
    id: 'share-tech-mono',
    label: 'Share Tech Mono',
    family: "'Share Tech Mono', monospace",
    googleFont: 'Share+Tech+Mono',
    category: 'mono',
  },
  {
    id: 'jetbrains-mono',
    label: 'JetBrains Mono',
    family: "'JetBrains Mono', monospace",
    googleFont: 'JetBrains+Mono:wght@400;500;600;700',
    category: 'mono',
  },
  {
    id: 'fira-code',
    label: 'Fira Code',
    family: "'Fira Code', monospace",
    googleFont: 'Fira+Code:wght@400;500;600;700',
    category: 'mono',
  },
  {
    id: 'source-code-pro',
    label: 'Source Code Pro',
    family: "'Source Code Pro', monospace",
    googleFont: 'Source+Code+Pro:wght@400;500;600;700',
    category: 'mono',
  },
  {
    id: 'ibm-plex-mono',
    label: 'IBM Plex Mono',
    family: "'IBM Plex Mono', monospace",
    googleFont: 'IBM+Plex+Mono:wght@400;500;600;700',
    category: 'mono',
  },
  {
    id: 'hack',
    label: 'Hack',
    family: "'Hack', monospace",
    googleFont: null, // Not on Google Fonts; user must install locally
    category: 'mono',
  },
  {
    id: 'inconsolata',
    label: 'Inconsolata',
    family: "'Inconsolata', monospace",
    googleFont: 'Inconsolata:wght@400;500;600;700',
    category: 'mono',
  },
  {
    id: 'ubuntu-mono',
    label: 'Ubuntu Mono',
    family: "'Ubuntu Mono', monospace",
    googleFont: 'Ubuntu+Mono:wght@400;700',
    category: 'mono',
  },
  {
    id: 'space-mono',
    label: 'Space Mono',
    family: "'Space Mono', monospace",
    googleFont: 'Space+Mono:wght@400;700',
    category: 'mono',
  },
  {
    id: 'victor-mono',
    label: 'Victor Mono',
    family: "'Victor Mono', monospace",
    googleFont: 'Victor+Mono:wght@400;500;600;700',
    category: 'mono',
  },
  {
    id: 'roboto-mono',
    label: 'Roboto Mono',
    family: "'Roboto Mono', monospace",
    googleFont: 'Roboto+Mono:wght@400;500;600;700',
    category: 'mono',
  },
  {
    id: 'cascadia-code',
    label: 'Cascadia Code',
    family: "'Cascadia Code', 'Cascadia Mono', monospace",
    googleFont: null, // Microsoft font; user must install locally
    category: 'mono',
  },
  {
    id: 'anonymous-pro',
    label: 'Anonymous Pro',
    family: "'Anonymous Pro', monospace",
    googleFont: 'Anonymous+Pro:wght@400;700',
    category: 'mono',
  },
  {
    id: 'courier-prime',
    label: 'Courier Prime',
    family: "'Courier Prime', 'Courier New', monospace",
    googleFont: 'Courier+Prime:wght@400;700',
    category: 'mono',
  },
  {
    id: 'dm-mono',
    label: 'DM Mono',
    family: "'DM Mono', monospace",
    googleFont: 'DM+Mono:wght@400;500',
    category: 'mono',
  },
  {
    id: 'red-hat-mono',
    label: 'Red Hat Mono',
    family: "'Red Hat Mono', monospace",
    googleFont: 'Red+Hat+Mono:wght@400;500;600;700',
    category: 'mono',
  },
  {
    id: 'geist-mono',
    label: 'Geist Mono',
    family: "'Geist Mono', monospace",
    googleFont: 'Geist+Mono:wght@400;500;600;700',
    category: 'mono',
  },
  {
    id: 'system-mono',
    label: 'System Mono',
    family: "'SF Mono', 'Menlo', 'Consolas', 'DejaVu Sans Mono', monospace",
    googleFont: null,
    category: 'mono',
  },
];

export const SANS_FONTS: FontOption[] = [
  {
    id: 'rajdhani',
    label: 'Rajdhani',
    family: "'Rajdhani', sans-serif",
    googleFont: 'Rajdhani:wght@400;500;600;700',
    category: 'sans',
    sizeAdjust: 3,
  },
  {
    id: 'inter',
    label: 'Inter',
    family: "'Inter', sans-serif",
    googleFont: 'Inter:wght@400;500;600;700',
    category: 'sans',
  },
  {
    id: 'roboto-condensed',
    label: 'Roboto Condensed',
    family: "'Roboto Condensed', sans-serif",
    googleFont: 'Roboto+Condensed:wght@400;500;600;700',
    category: 'sans',
  },
  {
    id: 'ibm-plex-sans',
    label: 'IBM Plex Sans',
    family: "'IBM Plex Sans', sans-serif",
    googleFont: 'IBM+Plex+Sans:wght@400;500;600;700',
    category: 'sans',
  },
  {
    id: 'exo-2',
    label: 'Exo 2',
    family: "'Exo 2', sans-serif",
    googleFont: 'Exo+2:wght@400;500;600;700',
    category: 'sans',
  },
  {
    id: 'space-grotesk',
    label: 'Space Grotesk',
    family: "'Space Grotesk', sans-serif",
    googleFont: 'Space+Grotesk:wght@400;500;600;700',
    category: 'sans',
  },
  {
    id: 'outfit',
    label: 'Outfit',
    family: "'Outfit', sans-serif",
    googleFont: 'Outfit:wght@400;500;600;700',
    category: 'sans',
  },
  {
    id: 'geist',
    label: 'Geist',
    family: "'Geist', sans-serif",
    googleFont: 'Geist:wght@400;500;600;700',
    category: 'sans',
  },
  {
    id: 'crimson-pro',
    label: 'Crimson Pro',
    family: "'Crimson Pro', Georgia, serif",
    googleFont: 'Crimson+Pro:wght@400;500;600;700',
    category: 'sans',
  },
  {
    id: 'cinzel',
    label: 'Cinzel',
    family: "'Cinzel', 'Garamond', serif",
    googleFont: 'Cinzel:wght@400;500;600;700',
    category: 'sans',
    sizeAdjust: -1,
  },
  {
    id: 'cormorant-garamond',
    label: 'Cormorant Garamond',
    family: "'Cormorant Garamond', 'Garamond', serif",
    googleFont: 'Cormorant+Garamond:wght@400;500;600;700',
    category: 'sans',
    sizeAdjust: 2,
  },
  {
    id: 'uncial-antiqua',
    label: 'Uncial Antiqua',
    family: "'Uncial Antiqua', cursive",
    googleFont: 'Uncial+Antiqua',
    category: 'sans',
    sizeAdjust: 1,
  },
  {
    id: 'system-sans',
    label: 'System Sans',
    family: "-apple-system, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
    googleFont: null,
    category: 'sans',
  },
];

/** Build a Google Fonts URL for one or more font options */
export function buildGoogleFontsUrl(fonts: FontOption[]): string | null {
  const families = fonts.filter((f) => f.googleFont).map((f) => `family=${f.googleFont!}`);
  if (families.length === 0) return null;
  return `https://fonts.googleapis.com/css2?${families.join('&')}&display=swap`;
}

/** Find a font option by ID across both mono and sans lists */
export function findFont(id: string): FontOption | undefined {
  return MONO_FONTS.find((f) => f.id === id) || SANS_FONTS.find((f) => f.id === id);
}
