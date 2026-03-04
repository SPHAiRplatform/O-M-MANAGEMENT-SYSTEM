import React, { useState, useEffect } from 'react';
import { getCMLetters, getCMLetter, updateCMLetterStatus, getApiBaseUrl, downloadFaultLog, updateCMLetterFaultLog } from '../api/api';
import { useAuth } from '../context/AuthContext';
import { hasOrganizationContext } from '../utils/organizationContext';
import { ErrorAlert, SuccessAlert } from './ErrorAlert';
import './CMLetters.css';

function CMLetters() {
  const [letters, setLetters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ status: '', startDate: '', endDate: '' });
  const [selectedLetter, setSelectedLetter] = useState(null);
  const [letterDetails, setLetterDetails] = useState(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [viewingImage, setViewingImage] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [alertError, setAlertError] = useState(null);
  const [alertSuccess, setAlertSuccess] = useState(null);
  const { user, loading: authLoading } = useAuth();
  const itemsPerPage = 4;

  // Fault log form state
  const [faultLogData, setFaultLogData] = useState({
    reported_by: user?.id || '',
    plant: 'Witkop',
    fault_description: '',
    affected_plant_functionality: '',
    main_affected_item: '',
    production_affected: '',
    affected_item_line: '',
    affected_item_cabinet: '',
    affected_item_inverter: '',
    affected_item_comb_box: '',
    affected_item_bb_tracker: '',
    code_error: '',
    failure_cause: '',
    action_taken: '',
    description: '' // Separate field for description (from images or issue_description)
  });

  useEffect(() => {
    // Wait for AuthContext to finish loading before checking organization context
    if (authLoading) {
      return; // Don't check until auth is loaded
    }
    
    // Only load CM letters if user has organization context
    if (hasOrganizationContext(user)) {
      loadCMLetters();
    } else {
      // System owner without company: show empty CM letters
      setLetters([]);
      setLoading(false);
    }
  }, [filter, user, authLoading]);

  // Reset to page 1 when filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [filter]);

  const loadCMLetters = async () => {
    try {
      const params = {};
      if (filter.status) params.status = filter.status;
      if (filter.startDate) params.startDate = filter.startDate;
      if (filter.endDate) params.endDate = filter.endDate;
      
      const response = await getCMLetters(params);
      setLetters(response.data);
      setLoading(false);
    } catch (error) {
      console.error('Error loading CM letters:', error);
      setLoading(false);
    }
  };

  const loadLetterDetails = async (letterId) => {
    setLoadingDetails(true);
    setShowDetailsModal(true);
    setIsEditing(false);
    try {
      const response = await getCMLetter(letterId);
      setLetterDetails(response.data);
      // Find the letter in the list to set as selected
      const letter = letters.find(l => l.id === letterId);
      setSelectedLetter(letter);
      
      // Load fault log data if available
      if (response.data) {
        setFaultLogData({
          reported_by: response.data.reported_by || user?.id || '',
          plant: response.data.plant || 'Witkop',
          fault_description: response.data.fault_description || '',
          affected_plant_functionality: response.data.affected_plant_functionality || '',
          main_affected_item: response.data.main_affected_item || '',
          production_affected: response.data.production_affected || '',
          affected_item_line: response.data.affected_item_line || '',
          affected_item_cabinet: response.data.affected_item_cabinet || '',
          affected_item_inverter: response.data.affected_item_inverter || '',
          affected_item_comb_box: response.data.affected_item_comb_box || '',
          affected_item_bb_tracker: response.data.affected_item_bb_tracker || '',
          code_error: response.data.code_error || '',
          failure_cause: response.data.failure_cause || '',
          action_taken: response.data.action_taken || ''
        });
      }
    } catch (error) {
      console.error('Error loading CM letter details:', error);
      setAlertError({ message: 'Failed to load CM letter details', details: error.message });
      setShowDetailsModal(false);
    } finally {
      setLoadingDetails(false);
    }
  };

  const closeDetailsModal = () => {
    setShowDetailsModal(false);
    setLetterDetails(null);
    setSelectedLetter(null);
    setIsEditing(false);
  };

  const handleSaveFaultLog = async () => {
    if (!selectedLetter) return;
    
    setSaving(true);
    try {
      await updateCMLetterFaultLog(selectedLetter.id, faultLogData);
      await loadLetterDetails(selectedLetter.id); // Reload to get updated data
      setIsEditing(false);
      setAlertSuccess({ message: 'Fault log data saved successfully!' });
    } catch (error) {
      console.error('Error saving fault log:', error);
      setAlertError({ message: 'Failed to save fault log data', details: error.response?.data?.error || error.message });
    } finally {
      setSaving(false);
    }
  };

  const getImageUrl = (imagePath) => {
    if (!imagePath) {
      console.warn('getImageUrl: No imagePath provided');
      return null;
    }
    
    // If it's already a full URL, return it
    if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
      return imagePath;
    }
    
    // If it's already a company-scoped path (starts with /uploads/companies/), use it directly
    if (imagePath.startsWith('/uploads/companies/')) {
      const apiBase = getApiBaseUrl().replace('/api', '');
      return `${apiBase}${imagePath}`;
    }
    
    // Legacy support: Handle old path formats for backward compatibility
    // - "/uploads/filename.jpg" -> extract "filename.jpg" and use legacy route
    // - "uploads/filename.jpg" -> extract "filename.jpg"
    // - "filename.jpg" -> use as-is
    let filename = imagePath;
    
    if (imagePath.includes('/')) {
      // Extract filename from path (handles both "/uploads/filename.jpg" and "uploads/filename.jpg")
      filename = imagePath.split('/').pop();
    }
    
    // Remove any leading/trailing whitespace
    filename = filename.trim();
    
    // Construct URL - use legacy route for old paths (will be removed after migration)
    // The API base URL is like "http://hostname:3001/api", we need "http://hostname:3001"
    const apiBase = getApiBaseUrl().replace('/api', '');
    const imageUrl = `${apiBase}/uploads/${filename}`;
    
    console.log('getImageUrl (legacy path):', { imagePath, filename, imageUrl, apiBase });
    return imageUrl;
  };

  const handleStatusUpdate = async (letterId, newStatus) => {
    try {
      await updateCMLetterStatus(letterId, { status: newStatus });
      loadCMLetters();
      // Reload details if this letter's modal is currently open
      if (selectedLetter && selectedLetter.id === letterId && showDetailsModal) {
        loadLetterDetails(letterId);
      }
    } catch (error) {
      console.error('Error updating CM letter status:', error);
      setAlertError({ message: 'Failed to update CM letter status', details: error.message });
    }
  };

  const parseJsonField = (field) => {
    if (!field) return null;
    if (typeof field === 'string') {
      try {
        return JSON.parse(field);
      } catch {
        return null;
      }
    }
    return field;
  };

  const handleDownloadFaultLog = async () => {
    // Validate date range
    if (!filter.startDate || !filter.endDate) {
      setAlertError({ message: 'Please select both Start Date and End Date to download the fault log report.' });
      return;
    }

    if (new Date(filter.startDate) > new Date(filter.endDate)) {
      setAlertError({ message: 'Start Date must be before or equal to End Date.' });
      return;
    }
    
    setDownloading(true);
    try {
      // Download based on date range
      await downloadFaultLog('custom', {
        startDate: filter.startDate,
        endDate: filter.endDate
      });
      // Success - file download is handled by the browser
    } catch (error) {
      console.error('Error downloading fault log:', error);
      setAlertError({
        message: 'Failed to download fault log report',
        details: `${error.message || 'Unknown error'}. Please ensure you have CM letters in the selected date range and try again.`
      });
    } finally {
      setDownloading(false);
    }
  };

  if (loading) {
    return <div className="loading">Loading CM letters...</div>;
  }

  // Calculate pagination
  const totalPages = Math.ceil(letters.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentLetters = letters.slice(startIndex, endIndex);
  const startItem = letters.length > 0 ? startIndex + 1 : 0;
  const endItem = Math.min(endIndex, letters.length);

  return (
    <div>
      <ErrorAlert
        error={alertError}
        onClose={() => setAlertError(null)}
        title="CM Letters Error"
      />
      <SuccessAlert
        message={alertSuccess?.message}
        onClose={() => setAlertSuccess(null)}
        title="Success"
      />
      <div style={{ marginBottom: '20px' }}>
        <h2 className="page-title" style={{ margin: '0 0 20px 0' }}>Corrective Maintenance Letters</h2>
        
        {/* Filters Section */}
        <div className="card cm-filters" style={{ marginBottom: '20px' }}>
          <h3 className="cm-filters-title" style={{ marginTop: 0, marginBottom: '12px' }}>Filters</h3>
          <div className="cm-filters-grid" style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', 
            gap: '15px',
            alignItems: 'end'
          }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label style={{ fontSize: '13px', fontWeight: '500', marginBottom: '5px', display: 'block' }}>Status</label>
              <select
                value={filter.status}
                onChange={(e) => setFilter({ ...filter, status: e.target.value })}
                style={{ width: '100%', padding: '8px', fontSize: '14px' }}
              >
                <option value="">All Statuses</option>
                <option value="open">Open</option>
                <option value="in_progress">In Progress</option>
                <option value="resolved">Resolved</option>
                <option value="closed">Closed</option>
              </select>
            </div>
            
            <div className="form-group" style={{ margin: 0 }}>
              <label style={{ fontSize: '13px', fontWeight: '500', marginBottom: '5px', display: 'block' }}>Start Date</label>
              <input
                type="date"
                value={filter.startDate}
                onChange={(e) => setFilter({ ...filter, startDate: e.target.value })}
                style={{ width: '100%', padding: '8px', fontSize: '14px' }}
              />
            </div>
            
            <div className="form-group" style={{ margin: 0 }}>
              <label style={{ fontSize: '13px', fontWeight: '500', marginBottom: '5px', display: 'block' }}>End Date</label>
              <input
                type="date"
                value={filter.endDate}
                onChange={(e) => setFilter({ ...filter, endDate: e.target.value })}
                style={{ width: '100%', padding: '8px', fontSize: '14px' }}
                min={filter.startDate || undefined}
              />
            </div>
            
            <div className="cm-filters-actions" style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                className="btn btn-sm btn-secondary"
                onClick={() => setFilter({ status: '', startDate: '', endDate: '' })}
                style={{ padding: '8px 16px', fontSize: '14px' }}
              >
                Clear
              </button>
              <button
                className="btn btn-sm btn-primary"
                onClick={handleDownloadFaultLog}
                disabled={downloading || !filter.startDate || !filter.endDate}
                style={{ 
                  padding: '8px 16px', 
                  fontSize: '14px',
                  opacity: (!filter.startDate || !filter.endDate) ? 0.6 : 1,
                  cursor: (!filter.startDate || !filter.endDate) ? 'not-allowed' : 'pointer'
                }}
                title={!filter.startDate || !filter.endDate 
                  ? 'Please select Start Date and End Date to download' 
                  : `Download fault log from ${filter.startDate} to ${filter.endDate}`}
              >
                {downloading ? 'Generating...' : 'Download'}
              </button>
            </div>
          </div>
          {downloading && (
            <div style={{ 
              marginTop: '15px', 
              color: '#17a2b8', 
              fontSize: '14px', 
              fontWeight: '500', 
              display: 'flex', 
              alignItems: 'center', 
              gap: '8px' 
            }}>
              <span style={{ 
                display: 'inline-block', 
                width: '14px', 
                height: '14px', 
                border: '2px solid #f3f3f3', 
                borderTop: '2px solid #17a2b8', 
                borderRadius: '50%', 
                animation: 'spin 1s linear infinite'
              }}></span>
              Generating...
            </div>
          )}
          <style>{`
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          `}</style>
        </div>
      </div>

      <div className="card">
        {/* Show active filters indicator */}
        {(filter.status || filter.startDate || filter.endDate) && (
          <div style={{ 
            marginBottom: '15px', 
            padding: '10px', 
            backgroundColor: '#e7f3ff', 
            borderRadius: '4px',
            fontSize: '13px',
            color: '#0066cc'
          }}>
            <strong>Active Filters:</strong>
            {filter.status && <span style={{ marginLeft: '10px' }}>Status: {filter.status.replace('_', ' ')}</span>}
            {filter.startDate && <span style={{ marginLeft: '10px' }}>From: {filter.startDate}</span>}
            {filter.endDate && <span style={{ marginLeft: '10px' }}>To: {filter.endDate}</span>}
            <span style={{ marginLeft: '10px', color: '#666' }}>
              ({letters.length} {letters.length === 1 ? 'letter' : 'letters'} found)
            </span>
          </div>
        )}
        
        {letters.length === 0 ? (
          <p>No CM letters found{filter.status || filter.startDate || filter.endDate ? ' matching the selected filters' : ''}</p>
        ) : (
          <>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #ddd' }}>
                  <th style={{ padding: '10px', textAlign: 'left', width: '80px', minWidth: '70px' }}>Cabinet</th>
                  <th style={{ padding: '10px', textAlign: 'left' }}>Description</th>
                  <th style={{ padding: '10px', textAlign: 'left' }}>Action Taken</th>
                  <th style={{ padding: '10px', textAlign: 'left' }}>Status</th>
                  <th style={{ padding: '10px', textAlign: 'left' }}>Date</th>
                  <th style={{ padding: '10px', textAlign: 'left' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {currentLetters.map((letter) => {
                  // Extract description from first image comment
                  let description = '';
                  if (letter.images) {
                    try {
                      const images = typeof letter.images === 'string' ? JSON.parse(letter.images) : letter.images;
                      if (Array.isArray(images) && images.length > 0 && images[0]?.comment) {
                        description = images[0].comment;
                      }
                    } catch (e) {
                      // Ignore parse errors
                    }
                  }
                  
                  // Get action taken from fault log
                  const actionTaken = letter.action_taken || '';
                  
                  // Truncate long text for UI friendliness
                  const truncateText = (text, maxLength = 60) => {
                    if (!text) return '';
                    return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
                  };
                  
                  // Get cabinet number from fault log data
                  const cabinetNumber = letter.affected_item_cabinet ? String(letter.affected_item_cabinet) : '';
                  
                  return (
                    <tr key={letter.id} style={{ borderBottom: '1px solid #eee' }}>
                      <td 
                        data-label="Cabinet" 
                        style={{ 
                          padding: '10px',
                          width: '80px',
                          minWidth: '70px',
                          textAlign: 'center'
                        }}
                      >
                        {cabinetNumber ? (
                          <span style={{ 
                            display: 'inline-block',
                            padding: '4px 8px',
                            backgroundColor: '#e9ecef',
                            borderRadius: '4px',
                            fontSize: '13px',
                            fontWeight: '500',
                            fontFamily: 'monospace'
                          }}>
                            {cabinetNumber}
                          </span>
                        ) : (
                          <span style={{ color: '#999', fontStyle: 'italic' }}>—</span>
                        )}
                      </td>
                      <td 
                        data-label="Description" 
                        style={{ 
                          padding: '10px', 
                          maxWidth: '300px',
                          wordBreak: 'break-word'
                        }}
                        title={description || 'No description available'}
                      >
                        {description ? (
                          <div style={{ 
                            overflow: 'hidden', 
                            textOverflow: 'ellipsis', 
                            whiteSpace: 'nowrap',
                            cursor: description.length > 60 ? 'help' : 'default',
                            lineHeight: '1.4'
                          }}>
                            {truncateText(description, 60)}
                          </div>
                        ) : (
                          <span style={{ color: '#999', fontStyle: 'italic' }}>—</span>
                        )}
                      </td>
                      <td 
                        data-label="Action Taken" 
                        style={{ 
                          padding: '10px', 
                          maxWidth: '300px',
                          wordBreak: 'break-word'
                        }}
                        title={actionTaken || 'No action taken recorded'}
                      >
                        {actionTaken ? (
                          <div style={{ 
                            overflow: 'hidden', 
                            textOverflow: 'ellipsis', 
                            whiteSpace: 'nowrap',
                            cursor: actionTaken.length > 60 ? 'help' : 'default',
                            lineHeight: '1.4'
                          }}>
                            {truncateText(actionTaken, 60)}
                          </div>
                        ) : (
                          <span style={{ color: '#999', fontStyle: 'italic' }}>—</span>
                        )}
                      </td>
                      <td data-label="Status" style={{ padding: '10px' }}>
                        <span className={`task-badge ${letter.status}`}>
                          {letter.status.replace('_', ' ')}
                        </span>
                      </td>
                      <td data-label="Date" style={{ padding: '10px', fontSize: '13px', color: '#666' }}>
                        {new Date(letter.generated_at).toLocaleDateString()}
                      </td>
                      <td data-label="Action" style={{ padding: '10px' }}>
                        <button
                          className="btn btn-primary"
                          onClick={() => loadLetterDetails(letter.id)}
                          style={{ padding: '6px 14px', fontSize: '12px', minHeight: '32px' }}
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            
            <div style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center', 
              marginTop: '15px',
              flexWrap: 'wrap',
              gap: '10px',
              paddingTop: '12px',
              borderTop: '1px solid #eee'
            }}>
              <div style={{ fontSize: '12px', color: '#666' }}>
                Showing {startItem}-{endItem} of {letters.length} letter{letters.length !== 1 ? 's' : ''}
              </div>
              {totalPages > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span
                    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                    style={{
                      fontSize: '18px',
                      color: currentPage === 1 ? '#ccc' : '#007bff',
                      cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
                      userSelect: 'none',
                      padding: '4px 8px',
                      lineHeight: '1'
                    }}
                    title="Previous page"
                  >
                    ‹
                  </span>
                  <span style={{ fontSize: '12px', color: '#666', padding: '0 4px' }}>
                    Page {currentPage} of {totalPages}
                  </span>
                  <span
                    onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                    style={{
                      fontSize: '18px',
                      color: currentPage === totalPages ? '#ccc' : '#007bff',
                      cursor: currentPage === totalPages ? 'not-allowed' : 'pointer',
                      userSelect: 'none',
                      padding: '4px 8px',
                      lineHeight: '1'
                    }}
                    title="Next page"
                  >
                    ›
                  </span>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Details Modal */}
      {showDetailsModal && selectedLetter && (
        <div
          onClick={closeDetailsModal}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '20px',
            overflow: 'auto'
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'white',
              borderRadius: '8px',
              maxWidth: '900px',
              width: '100%',
              maxHeight: '90vh',
              overflow: 'auto',
              boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
              position: 'relative'
            }}
          >
            {/* Modal Header */}
            <div style={{
              padding: '20px',
              borderBottom: '1px solid #eee',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              position: 'sticky',
              top: 0,
              background: 'white',
              zIndex: 10
            }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 600 }}>
                  {selectedLetter.letter_number}
                </h2>
                <div style={{ fontSize: '14px', color: '#666', marginTop: '4px' }}>
                  {selectedLetter.asset_name || 'N/A'} • {selectedLetter.task_code || 'N/A'}
                </div>
              </div>
              <button
                onClick={closeDetailsModal}
                style={{
                  background: 'transparent',
                  border: 'none',
                  fontSize: '24px',
                  cursor: 'pointer',
                  color: '#666',
                  padding: '4px 8px',
                  lineHeight: '1'
                }}
                title="Close"
              >
                ×
              </button>
            </div>

            {/* Modal Content */}
            <div style={{ padding: '20px' }}>
              {loadingDetails ? (
                <div style={{ textAlign: 'center', padding: '40px' }}>Loading details...</div>
              ) : letterDetails ? (
                <>
                  {(() => {
                    // Parse images and failure comments
                    let images = [];
                    const imagesData = letterDetails?.images || selectedLetter.images;
                    
                    if (imagesData) {
                      const parsed = parseJsonField(imagesData);
                      if (Array.isArray(parsed)) {
                        images = parsed.filter(img => img && (img.path || img.image_path || img.filename || img.image_filename));
                      } else if (parsed && typeof parsed === 'object') {
                        if (parsed.path || parsed.image_path || parsed.filename || parsed.image_filename) {
                          images = [parsed];
                        }
                      }
                    }
                    
                    const failureComments = parseJsonField(letterDetails?.failure_comments || selectedLetter.failure_comments) || [];

                    return (
                      <>
                        {/* Issue Description with Images */}
                        {letterDetails?.issue_description && (
                            <div style={{ marginBottom: '20px' }}>
                              <h3 style={{ marginBottom: '12px', fontSize: '16px', fontWeight: 600 }}>Issue Description</h3>
                              <div style={{ 
                                padding: '12px', 
                                background: '#fff3cd', 
                                borderLeft: '4px solid #ffc107',
                                borderRadius: '4px',
                                whiteSpace: 'pre-wrap',
                                lineHeight: '1.6',
                                marginBottom: images.length > 0 ? '16px' : '0'
                              }}>
                                {letterDetails.issue_description}
                              </div>
                              
                            {/* Images with Descriptions - Right under Issue Description */}
                            {images.length > 0 && (
                              <div style={{ marginTop: '16px' }}>
                                <h4 style={{ marginBottom: '12px', fontSize: '15px', fontWeight: 600, color: '#333' }}>
                                  Related Images ({images.length})
                                </h4>
                                <div style={{ 
                                  display: 'grid', 
                                  gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                                  gap: '16px'
                                }}>
                                  {images.map((img, idx) => {
                                    const imagePath = img.path || img.image_path || img.filename || img.image_filename;
                                    const imageUrl = getImageUrl(imagePath);
                                    const description = img.comment || img.description || '';
                                    
                                    if (!imageUrl) {
                                      return (
                                        <div key={idx} style={{ 
                                          padding: '12px',
                                          background: '#fff3cd',
                                          borderRadius: '8px',
                                          border: '1px solid #ffc107'
                                        }}>
                                          <div style={{ fontSize: '12px', color: '#856404', marginBottom: '4px' }}>
                                            WARNING: Image path missing
                                          </div>
                                          {description && (
                                            <div style={{ fontSize: '13px', color: '#333' }}>
                                              <strong>Description:</strong> {description}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    }

                                    return (
                                      <div key={idx} style={{ 
                                        background: 'white',
                                        borderRadius: '8px',
                                        padding: '12px',
                                        border: '1px solid #e0e0e0',
                                        boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
                                        display: 'flex',
                                        flexDirection: 'column'
                                      }}>
                                        <div style={{ position: 'relative', width: '100%', height: '180px', marginBottom: '12px' }}>
                                          <img
                                            src={imageUrl}
                                            alt={description || `Image ${idx + 1}`}
                                            onClick={() => setViewingImage(imageUrl)}
                                            style={{
                                              width: '100%',
                                              height: '100%',
                                              objectFit: 'cover',
                                              borderRadius: '6px',
                                              cursor: 'pointer',
                                              border: '2px solid #e0e0e0',
                                              transition: 'transform 0.2s, box-shadow 0.2s'
                                            }}
                                            onMouseEnter={(e) => {
                                              e.currentTarget.style.transform = 'scale(1.05)';
                                              e.currentTarget.style.boxShadow = '0 4px 8px rgba(0,0,0,0.15)';
                                            }}
                                            onMouseLeave={(e) => {
                                              e.currentTarget.style.transform = 'scale(1)';
                                              e.currentTarget.style.boxShadow = 'none';
                                            }}
                                            onError={(e) => {
                                              console.error('Failed to load image:', imageUrl);
                                              e.target.style.display = 'none';
                                            }}
                                          />
                                        </div>
                                        <div style={{ 
                                          fontSize: '14px', 
                                          color: '#333',
                                          padding: '10px',
                                          background: '#f8f9fa',
                                          borderRadius: '6px',
                                          lineHeight: '1.6',
                                          whiteSpace: 'pre-wrap',
                                          wordBreak: 'break-word',
                                          flex: 1
                                        }}>
                                          <strong style={{ color: '#007bff', display: 'block', marginBottom: '6px', fontSize: '13px' }}>
                                            Description:
                                          </strong>
                                          <div style={{ color: description ? '#555' : '#999', fontStyle: description ? 'normal' : 'italic' }}>
                                            {description && description.trim() ? description : 'No description'}
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Recommended Action */}
                        {letterDetails?.recommended_action && (
                          <div style={{ marginBottom: '20px' }}>
                            <h3 style={{ marginBottom: '12px', fontSize: '16px', fontWeight: 600 }}>Recommended Action</h3>
                            <div style={{ 
                              padding: '12px', 
                              background: '#d1ecf1', 
                              borderLeft: '4px solid #17a2b8',
                              borderRadius: '4px',
                              whiteSpace: 'pre-wrap',
                              lineHeight: '1.6'
                            }}>
                              {letterDetails.recommended_action}
                            </div>
                          </div>
                        )}

                          {/* Failure Comments */}
                          {failureComments.length > 0 && (
                            <div style={{ marginBottom: '20px' }}>
                              <h3 style={{ marginBottom: '12px', fontSize: '16px', fontWeight: 600 }}>Failure Details</h3>
                              {failureComments.map((comment, idx) => (
                                <div key={idx} style={{ 
                                  marginBottom: '12px',
                                  padding: '12px', 
                                  background: '#f8f9fa', 
                                  borderLeft: '4px solid #dc3545',
                                  borderRadius: '4px'
                                }}>
                                  {comment.comment && (
                                    <div style={{ marginBottom: '8px', whiteSpace: 'pre-wrap', lineHeight: '1.6' }}>
                                      {comment.comment}
                                    </div>
                                  )}
                                  {comment.item_id && (
                                    <div style={{ fontSize: '12px', color: '#666', fontStyle: 'italic' }}>
                                      Item ID: {comment.item_id}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}

                        {/* Images - Show separately if no issue description */}
                        {images.length > 0 && !letterDetails?.issue_description && (
                            <div style={{ marginBottom: '20px' }}>
                              <h3 style={{ marginBottom: '12px', fontSize: '16px', fontWeight: 600 }}>
                                Attached Images ({images.length})
                              </h3>
                              <div style={{ 
                                display: 'grid', 
                                gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                                gap: '16px'
                              }}>
                                {images.map((img, idx) => {
                                  const imagePath = img.path || img.image_path || img.filename || img.image_filename;
                                  const imageUrl = getImageUrl(imagePath);
                                  const description = img.comment || img.description || '';
                                  
                                  if (!imageUrl) return null;

                                  return (
                                    <div key={idx} style={{ 
                                      background: 'white',
                                      borderRadius: '8px',
                                      padding: '12px',
                                      border: '1px solid #e0e0e0',
                                      boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
                                      display: 'flex',
                                      flexDirection: 'column'
                                    }}>
                                      <div style={{ position: 'relative', width: '100%', height: '180px', marginBottom: description ? '12px' : '0' }}>
                                        <img
                                          src={imageUrl}
                                          alt={description || `Image ${idx + 1}`}
                                          onClick={() => setViewingImage(imageUrl)}
                                          style={{
                                            width: '100%',
                                            height: '100%',
                                            objectFit: 'cover',
                                            borderRadius: '6px',
                                            cursor: 'pointer',
                                            border: '2px solid #e0e0e0',
                                            transition: 'transform 0.2s, box-shadow 0.2s'
                                          }}
                                          onMouseEnter={(e) => {
                                            e.currentTarget.style.transform = 'scale(1.05)';
                                            e.currentTarget.style.boxShadow = '0 4px 8px rgba(0,0,0,0.15)';
                                          }}
                                          onMouseLeave={(e) => {
                                            e.currentTarget.style.transform = 'scale(1)';
                                            e.currentTarget.style.boxShadow = 'none';
                                          }}
                                        />
                                      </div>
                                      {description && (
                                        <div style={{ 
                                          fontSize: '14px', 
                                          color: '#333',
                                          padding: '10px',
                                          background: '#f8f9fa',
                                          borderRadius: '6px',
                                          lineHeight: '1.6',
                                          whiteSpace: 'pre-wrap',
                                          wordBreak: 'break-word',
                                          flex: 1
                                        }}>
                                          <strong style={{ color: '#007bff', display: 'block', marginBottom: '6px', fontSize: '13px' }}>
                                            Description:
                                          </strong>
                                          <div style={{ color: '#555' }}>
                                            {description}
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                        {/* Fault Log Form Section */}
                        <div style={{ marginTop: '30px', paddingTop: '20px', borderTop: '2px solid #e0e0e0' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: '#333' }}>
                              Fault Log Information
                            </h3>
                            {!isEditing && (
                              <button
                                className="btn btn-primary btn-sm"
                                onClick={() => setIsEditing(true)}
                                style={{ padding: '6px 14px', fontSize: '13px' }}
                              >
                                Edit
                              </button>
                            )}
                          </div>

                          {isEditing ? (
                            <div style={{ 
                              background: '#f8f9fa', 
                              padding: '20px', 
                              borderRadius: '8px',
                              border: '1px solid #dee2e6'
                            }}>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '15px', marginBottom: '20px' }}>
                                {/* Reported By - Auto-filled from user */}
                                <div className="form-group">
                                  <label>Reported By *</label>
                                  <input
                                    type="text"
                                    value={user?.full_name || user?.username || 'Current User'}
                                    disabled
                                    style={{ background: '#e9ecef', cursor: 'not-allowed' }}
                                  />
                                  <small style={{ color: '#666', fontSize: '12px' }}>Automatically set to current user</small>
                                </div>

                                {/* Plant */}
                                <div className="form-group">
                                  <label>Plant *</label>
                                  <input
                                    type="text"
                                    value={faultLogData.plant}
                                    onChange={(e) => setFaultLogData({ ...faultLogData, plant: e.target.value })}
                                    placeholder="Witkop"
                                  />
                                </div>

                                {/* Fault Description */}
                                <div className="form-group">
                                  <label>Fault Description *</label>
                                  <select
                                    value={faultLogData.fault_description}
                                    onChange={(e) => setFaultLogData({ ...faultLogData, fault_description: e.target.value })}
                                    required
                                  >
                                    <option value="">Select...</option>
                                    <option value="Preventive maintenance">Preventive maintenance</option>
                                    <option value="Corrective maintenance">Corrective maintenance</option>
                                    <option value="Incident">Incident</option>
                                    <option value="Test">Test</option>
                                    <option value="Other">Other</option>
                                  </select>
                                </div>

                                {/* Affected Plant Functionality */}
                                <div className="form-group">
                                  <label>Affected Plant Functionality *</label>
                                  <select
                                    value={faultLogData.affected_plant_functionality}
                                    onChange={(e) => setFaultLogData({ ...faultLogData, affected_plant_functionality: e.target.value })}
                                    required
                                  >
                                    <option value="">Select...</option>
                                    <option value="Safety">Safety</option>
                                    <option value="Availability/Yield">Availability/Yield</option>
                                    <option value="Monitoring">Monitoring</option>
                                    <option value="Security">Security</option>
                                    <option value="Plant structure">Plant structure</option>
                                    <option value="Other">Other</option>
                                  </select>
                                </div>

                                {/* Main Affected Item */}
                                <div className="form-group">
                                  <label>Main Affected Item *</label>
                                  <select
                                    value={faultLogData.main_affected_item}
                                    onChange={(e) => setFaultLogData({ ...faultLogData, main_affected_item: e.target.value })}
                                    required
                                  >
                                    <option value="">Select...</option>
                                    <option value="Cabinet">Cabinet</option>
                                    <option value="Transformer">Transformer</option>
                                    <option value="Inverter">Inverter</option>
                                    <option value="Motor Tracker">Motor Tracker</option>
                                    <option value="Module">Module</option>
                                    <option value="BB">BB</option>
                                    <option value="CB">CB</option>
                                    <option value="String">String</option>
                                    <option value="Meter">Meter</option>
                                    <option value="Communication device">Communication device</option>
                                    <option value="Security Device">Security Device</option>
                                    <option value="Other">Other</option>
                                  </select>
                                </div>

                                {/* Production Affected */}
                                <div className="form-group">
                                  <label>Production Affected? *</label>
                                  <select
                                    value={faultLogData.production_affected}
                                    onChange={(e) => setFaultLogData({ ...faultLogData, production_affected: e.target.value })}
                                    required
                                  >
                                    <option value="">Select...</option>
                                    <option value="Yes">Yes</option>
                                    <option value="No">No</option>
                                  </select>
                                </div>
                              </div>

                              {/* Affected Item Details Section */}
                              <div style={{ marginTop: '25px', paddingTop: '20px', borderTop: '1px solid #dee2e6' }}>
                                <h4 style={{ marginBottom: '15px', fontSize: '16px', fontWeight: 600, color: '#495057' }}>
                                  Affected Item Details
                                </h4>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '15px' }}>
                                  {/* Line */}
                                  <div className="form-group">
                                    <label>Line (Optional)</label>
                                    <input
                                      type="text"
                                      value={faultLogData.affected_item_line}
                                      onChange={(e) => setFaultLogData({ ...faultLogData, affected_item_line: e.target.value })}
                                      placeholder="Enter line number"
                                    />
                                  </div>

                                  {/* Cabinet */}
                                  <div className="form-group">
                                    <label>Cabinet</label>
                                    <select
                                      value={faultLogData.affected_item_cabinet || ''}
                                      onChange={(e) => setFaultLogData({ ...faultLogData, affected_item_cabinet: e.target.value ? parseInt(e.target.value) : null })}
                                    >
                                      <option value="">Select...</option>
                                      {Array.from({ length: 50 }, (_, i) => i + 1).map(num => (
                                        <option key={num} value={num}>{num}</option>
                                      ))}
                                    </select>
                                  </div>

                                  {/* Inverter */}
                                  <div className="form-group">
                                    <label>Inverter</label>
                                    <select
                                      value={faultLogData.affected_item_inverter}
                                      onChange={(e) => setFaultLogData({ ...faultLogData, affected_item_inverter: e.target.value })}
                                    >
                                      <option value="">Select...</option>
                                      <option value="1">1</option>
                                      <option value="2">2</option>
                                      <option value="1 and 2">1 and 2</option>
                                    </select>
                                  </div>

                                  {/* Comb Box */}
                                  <div className="form-group">
                                    <label>Comb Box</label>
                                    <input
                                      type="text"
                                      value={faultLogData.affected_item_comb_box}
                                      onChange={(e) => setFaultLogData({ ...faultLogData, affected_item_comb_box: e.target.value })}
                                      placeholder="Enter comb box number"
                                    />
                                  </div>

                                  {/* BB / Tracker */}
                                  <div className="form-group">
                                    <label>BB / Tracker</label>
                                    <select
                                      value={faultLogData.affected_item_bb_tracker}
                                      onChange={(e) => setFaultLogData({ ...faultLogData, affected_item_bb_tracker: e.target.value })}
                                    >
                                      <option value="">Select...</option>
                                      {Array.from({ length: 99 }, (_, i) => {
                                        const num = i + 1;
                                        const trackerCode = `M${num.toString().padStart(2, '0')}`;
                                        return <option key={num} value={trackerCode}>{trackerCode}</option>;
                                      })}
                                    </select>
                                  </div>
                                </div>
                              </div>

                              {/* Additional Fields */}
                              <div style={{ marginTop: '25px', paddingTop: '20px', borderTop: '1px solid #dee2e6' }}>
                                <h4 style={{ marginBottom: '15px', fontSize: '16px', fontWeight: 600, color: '#495057' }}>
                                  Additional Information
                                </h4>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '15px' }}>
                                  {/* Description - Auto-filled from image description or issue description */}
                                  <div className="form-group">
                                    <label>Description</label>
                                    <textarea
                                      rows="3"
                                      value={faultLogData.description || (images.length > 0 && images[0]?.comment) || letterDetails?.issue_description || ''}
                                      onChange={(e) => setFaultLogData({ ...faultLogData, description: e.target.value })}
                                      placeholder="Description from images or issue description"
                                    />
                                    <small style={{ color: '#666', fontSize: '12px' }}>
                                      {images.length > 0 && images[0]?.comment
                                        ? <><i className="bi bi-lightbulb"></i> Auto-filled from image description. You can edit it.</>
                                        : letterDetails?.issue_description
                                          ? <><i className="bi bi-lightbulb"></i> Will use issue description if not filled</>
                                          : 'Enter description or it will be taken from issue description'}
                                    </small>
                                  </div>

                                  {/* Code Error */}
                                  <div className="form-group">
                                    <label>Code Error (Optional)</label>
                                    <input
                                      type="text"
                                      value={faultLogData.code_error}
                                      onChange={(e) => setFaultLogData({ ...faultLogData, code_error: e.target.value })}
                                      placeholder="Enter error code if available"
                                    />
                                  </div>

                                  {/* Failure Cause */}
                                  <div className="form-group">
                                    <label>Failure Cause</label>
                                    <input
                                      type="text"
                                      value={faultLogData.failure_cause}
                                      onChange={(e) => setFaultLogData({ ...faultLogData, failure_cause: e.target.value })}
                                      placeholder="Enter failure cause"
                                    />
                                  </div>

                                  {/* Action Taken */}
                                  <div className="form-group">
                                    <label>Action Taken</label>
                                    <textarea
                                      rows="3"
                                      value={faultLogData.action_taken}
                                      onChange={(e) => setFaultLogData({ ...faultLogData, action_taken: e.target.value })}
                                      placeholder="Describe the action taken to resolve the issue"
                                    />
                                  </div>
                                </div>
                              </div>

                              {/* Form Actions */}
                              <div style={{ display: 'flex', gap: '10px', marginTop: '25px', paddingTop: '20px', borderTop: '1px solid #dee2e6' }}>
                                <button
                                  className="btn btn-primary"
                                  onClick={handleSaveFaultLog}
                                  disabled={saving}
                                  style={{ flex: 1 }}
                                >
                                  {saving ? 'Saving...' : '💾 Save Fault Log Data'}
                                </button>
                                <button
                                  className="btn btn-secondary"
                                  onClick={() => {
                                    setIsEditing(false);
                                    // Reload to reset form
                                    if (selectedLetter) {
                                      loadLetterDetails(selectedLetter.id);
                                    }
                                  }}
                                  disabled={saving}
                                  style={{ flex: 1 }}
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            /* View Mode - Display current fault log data */
                            <div style={{ 
                              background: '#f8f9fa', 
                              padding: '20px', 
                              borderRadius: '8px',
                              border: '1px solid #dee2e6'
                            }}>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '15px' }}>
                                <div><strong>Reported By:</strong> {letterDetails?.reported_by_name || user?.full_name || 'N/A'}</div>
                                <div><strong>Plant:</strong> {letterDetails?.plant || 'Witkop'}</div>
                                <div><strong>Fault Description:</strong> {letterDetails?.fault_description || 'Not set'}</div>
                                <div><strong>Affected Functionality:</strong> {letterDetails?.affected_plant_functionality || 'Not set'}</div>
                                <div><strong>Main Affected Item:</strong> {letterDetails?.main_affected_item || 'Not set'}</div>
                                <div><strong>Production Affected:</strong> {letterDetails?.production_affected || 'Not set'}</div>
                                {letterDetails?.affected_item_line && <div><strong>Line:</strong> {letterDetails.affected_item_line}</div>}
                                {letterDetails?.affected_item_cabinet && <div><strong>Cabinet:</strong> {letterDetails.affected_item_cabinet}</div>}
                                {letterDetails?.affected_item_inverter && <div><strong>Inverter:</strong> {letterDetails.affected_item_inverter}</div>}
                                {letterDetails?.affected_item_comb_box && <div><strong>Comb Box:</strong> {letterDetails.affected_item_comb_box}</div>}
                                {letterDetails?.affected_item_bb_tracker && <div><strong>BB/Tracker:</strong> {letterDetails.affected_item_bb_tracker}</div>}
                                {letterDetails?.code_error && <div><strong>Code Error:</strong> {letterDetails.code_error}</div>}
                                {letterDetails?.failure_cause && <div><strong>Failure Cause:</strong> {letterDetails.failure_cause}</div>}
                                {letterDetails?.action_taken && <div><strong>Action Taken:</strong> {letterDetails.action_taken}</div>}
                              </div>
                              {!letterDetails?.fault_description && (
                                <div style={{ marginTop: '15px', padding: '12px', background: '#fff3cd', borderRadius: '4px', color: '#856404' }}>
                                  <i className="bi bi-exclamation-triangle"></i> Fault log information not yet filled. Click "Edit Fault Log" to add the required information.
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Action Buttons */}
                        <div style={{ display: 'flex', gap: '10px', marginTop: '20px', flexWrap: 'wrap' }}>
                          {selectedLetter.status === 'open' && (
                            <button
                              className="btn btn-success"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleStatusUpdate(selectedLetter.id, 'in_progress');
                                closeDetailsModal();
                                loadCMLetters();
                              }}
                              style={{ flex: '1', minWidth: '120px' }}
                            >
                              Start
                            </button>
                          )}
                          {selectedLetter.status === 'in_progress' && (
                            <button
                              className="btn btn-primary"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleStatusUpdate(selectedLetter.id, 'resolved');
                                closeDetailsModal();
                                loadCMLetters();
                              }}
                              style={{ flex: '1', minWidth: '120px' }}
                            >
                              Resolve
                            </button>
                          )}
                        </div>
                      </>
                    );
                  })()}
                </>
              ) : (
                <div style={{ textAlign: 'center', padding: '40px', color: '#999' }}>
                  No details available
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Image Modal */}
      {viewingImage && (
        <div
          onClick={() => setViewingImage(null)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.9)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000,
            padding: '20px',
            cursor: 'pointer'
          }}
        >
          <img
            src={viewingImage}
            alt="Full size"
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
              objectFit: 'contain',
              borderRadius: '8px'
            }}
          />
          <button
            onClick={() => setViewingImage(null)}
            style={{
              position: 'absolute',
              top: '20px',
              right: '20px',
              background: 'white',
              border: 'none',
              borderRadius: '50%',
              width: '40px',
              height: '40px',
              fontSize: '24px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 2px 8px rgba(0,0,0,0.3)'
            }}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}

export default CMLetters;

