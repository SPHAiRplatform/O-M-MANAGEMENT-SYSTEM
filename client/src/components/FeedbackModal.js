import React, { useState, useEffect } from 'react';
import { submitFeedback, getContactEmail } from '../api/api';
import { useAuth } from '../context/AuthContext';
import { getErrorMessage } from '../utils/errorHandler';
import './FeedbackModal.css';

function FeedbackModal({ isOpen, onClose }) {
  const { user } = useAuth();
  const [contactEmail, setContactEmail] = useState('');
  const [formData, setFormData] = useState({
    subject: 'question',
    message: ''
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setError('');
      setSuccess(false);
      setFormData({ subject: 'question', message: '' });
      getContactEmail()
        .then((data) => setContactEmail(data.contact_email || ''))
        .catch(() => setContactEmail(''));
    }
  }, [isOpen]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      await submitFeedback({
        email: user?.email || user?.username || '',
        subject: formData.subject,
        message: formData.message,
        user_id: user?.id,
        page_url: window.location.pathname
      });

      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
        onClose();
        setFormData({ subject: 'question', message: '' });
      }, 2000);
    } catch (err) {
      setError(getErrorMessage(err, 'Submit failed'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  if (!isOpen) return null;

  return (
    <div className="feedback-modal-overlay" onClick={onClose}>
      <div className="feedback-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="feedback-modal-header">
          <h2>Contact Developer</h2>
          <button className="feedback-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {success ? (
          <div className="feedback-modal-success">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="12" cy="12" r="10" fill="#4CAF50" />
              <path d="M9 12l2 2 4-4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <p>Thank you! Your message has been sent.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="feedback-modal-form">
            {error && (
              <div className="feedback-modal-error">
                {error}
              </div>
            )}

            <div className="feedback-form-group">
              <label>To</label>
              <input
                type="email"
                value={contactEmail || '(not configured)'}
                readOnly
                disabled
              />
            </div>

            <div className="feedback-form-group">
              <label htmlFor="subject">Subject *</label>
              <select
                id="subject"
                name="subject"
                value={formData.subject}
                onChange={handleChange}
                required
                disabled={submitting}
              >
                <option value="question">Question</option>
                <option value="bug">Bug Report</option>
                <option value="feature">Feature Request</option>
                <option value="improvement">Improvement Suggestion</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div className="feedback-form-group">
              <label htmlFor="message">Message *</label>
              <textarea
                id="message"
                name="message"
                value={formData.message}
                onChange={handleChange}
                required
                rows="6"
                placeholder="Please describe your question, bug, or suggestion..."
                disabled={submitting}
              />
            </div>

            <div className="feedback-modal-actions">
              <button
                type="button"
                className="feedback-btn feedback-btn-secondary"
                onClick={onClose}
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="feedback-btn feedback-btn-primary"
                disabled={submitting || !contactEmail}
              >
                {submitting ? 'Sending...' : 'Send Message'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default FeedbackModal;
