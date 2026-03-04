/**
 * Currency formatting for South African Rand (ZAR).
 * Use across the app for consistent money display.
 */

const CURRENCY_SYMBOL = 'R';
const CURRENCY_CODE = 'ZAR';

/**
 * Format a number as South African Rand (e.g. R 1 199 or R 5 499).
 * @param {number} amount - Numeric amount
 * @param {Object} options - Intl.NumberFormatOptions (e.g. minimumFractionDigits)
 * @returns {string} Formatted string like "R 1 199"
 */
export function formatZAR(amount, options = {}) {
  const value = Number(amount);
  if (!Number.isFinite(value)) return `${CURRENCY_SYMBOL} 0`;
  const formatted = value.toLocaleString('en-ZA', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
    ...options
  });
  return `${CURRENCY_SYMBOL} ${formatted}`;
}

export { CURRENCY_SYMBOL, CURRENCY_CODE };
