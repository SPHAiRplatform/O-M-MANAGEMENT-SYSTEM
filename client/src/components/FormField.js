import React, { useState, useCallback } from 'react';
import './FormField.css';

/**
 * Reusable FormField component with built-in validation.
 *
 * Props:
 *   label       - Field label
 *   name        - Field name (used for id and name attributes)
 *   type        - 'text', 'email', 'password', 'number', 'select', 'textarea'
 *   value       - Current value
 *   onChange     - Change handler (e) => void
 *   required    - Boolean, shows asterisk and validates presence
 *   placeholder - Placeholder text
 *   hint        - Help text below field
 *   error       - External error message (takes priority over validation)
 *   validate    - Validation function (value) => string|null
 *   options     - For select type: array of { value, label }
 *   disabled    - Boolean
 *   rows        - For textarea, number of rows
 */
function FormField({
  label,
  name,
  type = 'text',
  value = '',
  onChange,
  required = false,
  placeholder = '',
  hint = '',
  error: externalError = '',
  validate,
  options = [],
  disabled = false,
  rows = 4
}) {
  const [touched, setTouched] = useState(false);
  const [internalError, setInternalError] = useState('');

  const runValidation = useCallback((val) => {
    // Required check
    if (required && (!val || (typeof val === 'string' && val.trim() === ''))) {
      return `${label || name} is required`;
    }
    // Custom validation
    if (validate) {
      const result = validate(val);
      if (result) return result;
    }
    return '';
  }, [required, validate, label, name]);

  const handleBlur = useCallback(() => {
    setTouched(true);
    const err = runValidation(value);
    setInternalError(err);
  }, [value, runValidation]);

  const handleChange = useCallback((e) => {
    if (onChange) {
      onChange(e);
    }
    // Clear internal error on change (will re-validate on blur)
    if (touched) {
      const err = runValidation(e.target.value);
      setInternalError(err);
    }
  }, [onChange, touched, runValidation]);

  // External error takes priority
  const displayError = externalError || (touched ? internalError : '');
  const hasError = Boolean(displayError);

  const inputClassName = `form-field-input${hasError ? ' has-error' : ''}`;

  const renderInput = () => {
    const commonProps = {
      id: name,
      name,
      value,
      onChange: handleChange,
      onBlur: handleBlur,
      disabled,
      placeholder,
      className: inputClassName
    };

    if (type === 'select') {
      return (
        <select {...commonProps}>
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map(opt => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      );
    }

    if (type === 'textarea') {
      return (
        <textarea
          {...commonProps}
          rows={rows}
        />
      );
    }

    return (
      <input
        {...commonProps}
        type={type}
      />
    );
  };

  return (
    <div className="form-field">
      {label && (
        <label htmlFor={name} className="form-field-label">
          {label}
          {required && <span className="required-indicator">*</span>}
        </label>
      )}

      {renderInput()}

      {hasError && (
        <div className="form-field-error">
          <i className="bi bi-exclamation-circle"></i>
          {displayError}
        </div>
      )}

      {!hasError && hint && (
        <div className="form-field-hint">{hint}</div>
      )}
    </div>
  );
}

export default FormField;
