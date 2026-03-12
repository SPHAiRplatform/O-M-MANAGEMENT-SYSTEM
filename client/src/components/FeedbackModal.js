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
  const [attachment, setAttachment] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const fileInputRef = React.useRef(null);

  useEffect(() => {
    if (isOpen) {
      setError('');
      setSuccess(false);
      setFormData({ subject: 'question', message: '' });
      setAttachment(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      getContactEmail()
        .then((data) => setContactEmail(data.contact_email || ''))
        .catch(() => setContactEmail(''));
    }
  }, [isOpen]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (formData.message.trim().length < 20) {
      setError('Message must be at least 20 characters long.');
      return;
    }

    setSubmitting(true);

    try {
      const payload = new FormData();
      payload.append('email', user?.email || user?.username || '');
      payload.append('subject', formData.subject);
      payload.append('message', formData.message);
      payload.append('user_id', user?.id || '');
      payload.append('page_url', window.location.pathname);
      if (attachment) {
        payload.append('attachment', attachment);
      }

      await submitFeedback(payload);

      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
        onClose();
        setFormData({ subject: 'question', message: '' });
        setAttachment(null);
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

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        setError('File size must be under 5MB.');
        e.target.value = '';
        return;
      }
      setAttachment(file);
      setError('');
    }
  };

  const removeAttachment = () => {
    setAttachment(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
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
              <div className="feedback-message-header">
                <label htmlFor="message">Message *</label>
                <button
                  type="button"
                  className="feedback-upload-btn"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={submitting}
                  title="Attach a screenshot or image"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
                  </svg>
                  Attach File
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,.pdf"
                  onChange={handleFileChange}
                  style={{ display: 'none' }}
                />
              </div>
              <textarea
                id="message"
                name="message"
                value={formData.message}
                onChange={handleChange}
                required
                minLength={20}
                rows="6"
                placeholder="Describe the issue or suggestion..."
                disabled={submitting}
              />
              <span className="feedback-char-count" style={{ color: formData.message.trim().length < 20 ? '#999' : '#4CAF50' }}>
                {formData.message.trim().length}/20 min
              </span>
              {attachment && (
                <div className="feedback-attachment-preview">
                  <span className="feedback-attachment-name" title={attachment.name}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
                    </svg>
                    {attachment.name}
                  </span>
                  <button type="button" className="feedback-attachment-remove" onClick={removeAttachment} title="Remove attachment">
                    &times;
                  </button>
                </div>
              )}
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
