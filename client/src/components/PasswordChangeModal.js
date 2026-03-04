import React, { useState } from 'react';
import { changePassword } from '../api/api';
import './PasswordChangeModal.css';

function PasswordChangeModal({ isOpen, onClose, onSuccess }) {
  const [formData, setFormData] = useState({
    current_password: '',
    new_password: '',
    confirm_password: ''
  });
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [passwordStrength, setPasswordStrength] = useState({ score: 0, feedback: [] });

  // Calculate password strength
  const calculatePasswordStrength = (password) => {
    if (!password) {
      return { score: 0, feedback: [] };
    }

    let score = 0;
    const feedback = [];

    // Length check
    if (password.length >= 8) {
      score += 1;
    } else {
      feedback.push('At least 8 characters');
    }

    // Lowercase check
    if (/[a-z]/.test(password)) {
      score += 1;
    } else {
      feedback.push('One lowercase letter');
    }

    // Uppercase check
    if (/[A-Z]/.test(password)) {
      score += 1;
    } else {
      feedback.push('One uppercase letter');
    }

    // Number check
    if (/[0-9]/.test(password)) {
      score += 1;
    } else {
      feedback.push('One number');
    }

    // Special character check
    if (/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
      score += 1;
    } else {
      feedback.push('One special character');
    }

    // Length bonus
    if (password.length >= 12) {
      score += 1;
    }

    return { score, feedback };
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));

    // Clear error for this field
    if (errors[name]) {
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[name];
        return newErrors;
      });
    }

    // Calculate password strength for new password
    if (name === 'new_password') {
      setPasswordStrength(calculatePasswordStrength(value));
    }
  };

  const getStrengthLabel = (score) => {
    if (score === 0) return { label: 'Very Weak', color: '#dc3545' };
    if (score === 1) return { label: 'Weak', color: '#fd7e14' };
    if (score === 2) return { label: 'Fair', color: '#ffc107' };
    if (score === 3) return { label: 'Good', color: '#20c997' };
    if (score === 4) return { label: 'Strong', color: '#198754' };
    return { label: 'Very Strong', color: '#0d6efd' };
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrors({});

    // Validation
    const newErrors = {};

    if (!formData.current_password) {
      newErrors.current_password = 'Current password is required';
    }

    if (!formData.new_password) {
      newErrors.new_password = 'New password is required';
    } else if (formData.new_password.length < 8) {
      newErrors.new_password = 'Password must be at least 8 characters long';
    } else if (passwordStrength.score < 3) {
      newErrors.new_password = 'Password is too weak. Please follow the requirements below.';
    }

    if (!formData.confirm_password) {
      newErrors.confirm_password = 'Please confirm your new password';
    } else if (formData.new_password !== formData.confirm_password) {
      newErrors.confirm_password = 'Passwords do not match';
    }

    if (formData.current_password === formData.new_password) {
      newErrors.new_password = 'New password must be different from current password';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setSubmitting(true);

    try {
      await changePassword(
        formData.current_password,
        formData.new_password
      );

      // Clear form
      setFormData({
        current_password: '',
        new_password: '',
        confirm_password: ''
      });
      setPasswordStrength({ score: 0, feedback: [] });

      if (onSuccess) {
        onSuccess();
      }
      onClose();
    } catch (error) {
      console.error('Error changing password:', error);
      const errorMessage = error.response?.data?.error || 'Failed to change password';
      setErrors({ submit: errorMessage });
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const strengthInfo = getStrengthLabel(passwordStrength.score);

  return (
    <div className="modal-overlay" style={{ pointerEvents: 'auto' }}>
      <div className="modal-content password-change-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2><i className="bi bi-shield-lock" style={{ marginRight: 8 }}></i>Change Password</h2>
        </div>

        <div className="modal-body">
          <p className="pwd-notice">Please set a new password to continue.</p>

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="current_password">Current Password</label>
              <input
                type="password"
                id="current_password"
                name="current_password"
                value={formData.current_password}
                onChange={handleInputChange}
                className={errors.current_password ? 'error' : ''}
                placeholder="Enter current password"
                autoComplete="current-password"
              />
              {errors.current_password && (
                <span className="error-message">{errors.current_password}</span>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="new_password">New Password</label>
              <input
                type="password"
                id="new_password"
                name="new_password"
                value={formData.new_password}
                onChange={handleInputChange}
                className={errors.new_password ? 'error' : ''}
                placeholder="Enter new password"
                autoComplete="new-password"
              />
              {errors.new_password && (
                <span className="error-message">{errors.new_password}</span>
              )}

              {formData.new_password && (
                <div className="password-strength" style={{ marginTop: 8 }}>
                  <div className="strength-bar-container">
                    <div
                      className="strength-bar"
                      style={{
                        width: `${(passwordStrength.score / 6) * 100}%`,
                        backgroundColor: strengthInfo.color,
                      }}
                    />
                  </div>
                  <span className="strength-label" style={{ color: strengthInfo.color }}>
                    {strengthInfo.label}
                  </span>
                  {passwordStrength.feedback.length > 0 && (
                    <span className="strength-hints">
                      {' — Need: ' + passwordStrength.feedback.join(', ')}
                    </span>
                  )}
                </div>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="confirm_password">Confirm Password</label>
              <input
                type="password"
                id="confirm_password"
                name="confirm_password"
                value={formData.confirm_password}
                onChange={handleInputChange}
                className={errors.confirm_password ? 'error' : ''}
                placeholder="Confirm new password"
                autoComplete="new-password"
              />
              {errors.confirm_password && (
                <span className="error-message">{errors.confirm_password}</span>
              )}
            </div>

            {errors.submit && (
              <div className="alert alert-error">{errors.submit}</div>
            )}

            <button
              type="submit"
              className="btn btn-primary"
              disabled={submitting || passwordStrength.score < 3}
              style={{ width: '100%' }}
            >
              {submitting ? 'Changing...' : 'Change Password'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default PasswordChangeModal;
