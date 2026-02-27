/**
 * @deprecated — Hyperthemes have been unified with Themes.
 * Import from '$lib/config/themes' instead.
 *
 * This file is kept for backward compatibility only.
 */
export {
  type ThemeConfig as HyperthemeConfig,
  HYPERTHEMES,
  findHypertheme,
  getDefaultHypertheme,
  // Also re-export new names
  type ThemeConfig,
  THEMES,
  findTheme,
  getDefaultTheme,
  getVisualStyle,
  isImmersiveTheme,
} from './themes';
