/**
 * Pure math for spatial viewport panel transforms.
 * No DOM access — computes CSS transform strings from panel state.
 */

import type { PanelRole } from '$lib/stores/spatialViewport.svelte';

export interface SpatialConfig {
  parallaxIntensity: number; // 0–1
  dofBlur: number; // 0–8 px
  depthGap: number; // 40–300 px
  pointerX: number; // -1..1
  pointerY: number; // -1..1
}

export interface SpatialTransform {
  transform: string;
  filter: string;
  opacity: number;
  zIndex: number;
}

// Panel arc positions: unfocused rotateY angles
const PANEL_ANGLES: Record<PanelRole, number> = {
  'sidebar-left': -25,
  'main-content': 0,
  terminal: 0,
  'sidebar-right': 25,
};

// Horizontal offsets for panels when unfocused (percentage of container)
const PANEL_X_OFFSETS: Record<PanelRole, number> = {
  'sidebar-left': -35,
  'main-content': 0,
  terminal: 0,
  'sidebar-right': 35,
};

export function computeSpatialTransform(
  panel: PanelRole,
  focusedPanel: PanelRole,
  config: SpatialConfig,
): SpatialTransform {
  const isFocused = panel === focusedPanel;
  const angle = PANEL_ANGLES[panel];
  const xOffset = PANEL_X_OFFSETS[panel];

  if (isFocused) {
    // Focused panel: at z=0, subtle parallax rotation only
    const parallaxRotY = config.pointerX * 2 * config.parallaxIntensity;
    const parallaxRotX = -config.pointerY * 1.5 * config.parallaxIntensity;

    return {
      transform: `translateZ(0px) rotateY(${parallaxRotY}deg) rotateX(${parallaxRotX}deg)`,
      filter: 'blur(0px)',
      opacity: 1,
      zIndex: 10,
    };
  }

  // Unfocused panel: recede, rotate, blur, dim
  const depthScale = 0.7; // how much unfocused panels are pushed back relative to depthGap
  const translateZ = -config.depthGap * depthScale;
  const rotateY = angle * 0.72; // soften the angle slightly
  const translateX = xOffset * 0.5; // percentage → approximate vw units

  return {
    transform: `translateX(${translateX}%) translateZ(${translateZ}px) rotateY(${rotateY}deg)`,
    filter: `blur(${config.dofBlur}px)`,
    opacity: 0.85,
    zIndex: 1,
  };
}

/**
 * Compute the perspective-origin for the scene container based on pointer position.
 * This creates the head-tracking parallax effect.
 */
export function computePerspectiveOrigin(
  pointerX: number,
  pointerY: number,
  intensity: number,
): string {
  const ox = 50 + pointerX * 15 * intensity; // 50% ± 15%
  const oy = 50 + pointerY * 10 * intensity; // 50% ± 10%
  return `${ox}% ${oy}%`;
}
