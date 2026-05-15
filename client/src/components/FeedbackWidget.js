import React, { useState } from 'react';
import { useLocation } from 'react-router-dom';
import FeedbackModal from './FeedbackModal';
import './FeedbackWidget.css';

function FeedbackWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const location = useLocation();

  // Hide on login page
  if (location.pathname === '/login') {
    return null;
  }

  return (
    <>
      <button
        className="feedback-widget-button"
        onClick={() => setIsOpen(true)}
        aria-label="Contact Support Team"
        title="Contact Support Team"
      >
        <svg
          className="feedback-icon"
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Main speech bubble */}
          <path
            d="M12 2C6.48 2 2 6.48 2 12c0 1.54.36 2.98.97 4.29L1 23l6.71-1.97C9.02 21.64 10.46 22 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2z"
            fill="white"
            fillOpacity="0.95"
          />
          {/* Thought cloud 1 (top left) */}
          <circle cx="7" cy="6" r="1.8" fill="white" fillOpacity="0.9" />
          <circle cx="8.5" cy="6.5" r="1.3" fill="white" fillOpacity="0.9" />
          <circle cx="6.5" cy="7.5" r="1.2" fill="white" fillOpacity="0.9" />
          {/* Thought cloud 2 (top center) */}
          <circle cx="12" cy="5.5" r="1.5" fill="white" fillOpacity="0.9" />
          <circle cx="13.5" cy="6" r="1.1" fill="white" fillOpacity="0.9" />
          <circle cx="11" cy="6.5" r="1" fill="white" fillOpacity="0.9" />
          {/* Thought cloud 3 (top right) */}
          <circle cx="17" cy="6" r="1.8" fill="white" fillOpacity="0.9" />
          <circle cx="18.5" cy="6.5" r="1.3" fill="white" fillOpacity="0.9" />
          <circle cx="16.5" cy="7.5" r="1.2" fill="white" fillOpacity="0.9" />
        </svg>
      </button>
      <FeedbackModal isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </>
  );
}

export default FeedbackWidget;
