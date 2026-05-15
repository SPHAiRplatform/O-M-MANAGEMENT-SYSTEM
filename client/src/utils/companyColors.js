/**
 * Company Colors Utility
 * Loads and applies organization branding colors to the UI
 */

import { getCurrentOrganizationBranding } from '../api/api';

// Default colors (fallback)
const DEFAULT_PRIMARY = '#0f3460';
const DEFAULT_SECONDARY = '#7b809a';

// Darken a hex color by a given ratio (0–1)
function darkenHex(hex, ratio) {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = Math.max(0, Math.round(((n >> 16) & 0xff) * (1 - ratio)));
  const g = Math.max(0, Math.round(((n >> 8) & 0xff) * (1 - ratio)));
  const b = Math.max(0, Math.round((n & 0xff) * (1 - ratio)));
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

/**
 * Apply company colors to CSS variables
 * @param {string} primaryColor - Primary color hex code
 * @param {string} secondaryColor - Secondary color hex code
 */
export function applyCompanyColors(primaryColor, secondaryColor) {
  const root = document.documentElement;
  const primary = primaryColor || DEFAULT_PRIMARY;

  root.style.setProperty('--md-primary', primary);
  root.style.setProperty('--md-primary-focus', darkenHex(primary, 0.1));
  root.style.setProperty('--md-primary-dark', darkenHex(primary, 0.2));
  root.style.setProperty('--md-primary-darker', darkenHex(primary, 0.35));
  root.style.setProperty('--md-primary-header-start', darkenHex(primary, 0.45));
  root.style.setProperty('--md-info', primary);
  root.style.setProperty('--md-secondary', secondaryColor || DEFAULT_SECONDARY);
}

/**
 * Reset colors to defaults
 */
export function resetCompanyColors() {
  applyCompanyColors(DEFAULT_PRIMARY, DEFAULT_SECONDARY);
}

/**
 * Load and apply company colors from API
 * @returns {Promise<{primaryColor: string, secondaryColor: string}|null>}
 */
export async function loadAndApplyCompanyColors() {
  try {
    const response = await getCurrentOrganizationBranding();
    const branding = response.data;
    
    if (branding && (branding.primary_color || branding.secondary_color)) {
      const primaryColor = branding.primary_color || DEFAULT_PRIMARY;
      const secondaryColor = branding.secondary_color || DEFAULT_SECONDARY;
      
      applyCompanyColors(primaryColor, secondaryColor);
      
      return {
        primaryColor,
        secondaryColor
      };
    } else {
      // No branding found, use defaults
      resetCompanyColors();
      return null;
    }
  } catch (error) {
    console.error('Error loading company colors:', error);
    // On error, use defaults
    resetCompanyColors();
    return null;
  }
}
