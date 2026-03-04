import React, { useEffect } from 'react';
import './ErrorAlert.css';

/**
 * ConfirmDialog - A styled confirmation dialog that replaces browser confirm()
 * Follows the same visual pattern as ErrorAlert for consistency.
 *
 * Usage:
 * const [confirmDialog, setConfirmDialog] = useState(null);
 *
 * // To show:
 * setConfirmDialog({
 *   title: 'Delete Item',
 *   message: 'Are you sure you want to delete this item?',
 *   confirmLabel: 'Delete',
 *   variant: 'danger',
 *   onConfirm: () => { doDelete(); setConfirmDialog(null); }
 * });
 *
 * // In render:
 * <ConfirmDialog dialog={confirmDialog} onClose={() => setConfirmDialog(null)} />
 */
export const ConfirmDialog = ({ dialog, onClose }) => {
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape' && dialog) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [dialog, onClose]);

  useEffect(() => {
    if (dialog) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [dialog]);

  if (!dialog) return null;

  const {
    title = 'Confirm',
    message,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    variant = 'warning', // 'danger', 'warning', 'info'
    onConfirm
  } = dialog;

  const variantMap = {
    danger: { border: '#dc2626', iconBg: '#fee2e2', iconColor: '#dc2626', btnBg: '#dc2626', btnHover: '#b91c1c' },
    warning: { border: '#f59e0b', iconBg: '#fef3c7', iconColor: '#f59e0b', btnBg: '#f59e0b', btnHover: '#d97706' },
    info: { border: '#3b82f6', iconBg: '#dbeafe', iconColor: '#3b82f6', btnBg: '#3b82f6', btnHover: '#2563eb' }
  };

  const colors = variantMap[variant] || variantMap.warning;

  return (
    <div className="error-alert-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div
        className="error-alert-content"
        style={{ borderTop: `4px solid ${colors.border}` }}
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
      >
        <div className="error-alert-header">
          <span
            className="error-alert-icon"
            style={{ background: colors.iconBg, color: colors.iconColor }}
          >
            ?
          </span>
          <h3 id="confirm-dialog-title">{title}</h3>
          <button
            className="error-alert-close"
            onClick={onClose}
            aria-label="Close dialog"
          >
            ×
          </button>
        </div>
        <div className="error-alert-body">
          <p id="confirm-dialog-message" className="error-message">{message}</p>
        </div>
        <div className="error-alert-footer" style={{ gap: '8px' }}>
          <button
            className="error-alert-btn"
            style={{ background: '#6b7280' }}
            onClick={onClose}
          >
            {cancelLabel}
          </button>
          <button
            className="error-alert-btn"
            style={{ background: colors.btnBg }}
            onClick={async () => {
              try {
                await onConfirm();
              } finally {
                onClose();
              }
            }}
            autoFocus
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;
