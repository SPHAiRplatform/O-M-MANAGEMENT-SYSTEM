import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getTask, submitChecklistResponse, saveDraftResponse, getDraftResponse, deleteDraftResponse, getInventoryItems, authFetch } from '../api/api';
import { useAuth } from '../context/AuthContext';
import { ErrorAlert, SuccessAlert } from './ErrorAlert';

function ChecklistForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [task, setTask] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState({});
  const [errors, setErrors] = useState({});
  const [metadata, setMetadata] = useState({
    maintenance_team: '',
    inspected_by: '',
    approved_by: ''
  });
  // Store images for failed items.
  // Key format: `${sectionId}_${itemId}`
  // Value: { file?, comment?, preview?, uploaded? { id, image_path, image_filename }, uploadedAt? }
  const [itemImages, setItemImages] = useState({});
  const [sparesUsed, setSparesUsed] = useState([]); // [{ item_code, qty_used }]
  const [inventoryOptions, setInventoryOptions] = useState([]);
  const [sparesSearchQuery, setSparesSearchQuery] = useState('');
  const [filteredInventoryOptions, setFilteredInventoryOptions] = useState([]);
  const [showSpareSelection, setShowSpareSelection] = useState(false);
  const [hoursWorked, setHoursWorked] = useState('');
  const { isTechnician, user } = useAuth();
  const [autoSaveStatus, setAutoSaveStatus] = useState(''); // 'saving', 'saved', 'error'
  const [alertError, setAlertError] = useState(null);
  const [alertSuccess, setAlertSuccess] = useState(null);
  const autoSaveTimeoutRef = useRef(null);
  const lastSavedRef = useRef(null);
  const sparesSearchDebounceRef = useRef(null);
  // Refs to track latest state for event listeners (avoids stale closures)
  const formDataRef = useRef(formData);
  const metadataRef = useRef(metadata);
  const itemImagesRef = useRef(itemImages);
  const sparesUsedRef = useRef(sparesUsed);
  const hoursWorkedRef = useRef(hoursWorked);
  const taskRef = useRef(task);
  // Unplanned CM time fields
  const [cmOccurredAt, setCmOccurredAt] = useState('');
  const [cmStartedAt, setCmStartedAt] = useState('');
  const [cmCompletedAt, setCmCompletedAt] = useState('');

  // Keep refs in sync with state
  useEffect(() => { formDataRef.current = formData; }, [formData]);
  useEffect(() => { metadataRef.current = metadata; }, [metadata]);
  useEffect(() => { itemImagesRef.current = itemImages; }, [itemImages]);
  useEffect(() => { sparesUsedRef.current = sparesUsed; }, [sparesUsed]);
  useEffect(() => { hoursWorkedRef.current = hoursWorked; }, [hoursWorked]);
  useEffect(() => { taskRef.current = task; }, [task]);

  // SessionStorage key for this task's form state (sync backup for mobile camera)
  const sessionKey = `checklist_backup_${id}`;

  // Synchronously save form state to sessionStorage (instant, no network)
  const saveToSessionStorage = useCallback(() => {
    try {
      const backup = {
        formData: formDataRef.current,
        metadata: metadataRef.current,
        // Exclude file objects from sessionStorage (not serializable)
        itemImages: Object.fromEntries(
          Object.entries(itemImagesRef.current).map(([k, v]) => [k, {
            comment: v?.comment,
            preview: v?.uploaded ? undefined : v?.preview,
            uploaded: v?.uploaded,
            uploadedAt: v?.uploadedAt
          }])
        ),
        sparesUsed: sparesUsedRef.current,
        hoursWorked: hoursWorkedRef.current,
        savedAt: Date.now()
      };
      sessionStorage.setItem(sessionKey, JSON.stringify(backup));
    } catch (e) {
      // sessionStorage may be full or unavailable; ignore
    }
  }, [sessionKey]);

  useEffect(() => {
    loadTaskAndDraft();
    loadInventoryOptions();

    // Auto-save on unmount + on mobile pagehide
    // Use refs to always access latest state (avoids stale closure bug)
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        // Sync backup first (instant, survives page kill)
        saveToSessionStorage();
        // Then async backup to server
        handleAutoSaveFromRefs();
      }
    };
    const onPageHide = () => {
      saveToSessionStorage();
      handleAutoSaveFromRefs();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', onPageHide);

    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', onPageHide);
      handleAutoSave();
    };
  }, [id]);

  const loadInventoryOptions = async (searchQuery) => {
    try {
      const query = searchQuery?.trim() || undefined;
      const resp = await getInventoryItems({ q: query });
      const items = resp.data || [];
      setInventoryOptions(items);
      setFilteredInventoryOptions(items);
    } catch (e) {
      // inventory is optional; don't block checklist
      console.log('Inventory not available:', e?.message);
    }
  };

  // Debounced search for spares (same as Inventory component)
  useEffect(() => {
    if (sparesSearchDebounceRef.current) clearTimeout(sparesSearchDebounceRef.current);
    sparesSearchDebounceRef.current = setTimeout(() => {
      loadInventoryOptions(sparesSearchQuery);
    }, 450);

    return () => {
      if (sparesSearchDebounceRef.current) clearTimeout(sparesSearchDebounceRef.current);
    };
  }, [sparesSearchQuery]);

  // Auto-save function
  const handleAutoSave = useCallback(async () => {
    if (!task || !task.checklist_template_id) return;

    // Skip if nothing has changed
    const currentState = JSON.stringify({ formData, metadata, images: itemImages, sparesUsed, hoursWorked });
    if (currentState === lastSavedRef.current) return;

    try {
      setAutoSaveStatus('saving');
      await saveDraftResponse({
        task_id: id,
        checklist_template_id: task.checklist_template_id || task.id,
        response_data: formData,
        maintenance_team: metadata.maintenance_team,
        inspected_by: metadata.inspected_by,
        approved_by: metadata.approved_by,
        images: itemImages,
        spares_used: sparesUsed,
        hours_worked: hoursWorked
      });
      lastSavedRef.current = currentState;
      setAutoSaveStatus('saved');
      setTimeout(() => setAutoSaveStatus(''), 2000); // Clear status after 2 seconds
    } catch (error) {
      console.error('Auto-save error:', error);
      setAutoSaveStatus('error');
      setTimeout(() => setAutoSaveStatus(''), 3000);
    }
  }, [formData, metadata, itemImages, sparesUsed, task, id]);

  // Ref-based auto-save for event listeners (avoids stale closure problem)
  const handleAutoSaveFromRefs = useCallback(async () => {
    const t = taskRef.current;
    if (!t || !t.checklist_template_id) return;

    const fd = formDataRef.current;
    const md = metadataRef.current;
    const imgs = itemImagesRef.current;
    const spares = sparesUsedRef.current;
    const hours = hoursWorkedRef.current;

    try {
      await saveDraftResponse({
        task_id: id,
        checklist_template_id: t.checklist_template_id || t.id,
        response_data: fd,
        maintenance_team: md.maintenance_team,
        inspected_by: md.inspected_by,
        approved_by: md.approved_by,
        images: imgs,
        spares_used: spares,
        hours_worked: hours
      });
    } catch (error) {
      console.error('Auto-save (ref) error:', error);
    }
  }, [id]);

  // Debounced auto-save
  useEffect(() => {
    if (!task) return;

    // Clear existing timeout
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }

    // Set new timeout for auto-save (3 seconds after last change)
    autoSaveTimeoutRef.current = setTimeout(() => {
      handleAutoSave();
    }, 3000);

    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
    };
  }, [formData, metadata, itemImages, handleAutoSave, task]);

  const mergeDeep = (base, override) => {
    if (!override) return base;
    if (Array.isArray(base) || Array.isArray(override)) return override ?? base;
    if (typeof base !== 'object' || base === null) return override ?? base;
    const out = { ...base };
    for (const key of Object.keys(override)) {
      const ov = override[key];
      if (ov && typeof ov === 'object' && !Array.isArray(ov)) {
        out[key] = mergeDeep(base[key] || {}, ov);
      } else {
        out[key] = ov;
      }
    }
    return out;
  };

  const loadTaskAndDraft = async () => {
    try {
      const response = await getTask(id);
      setTask(response.data);
      
      // Initialize form data structure
      // checklist_structure comes from the checklist_templates table joined to the task
      const checklistStructure = response.data.checklist_structure;
      if (checklistStructure && checklistStructure.sections) {
        const initialData = {};
        checklistStructure.sections.forEach((section) => {
          initialData[section.id] = {};
          section.items.forEach((item) => {
            if (item.type === 'checkbox') {
              initialData[section.id][item.id] = false;
            } else if (item.type === 'pass_fail' || item.type === 'pass_fail_with_measurement') {
              // Initialize pass_fail items with status and observations
              initialData[section.id][item.id] = {
                status: '', // 'pass' or 'fail'
                observations: '',
                ...(item.measurement_fields ? 
                  item.measurement_fields.reduce((acc, field) => {
                    acc[field.id] = '';
                    return acc;
                  }, {}) : {})
              };
            } else {
              initialData[section.id][item.id] = '';
            }
          });
        });

        // Check sessionStorage backup first (survives mobile camera page kills)
        let sessionBackup = null;
        try {
          const raw = sessionStorage.getItem(`checklist_backup_${id}`);
          if (raw) {
            sessionBackup = JSON.parse(raw);
            // Only use if less than 30 minutes old
            if (sessionBackup.savedAt && (Date.now() - sessionBackup.savedAt) > 30 * 60 * 1000) {
              sessionBackup = null;
            }
          }
        } catch (e) { /* ignore parse errors */ }

        // Load server draft, merge with initial structure
        let draft = null;
        try {
          draft = await getDraftResponse(id);
        } catch (e) {
          console.log('No server draft found');
        }

        // Choose the most recent data source: sessionStorage backup vs server draft
        // sessionStorage is more recent if it was saved after returning from camera
        const useSessionBackup = sessionBackup &&
          sessionBackup.formData &&
          Object.keys(sessionBackup.formData).length > 0 &&
          (!draft || (sessionBackup.savedAt && sessionBackup.savedAt > Date.now() - 60000));

        if (useSessionBackup && sessionBackup) {
          console.log('Restoring from sessionStorage backup (camera recovery)');
          setFormData(mergeDeep(initialData, sessionBackup.formData));
          setMetadata({
            maintenance_team: sessionBackup.metadata?.maintenance_team || '',
            inspected_by: sessionBackup.metadata?.inspected_by || '',
            approved_by: sessionBackup.metadata?.approved_by || ''
          });
          if (sessionBackup.itemImages && typeof sessionBackup.itemImages === 'object') {
            setItemImages(sessionBackup.itemImages);
          }
          if (Array.isArray(sessionBackup.sparesUsed)) {
            setSparesUsed(sessionBackup.sparesUsed);
          }
          if (sessionBackup.hoursWorked !== undefined && sessionBackup.hoursWorked !== '') {
            setHoursWorked(sessionBackup.hoursWorked.toString());
          }
          // Clear the backup now that it's been restored
          sessionStorage.removeItem(`checklist_backup_${id}`);
        } else if (draft) {
          console.log('Draft loaded and merged from server');
          const draftResponseData = draft.response_data || {};
          setFormData(mergeDeep(initialData, draftResponseData));
          setMetadata({
            maintenance_team: draft.maintenance_team || '',
            inspected_by: draft.inspected_by || '',
            approved_by: draft.approved_by || ''
          });
          if (draft.images && typeof draft.images === 'object') {
            setItemImages(draft.images);
          }
          if (Array.isArray(draft.spares_used)) {
            setSparesUsed(draft.spares_used);
          }
          if (draft.hours_worked !== undefined) {
            setHoursWorked(draft.hours_worked.toString());
          }
          lastSavedRef.current = JSON.stringify({ formData: mergeDeep(initialData, draftResponseData), metadata: {
            maintenance_team: draft.maintenance_team || '',
            inspected_by: draft.inspected_by || '',
            approved_by: draft.approved_by || ''
          }});
          // Clear any stale sessionStorage backup
          sessionStorage.removeItem(`checklist_backup_${id}`);
        } else {
          setFormData(initialData);
          console.log('No draft found, starting fresh');
        }
      }
      
      setLoading(false);
    } catch (error) {
      console.error('Error loading task:', error);
      setLoading(false);
    }
  };

  const handleInputChange = (sectionId, itemId, value, subField = null) => {
    setFormData((prev) => {
      const sectionData = prev[sectionId] || {};
      const itemData = sectionData[itemId] || {};
      
      if (subField) {
        // For measurement fields or observations
        return {
          ...prev,
          [sectionId]: {
            ...sectionData,
            [itemId]: {
              ...itemData,
              [subField]: value,
            },
          },
        };
      } else {
        // For main field value
        return {
          ...prev,
          [sectionId]: {
            ...sectionData,
            [itemId]: value,
          },
        };
      }
    });
    // Clear error for this field
    const errorKey = subField ? `${itemId}_${subField}` : itemId;
    if (errors[errorKey]) {
      setErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[errorKey];
        return newErrors;
      });
    }
  };

  const handleImageUpload = async (sectionId, itemId, file, comment) => {
    if (!file) return null;

    const formData = new FormData();
    formData.append('image', file);
    formData.append('task_id', id);
    formData.append('item_id', itemId);
    formData.append('section_id', sectionId);
    if (comment) formData.append('comment', comment);

    try {
      const API_BASE_URL = process.env.REACT_APP_API_URL ||
        `${window.location.protocol}//${window.location.hostname}:3001/api`;
      
      const response = await authFetch(`${API_BASE_URL}/upload/failed-item`, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        throw new Error('Failed to upload image');
      }

      const data = await response.json();
      return { ...data, sectionId, itemId };
    } catch (error) {
      console.error('Error uploading image:', error);
      // Return null - error can be handled by caller
      return null;
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setErrors({});

    // Check if user is assigned to this task
    if (!task || !task.assigned_users || !task.assigned_users.some(u => u.id === user?.id)) {
      setErrors({ general: 'Not assigned' });
      setSubmitting(false);
      return;
    }

    // Validate metadata
    if (!metadata.inspected_by) {
      setAlertError({ message: 'Please enter the name of the person who inspected (Inspected By)' });
      setSubmitting(false);
      return;
    }

    try {
      // Upload any pending images (we also upload immediately on selection; this is a safety net)
      const imageUploads = [];
      for (const [key, imageData] of Object.entries(itemImages)) {
        // Already uploaded
        if (imageData?.uploaded?.image_path) {
          imageUploads.push({
            ...imageData.uploaded,
            sectionId: key.split('_')[0],
            itemId: key.split('_')[1],
            comment: imageData.comment || ''
          });
          continue;
        }

        // Needs upload
        if (imageData?.file) {
          const [sectionId, itemId] = key.split('_');
          const uploadResult = await handleImageUpload(sectionId, itemId, imageData.file, imageData.comment);
          if (uploadResult) {
            imageUploads.push(uploadResult);
          }
        }
      }


      // For UCM tasks, include time fields
      const submitData = {
        task_id: id,
        checklist_template_id: task.checklist_template_id || task.id,
        response_data: formData,
        submitted_by: task.assigned_to || null,
        maintenance_team: metadata.maintenance_team,
        inspected_by: metadata.inspected_by,
        approved_by: metadata.approved_by,
        images: imageUploads,
        spares_used: sparesUsed // Only spares that were selected to use
      };

      // Add UCM time fields if task type is UCM
      if (task.task_type === 'UCM') {
        if (cmOccurredAt) submitData.cm_occurred_at = cmOccurredAt;
        if (cmStartedAt) submitData.started_at = cmStartedAt;
        if (cmCompletedAt) submitData.completed_at = cmCompletedAt;
      }
      
      // Add hours worked if provided
      if (hoursWorked && parseFloat(hoursWorked) > 0) {
        submitData.hours_worked = parseFloat(hoursWorked);
      }

      const response = await submitChecklistResponse(submitData);

      if (response.data.validation && !response.data.validation.isValid) {
        // Show validation errors
        const validationErrors = {};
        response.data.validation.errors.forEach((error) => {
          validationErrors[error.itemId] = error.error;
        });
        setErrors(validationErrors);
        setAlertError({ message: 'Validation failed. Please check the form and fix errors.' });
      } else {
        // Delete draft after successful submission
        try {
          await deleteDraftResponse(id);
        } catch (error) {
          console.error('Error deleting draft:', error);
        }
        
        const overallStatus = response.data.validation.overallStatus.toUpperCase();
        setAlertSuccess({
          message: `Checklist submitted successfully! Overall Status: ${overallStatus}. You can now download the PDF report from the Task Details page.`,
          onClose: () => navigate(`/tasks/${id}`)
        });
      }
    } catch (error) {
      console.error('Error submitting checklist:', error);
      console.error('Error response:', error.response);
      
      if (error.response && error.response.data) {
        // Handle validation errors
        if (error.response.data.details && Array.isArray(error.response.data.details)) {
          const validationErrors = {};
          error.response.data.details.forEach((err) => {
            validationErrors[err.itemId] = err.error;
          });
          setErrors(validationErrors);
          setAlertError({ message: 'Validation failed. Please check the highlighted items.' });
        } else {
          // Handle other errors
          const errorMessage = error.response.data.error || error.response.data.details || 'Failed to submit checklist';
          setAlertError({ message: errorMessage, details: error.response.data });
        }
      } else {
        // Network or other errors
        setAlertError({
          message: 'Failed to submit checklist',
          details: error.message || 'Network error. Please check your connection.'
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="loading">Loading checklist...</div>;
  }

  // Check if user is assigned to this task
  const isAssigned = task && task.assigned_users && task.assigned_users.some(u => u.id === user?.id);
  
  if (task && !isAssigned) {
    return (
      <div style={{ padding: '20px' }}>
        <div style={{ 
          padding: '20px', 
          background: '#fff3cd', 
          borderLeft: '4px solid #ffc107',
          borderRadius: '4px',
          color: '#856404',
          marginBottom: '20px'
        }}>
          <h3 style={{ marginTop: 0 }}>Access Restricted</h3>
          <p>
            <strong>This task is not assigned to you.</strong> You can view task details and download reports, 
            but you cannot fill the checklist or modify this task.
          </p>
          <button 
            className="btn btn-secondary" 
            onClick={() => navigate(`/tasks/${id}`)}
            style={{ marginTop: '10px' }}
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  if (!task) {
    return <div>Task not found</div>;
  }

  const checklistStructure = task.checklist_structure;
  if (!checklistStructure || !checklistStructure.sections) {
    return <div>Checklist template structure not found</div>;
  }

  const renderItem = (sectionId, item) => {
    const value = formData[sectionId]?.[item.id];
    const error = errors[item.id];

    switch (item.type) {
      case 'checkbox':
        return (
          <div className="checkbox-group" key={item.id}>
            <label>
              <input
                type="checkbox"
                checked={value || false}
                onChange={(e) => handleInputChange(sectionId, item.id, e.target.checked)}
              />
              <span className={item.required ? 'item-label required' : 'item-label'}>
                {item.label}
              </span>
            </label>
            {error && <div className="error">{error}</div>}
          </div>
        );

      case 'radio':
        return (
          <div className="radio-group" key={item.id}>
            <div className={item.required ? 'item-label required' : 'item-label'}>
              {item.label}
            </div>
            {item.options && item.options.map((option) => (
              <label key={option}>
                <input
                  type="radio"
                  name={`${sectionId}_${item.id}`}
                  value={option}
                  checked={value === option}
                  onChange={(e) => handleInputChange(sectionId, item.id, e.target.value)}
                />
                {option}
              </label>
            ))}
            {error && <div className="error">{error}</div>}
          </div>
        );

      case 'pass_fail':
      case 'pass_fail_with_measurement':
        const itemValue = value || { status: '', observations: '' };
        return (
          <div className="form-group" key={item.id} style={{ marginBottom: '20px', padding: '15px', border: '1px solid #ddd', borderRadius: '4px' }}>
            <div className={item.required ? 'item-label required' : 'item-label'} style={{ marginBottom: '10px' }}>
              {item.label}
            </div>
            
            {/* Pass/Fail Radio Buttons */}
            <div className="radio-group" style={{ marginBottom: '10px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <label style={{ marginRight: '20px', flex: '1', minWidth: '120px', padding: '12px', border: '1px solid #ddd', borderRadius: '4px', background: itemValue.status === 'pass' ? '#d4edda' : 'white', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name={`${sectionId}_${item.id}_status`}
                  value="pass"
                  checked={itemValue.status === 'pass'}
                  onChange={(e) => handleInputChange(sectionId, item.id, e.target.value, 'status')}
                  style={{ marginRight: '8px' }}
                />
                <span style={{ color: '#28a745', fontWeight: 'bold' }}>Pass</span>
              </label>
              <label style={{ flex: '1', minWidth: '120px', padding: '12px', border: '1px solid #ddd', borderRadius: '4px', background: itemValue.status === 'fail' ? '#f8d7da' : 'white', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name={`${sectionId}_${item.id}_status`}
                  value="fail"
                  checked={itemValue.status === 'fail'}
                  onChange={(e) => handleInputChange(sectionId, item.id, e.target.value, 'status')}
                  style={{ marginRight: '8px' }}
                />
                <span style={{ color: '#dc3545', fontWeight: 'bold' }}>Fail</span>
              </label>
            </div>

            {/* Measurement Fields (for pass_fail_with_measurement) */}
            {item.measurement_fields && item.measurement_fields.map((field) => (
              <div key={field.id} style={{ marginBottom: '10px' }}>
                <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px' }}>
                  {field.label} {field.required && <span style={{ color: 'red' }}>*</span>}
                </label>
                <input
                  type={field.type === 'number' ? 'number' : 'text'}
                  value={itemValue[field.id] || ''}
                  onChange={(e) => handleInputChange(sectionId, item.id, e.target.value, field.id)}
                  style={{ width: '100%', padding: '6px', border: '1px solid #ddd', borderRadius: '4px' }}
                  step={field.type === 'number' ? '0.01' : undefined}
                />
              </div>
            ))}

            {/* Observations Field */}
            {item.has_observations && (
              <div style={{ marginTop: '10px' }}>
                <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px' }}>
                  Observations
                </label>
                <textarea
                  value={itemValue.observations || ''}
                  onChange={(e) => handleInputChange(sectionId, item.id, e.target.value, 'observations')}
                  placeholder="Enter observations or notes..."
                  style={{ width: '100%', minHeight: '60px', padding: '6px', border: '1px solid #ddd', borderRadius: '4px' }}
                />
              </div>
            )}

            {/* Image Upload for Failed Items */}
            {itemValue.status === 'fail' && (
              <div style={{ marginTop: '15px', padding: '15px', background: '#fff3cd', border: '1px solid #ffc107', borderRadius: '4px' }}>
                <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: 'bold' }}>
                  Upload Image for Failed Item (Required for CM)
                </label>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onClick={() => {
                    // SYNC save to sessionStorage before camera opens (instant, survives page kill)
                    saveToSessionStorage();
                    // Also fire async server save (may not complete before camera)
                    handleAutoSave();
                  }}
                  onChange={(e) => {
                    const file = e.target.files[0];
                    if (file) {
                      const key = `${sectionId}_${item.id}`;
                      const previewUrl = URL.createObjectURL(file);

                      // Optimistic update for preview
                      setItemImages(prev => ({
                        ...prev,
                        [key]: {
                          ...prev[key],
                          file,
                          preview: previewUrl
                        }
                      }));

                      // Upload immediately so a refresh/camera return won't lose it
                      (async () => {
                        const uploadResult = await handleImageUpload(sectionId, item.id, file, itemImages[key]?.comment || '');
                        if (uploadResult) {
                          setItemImages(prev => {
                            const updated = {
                              ...prev,
                              [key]: {
                                ...prev[key],
                                uploaded: {
                                  id: uploadResult.id,
                                  image_path: uploadResult.image_path,
                                  image_filename: uploadResult.image_filename
                                },
                                uploadedAt: new Date().toISOString()
                              }
                            };
                            // Save draft with the ACTUAL updated images (not stale closure)
                            itemImagesRef.current = updated;
                            // Sync backup immediately with correct data
                            setTimeout(() => saveToSessionStorage(), 0);
                            return updated;
                          });
                        }
                      })();
                    }
                  }}
                  style={{ marginBottom: '10px', width: '100%' }}
                />
                {itemImages[`${sectionId}_${item.id}`]?.preview && (
                  <div style={{ marginBottom: '10px' }}>
                    <img 
                      src={itemImages[`${sectionId}_${item.id}`].preview} 
                      alt="Preview" 
                      style={{ maxWidth: '100%', maxHeight: '200px', border: '1px solid #ddd', borderRadius: '4px' }}
                    />
                  </div>
                )}
                <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px' }}>
                  Comment for this failure:
                </label>
                <textarea
                  value={itemImages[`${sectionId}_${item.id}`]?.comment || ''}
                  onChange={(e) => {
                    setItemImages(prev => ({
                      ...prev,
                      [`${sectionId}_${item.id}`]: {
                        ...prev[`${sectionId}_${item.id}`],
                        comment: e.target.value
                      }
                    }));
                  }}
                  placeholder="Describe the issue or failure..."
                  style={{ width: '100%', minHeight: '60px', padding: '6px', border: '1px solid #ddd', borderRadius: '4px' }}
                />
              </div>
            )}

            {error && <div className="error">{error}</div>}
          </div>
        );

      case 'text':
        return (
          <div className="form-group" key={item.id}>
            <label className={item.required ? 'item-label required' : 'item-label'}>
              {item.label}
            </label>
            <input
              type="text"
              value={value || ''}
              onChange={(e) => handleInputChange(sectionId, item.id, e.target.value)}
            />
            {error && <div className="error">{error}</div>}
          </div>
        );

      case 'textarea':
        return (
          <div className="form-group" key={item.id}>
            <label className={item.required ? 'item-label required' : 'item-label'}>
              {item.label}
            </label>
            <textarea
              value={value || ''}
              onChange={(e) => handleInputChange(sectionId, item.id, e.target.value)}
              placeholder={item.placeholder || ''}
            />
            {error && <div className="error">{error}</div>}
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div>
      <ErrorAlert
        error={alertError}
        onClose={() => setAlertError(null)}
        title="Checklist Error"
      />
      <SuccessAlert
        message={alertSuccess?.message}
        onClose={() => {
          if (alertSuccess?.onClose) alertSuccess.onClose();
          setAlertSuccess(null);
        }}
        title="Success"
      />
      <div style={{ marginBottom: '20px' }}>
        <button className="btn btn-secondary" onClick={() => navigate(`/tasks/${id}`)}>
            Back
        </button>
      </div>

      <div className="card">
        <h2>{task.template_name || 'Checklist'}</h2>
        
        {/* Auto-save status indicator */}
        {autoSaveStatus && (
          <div style={{ 
            marginBottom: '15px', 
            padding: '8px 15px', 
            borderRadius: '4px',
            fontSize: '14px',
            background: autoSaveStatus === 'saving' ? '#fff3cd' : 
                        autoSaveStatus === 'saved' ? '#d4edda' : '#f8d7da',
            color: autoSaveStatus === 'saving' ? '#856404' : 
                   autoSaveStatus === 'saved' ? '#155724' : '#721c24',
            border: `1px solid ${autoSaveStatus === 'saving' ? '#ffc107' : 
                                autoSaveStatus === 'saved' ? '#28a745' : '#dc3545'}`
          }}>
            {autoSaveStatus === 'saving' && 'Saving draft...'}
            {autoSaveStatus === 'saved' && 'Draft saved'}
            {autoSaveStatus === 'error' && 'Error saving draft'}
          </div>
        )}

        <div style={{ marginBottom: '15px', padding: '15px', background: '#e7f3ff', borderRadius: '4px', border: '2px solid #007bff' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '15px', marginBottom: '10px' }}>
            <div style={{ flex: '1', minWidth: '200px' }}>
              <p style={{ marginBottom: '5px', fontSize: '12px', color: '#666' }}>TASK CODE</p>
              <p style={{ margin: 0, fontSize: '16px', fontWeight: 'bold' }}>{task.task_code}</p>
            </div>
            <div style={{ flex: '1', minWidth: '200px' }}>
              <p style={{ marginBottom: '5px', fontSize: '12px', color: '#666' }}>ASSET</p>
              <p style={{ margin: 0, fontSize: '18px', fontWeight: 'bold', color: '#007bff' }}>
                {task.asset_name}
                {task.asset_code && <span style={{ fontSize: '14px', color: '#666' }}> ({task.asset_code})</span>}
              </p>
            </div>
            {task.location && (
              <div style={{ flex: '1', minWidth: '200px' }}>
                <p style={{ marginBottom: '5px', fontSize: '12px', color: '#666' }}>LOCATION</p>
                <p style={{ margin: 0, fontSize: '16px', fontWeight: 'bold' }}>{task.location}</p>
              </div>
            )}
          </div>
          
          {/* Inspector and metadata at the top */}
          <div style={{ 
            marginTop: '15px', 
            padding: '12px', 
            background: '#ffffff', 
            borderRadius: '4px',
            border: '1px solid #dee2e6'
          }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '20px', alignItems: 'center' }}>
              {metadata.inspected_by && (
                <div>
                  <span style={{ fontSize: '12px', color: '#666', marginRight: '5px' }}>Inspected By:</span>
                  <span style={{ fontSize: '16px', fontWeight: 'bold', color: '#28a745' }}>{metadata.inspected_by}</span>
                </div>
              )}
              {metadata.approved_by && (
                <div>
                  <span style={{ fontSize: '12px', color: '#666', marginRight: '5px' }}>Approved By:</span>
                  <span style={{ fontSize: '16px', fontWeight: 'bold', color: '#007bff' }}>{metadata.approved_by}</span>
                </div>
              )}
              {metadata.maintenance_team && (
                <div>
                  <span style={{ fontSize: '12px', color: '#666', marginRight: '5px' }}>Team:</span>
                  <span style={{ fontSize: '14px' }}>{metadata.maintenance_team}</span>
                </div>
              )}
            </div>
          </div>

          <p style={{ marginTop: '10px', fontSize: '14px', color: '#666' }}>
            <strong>Task Type:</strong> {task.task_type} | <strong>Asset Type:</strong> {task.asset_type || 'asset'}
          </p>
        </div>

        {/* UCM Time Fields */}
        {task.task_type === 'UCM' && (
          <div className="section" style={{ marginTop: '20px', marginBottom: '20px', background: '#fff3cd', borderLeft: '4px solid #ffc107' }}>
            <div className="section-title" style={{ color: '#856404' }}>UCM Time Information</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '15px', marginTop: '15px' }}>
              <div className="form-group">
                <label>CM Issue Occurred At *</label>
                <input
                  type="datetime-local"
                  value={cmOccurredAt}
                  onChange={(e) => setCmOccurredAt(e.target.value)}
                  required
                  style={{ width: '100%', padding: '12px 16px', fontSize: '16px', border: '2px solid #ddd', borderRadius: '6px' }}
                />
              </div>
              <div className="form-group">
                <label>Task Started At *</label>
                <input
                  type="datetime-local"
                  value={cmStartedAt}
                  onChange={(e) => setCmStartedAt(e.target.value)}
                  required
                  style={{ width: '100%', padding: '12px 16px', fontSize: '16px', border: '2px solid #ddd', borderRadius: '6px' }}
                />
              </div>
              <div className="form-group">
                <label>Task Completed At *</label>
                <input
                  type="datetime-local"
                  value={cmCompletedAt}
                  onChange={(e) => setCmCompletedAt(e.target.value)}
                  required
                  style={{ width: '100%', padding: '12px 16px', fontSize: '16px', border: '2px solid #ddd', borderRadius: '6px' }}
                />
              </div>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ marginTop: '30px' }}>
          {checklistStructure.sections.map((section) => (
            <div className="section" key={section.id}>
              <div className="section-title">{section.title}</div>
              {section.items.map((item) => renderItem(section.id, item))}
            </div>
          ))}

          {/* Spares Selection */}
          <div className="section" style={{ marginTop: '30px', background: '#f9f9f9', borderLeft: '4px solid #6c757d' }}>
            <div className="section-title">Spares Used (Inventory)</div>
            <p style={{ fontSize: '14px', color: '#666', marginBottom: '15px' }}>
              Search and select spares used during this task. Selected spares will be automatically deducted from inventory when you submit the checklist.
            </p>

            {inventoryOptions.length === 0 ? (
              <p style={{ color: '#666' }}>Loading inventory list...</p>
            ) : (
              <>
                {/* Search Bar */}
                <div style={{ marginBottom: '20px' }}>
                  <input
                    type="text"
                    placeholder="Search spares by item code or description..."
                    value={sparesSearchQuery}
                    onChange={(e) => {
                      setSparesSearchQuery(e.target.value);
                      const query = e.target.value.toLowerCase().trim();
                      if (!query) {
                        setFilteredInventoryOptions(inventoryOptions);
                      } else {
                        const filtered = inventoryOptions.filter(item => 
                          (item.item_code && item.item_code.toLowerCase().includes(query)) ||
                          (item.item_description && item.item_description.toLowerCase().includes(query)) ||
                          (item.section && item.section.toLowerCase().includes(query))
                        );
                        setFilteredInventoryOptions(filtered);
                      }
                    }}
                    style={{
                      width: '100%',
                      padding: '12px 16px',
                      fontSize: '16px',
                      border: '2px solid #ddd',
                      borderRadius: '6px'
                    }}
                  />
                </div>

                {/* Spare Selection List */}
                <div style={{ maxHeight: '400px', overflowY: 'auto', border: '1px solid #ddd', borderRadius: '8px', background: '#fff' }}>
                  {(sparesSearchQuery ? filteredInventoryOptions : inventoryOptions).map((item) => {
                    const isSelected = sparesUsed.some(used => used.item_code === item.item_code);
                    const usedItem = sparesUsed.find(used => used.item_code === item.item_code);
                    const availableQty = item.actual_qty || 0;
                    
                    return (
                      <div
                        key={item.id}
                        style={{
                          padding: '15px',
                          borderBottom: '1px solid #eee',
                          background: isSelected ? '#e8f5e9' : '#fff',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '15px',
                          flexWrap: 'wrap'
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSparesUsed([...sparesUsed, {
                                item_code: item.item_code,
                                qty_used: 1
                              }]);
                            } else {
                              setSparesUsed(sparesUsed.filter(used => used.item_code !== item.item_code));
                            }
                          }}
                          style={{ width: '20px', height: '20px', cursor: 'pointer' }}
                        />
                        <div style={{ flex: 1, minWidth: '200px' }}>
                          <div style={{ fontWeight: 'bold', fontSize: '15px' }}>
                            {item.item_description || item.item_code}
                          </div>
                          <div style={{ fontSize: '13px', color: '#666', marginTop: '4px' }}>
                            Code: {item.item_code} | Available: {availableQty}
                          </div>
                        </div>
                        {isSelected && (
                          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                            <label style={{ fontSize: '14px', fontWeight: 'bold' }}>Qty:</label>
                            <input
                              type="number"
                              min="1"
                              max={availableQty}
                              value={usedItem?.qty_used || 1}
                              onChange={(e) => {
                                const qty = parseInt(e.target.value) || 1;
                                const finalQty = Math.min(Math.max(1, qty), availableQty);
                                const updated = sparesUsed.map(used => 
                                  used.item_code === item.item_code 
                                    ? { ...used, qty_used: finalQty }
                                    : used
                                );
                                setSparesUsed(updated);
                              }}
                              style={{
                                width: '80px',
                                padding: '8px 10px',
                                fontSize: '14px',
                                border: '2px solid #4caf50',
                                borderRadius: '6px',
                                outline: 'none'
                              }}
                            />
                            <span style={{ fontSize: '13px', color: '#666' }}>
                              (max: {availableQty})
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Selected Spares Summary */}
                {sparesUsed.length > 0 && (
                  <div style={{ marginTop: '20px', padding: '15px', background: '#e8f5e9', borderRadius: '8px', border: '2px solid #4caf50' }}>
                    <h4 style={{ marginTop: 0, marginBottom: '15px', fontSize: '16px', fontWeight: 'bold' }}>
                      Selected Spares ({sparesUsed.length}):
                    </h4>
                    {sparesUsed.map((used, idx) => {
                      const item = inventoryOptions.find(i => i.item_code === used.item_code);
                      return (
                        <div key={idx} style={{ marginBottom: '8px', fontSize: '14px' }}>
                          • {item?.item_description || used.item_code}: {used.qty_used} unit(s)
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Hours Worked Section */}
          <div className="section" style={{ marginTop: '30px', background: '#f9f9f9', borderLeft: '4px solid #6c757d' }}>
            <div className="section-title">Hours Worked</div>
            <div className="form-group">
              <label>
                Number of Hours Worked <span style={{ fontSize: '12px', color: '#666' }}>(Optional)</span>
              </label>
              <input
                type="number"
                step="0.1"
                min="0"
                value={hoursWorked}
                onChange={(e) => setHoursWorked(e.target.value)}
                placeholder="0.0"
                style={{ width: '100%', padding: '12px 16px', fontSize: '16px', border: '2px solid #ddd', borderRadius: '6px' }}
              />
              {task.budgeted_hours && (
                <div style={{ marginTop: '8px', padding: '8px', background: '#e3f2fd', borderRadius: '4px', fontSize: '13px' }}>
                  <strong>Budgeted Hours:</strong> {parseFloat(task.budgeted_hours).toFixed(1)}h
                  {hoursWorked && parseFloat(hoursWorked) > parseFloat(task.budgeted_hours) && (
                    <span style={{ color: '#dc3545', marginLeft: '10px', fontWeight: 'bold' }}>
                      WARNING: Budget exceeded!
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Metadata Section */}
          <div className="section" style={{ marginTop: '30px', background: '#f0f8ff', borderLeft: '4px solid #007bff' }}>
            <div className="section-title">Inspection Information</div>
            
            <div className="form-group">
              <label>
                Maintenance Team <span style={{ fontSize: '12px', color: '#666' }}>(Optional)</span>
              </label>
              <input
                type="text"
                value={metadata.maintenance_team}
                onChange={(e) => setMetadata({ ...metadata, maintenance_team: e.target.value })}
                placeholder="Enter maintenance team name(s)"
              />
            </div>

            <div className="form-group">
              <label>
                Inspected By (Technician) <span style={{ color: 'red' }}>*</span>
              </label>
              <input
                type="text"
                value={metadata.inspected_by}
                onChange={(e) => setMetadata({ ...metadata, inspected_by: e.target.value })}
                placeholder="Enter technician name"
                required
              />
            </div>

            <div className="form-group">
              <label>
                Approved By (Supervisor/Manager) <span style={{ fontSize: '12px', color: '#666' }}>(Optional)</span>
              </label>
              <input
                type="text"
                value={metadata.approved_by}
                onChange={(e) => setMetadata({ ...metadata, approved_by: e.target.value })}
                placeholder="Enter supervisor/manager name"
              />
            </div>
          </div>

          <div style={{ marginTop: '30px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Submitting...' : 'Submit Checklist'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => navigate(`/tasks/${id}`)}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default ChecklistForm;

