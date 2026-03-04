import React, { useState, useEffect } from 'react';
import { 
  getChecklistTemplates, 
  getChecklistTemplate, 
  updateChecklistTemplateMetadata,
  uploadTemplateFile,
  createChecklistTemplate,
  updateChecklistTemplate,
  deleteChecklistTemplate
} from '../api/api';
import { useAuth } from '../context/AuthContext';
import { usePermissions } from '../hooks/usePermissions';
import { getErrorMessage } from '../utils/errorHandler';
import { hasOrganizationContext } from '../utils/organizationContext';
import './ChecklistTemplates.css';

function ChecklistTemplates() {
  const { isAdmin, user, loading: authLoading } = useAuth();
  const { hasPermission } = usePermissions();
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [showDetails, setShowDetails] = useState(false);
  const [lastRevisionDate, setLastRevisionDate] = useState('');
  const [checklistMadeBy, setChecklistMadeBy] = useState('');
  const [lastRevisionApprovedBy, setLastRevisionApprovedBy] = useState('');
  const [savingRevision, setSavingRevision] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 5;
  
  // Upload/Create/Edit states
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [templateToDelete, setTemplateToDelete] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadForm, setUploadForm] = useState({
    file: null,
    asset_type: '',
    asset_prefix: '',
    template_code: '',
    template_name: '',
    frequency: 'monthly',
    task_type: 'PM',
    update_existing: false
  });
  const [createForm, setCreateForm] = useState({
    template_code: '',
    template_name: '',
    description: '',
    asset_type: '',
    task_type: 'PM',
    frequency: 'monthly'
  });
  
  // Checklist structure editor state
  const [checklistStructure, setChecklistStructure] = useState({
    metadata: {},
    sections: []
  });
  const [expandedSections, setExpandedSections] = useState(new Set());
  const [editingSection, setEditingSection] = useState(null);
  const [editingItem, setEditingItem] = useState(null);
  const [savingStructure, setSavingStructure] = useState(false);
  
  const canCreate = hasPermission('templates:create');
  const canUpdate = hasPermission('templates:update');
  const canDelete = hasPermission('templates:delete');

  useEffect(() => {
    // Wait for AuthContext to finish loading before checking organization context
    if (authLoading) {
      return; // Don't check until auth is loaded
    }
    
    // Only load templates if user has organization context
    if (hasOrganizationContext(user)) {
      loadTemplates();
    } else {
      // System owner without company: show empty templates
      setTemplates([]);
      setLoading(false);
    }
  }, [user, authLoading]);

  const loadTemplates = async () => {
    try {
      console.log('Loading checklist templates...');
      const response = await getChecklistTemplates();
      console.log('Templates response:', response.data);
      setTemplates(response.data);
      setLoading(false);
    } catch (error) {
      console.error('Error loading checklist templates:', error);
      setLoading(false);
      setError(getErrorMessage(error, 'Templates unavailable'));
    }
  };

  const handleViewDetails = async (templateId) => {
    try {
      const response = await getChecklistTemplate(templateId);
      const template = response.data;
      setSelectedTemplate(template);
      const metadata = template?.checklist_structure?.metadata || {};
      setLastRevisionDate(metadata.last_revision_date || '');
      setChecklistMadeBy(metadata.checklist_made_by || 'and');
      setLastRevisionApprovedBy(metadata.last_revision_approved_by || 'Floridas Moloto');
      
      // Load checklist structure for editing
      const structure = template.checklist_structure || { metadata: {}, sections: [] };
      setChecklistStructure(JSON.parse(JSON.stringify(structure))); // Deep copy
      setExpandedSections(new Set());
      setEditingSection(null);
      setEditingItem(null);
      
      setShowDetails(true);
    } catch (error) {
      console.error('Error loading template details:', error);
      setError(getErrorMessage(error, 'Template not found'));
    }
  };

  const handleSaveLastRevisionDate = async () => {
    if (!selectedTemplate?.id) return;
    try {
      setSavingRevision(true);
      const response = await updateChecklistTemplateMetadata(selectedTemplate.id, {
        last_revision_date: lastRevisionDate,
        checklist_made_by: checklistMadeBy,
        last_revision_approved_by: lastRevisionApprovedBy
      });
      setSelectedTemplate(response.data);
      setError('');
    } catch (error) {
      console.error('Error saving template metadata:', error);
      setError(getErrorMessage(error, 'Save failed'));
    } finally {
      setSavingRevision(false);
    }
  };

  const renderChecklistStructure = (structure) => {
    if (!structure || !structure.sections) {
      return <p>No structure defined</p>;
    }

    return (
      <div>
        {structure.sections.map((section, sectionIndex) => (
          <div key={section.id || sectionIndex} className="section" style={{ marginBottom: '20px' }}>
            <div className="section-title">
              {sectionIndex + 1}. {section.title}
            </div>
            {section.items && section.items.map((item, itemIndex) => (
              <div key={item.id || itemIndex} style={{ marginLeft: '20px', marginTop: '10px', padding: '10px', background: 'white', borderRadius: '4px' }}>
                <div style={{ fontWeight: '500', marginBottom: '5px' }}>
                  {sectionIndex + 1}.{itemIndex + 1} {item.label}
                  {item.required && <span style={{ color: 'red' }}> *</span>}
                </div>
                <div style={{ fontSize: '12px', color: '#666', marginLeft: '10px' }}>
                  Type: <strong>{item.type}</strong>
                  {item.has_observations && ' | Has Observations'}
                  {item.measurement_fields && ` | ${item.measurement_fields.length} measurement field(s)`}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  };

  // Checklist structure editor functions
  const generateId = (prefix) => `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  const addSection = () => {
    const newSection = {
      id: generateId('section'),
      title: 'New Section',
      items: []
    };
    setChecklistStructure({
      ...checklistStructure,
      sections: [...checklistStructure.sections, newSection]
    });
    setExpandedSections(new Set([...expandedSections, newSection.id]));
    setEditingSection(newSection.id);
  };

  const removeSection = (sectionIndex) => {
    const newSections = checklistStructure.sections.filter((_, idx) => idx !== sectionIndex);
    setChecklistStructure({
      ...checklistStructure,
      sections: newSections
    });
    const sectionId = checklistStructure.sections[sectionIndex]?.id;
    if (sectionId) {
      const newExpanded = new Set(expandedSections);
      newExpanded.delete(sectionId);
      setExpandedSections(newExpanded);
    }
  };

  const updateSectionTitle = (sectionIndex, newTitle) => {
    const newSections = [...checklistStructure.sections];
    newSections[sectionIndex] = {
      ...newSections[sectionIndex],
      title: newTitle
    };
    setChecklistStructure({
      ...checklistStructure,
      sections: newSections
    });
  };

  const toggleSection = (sectionId) => {
    const newExpanded = new Set(expandedSections);
    if (newExpanded.has(sectionId)) {
      newExpanded.delete(sectionId);
    } else {
      newExpanded.add(sectionId);
    }
    setExpandedSections(newExpanded);
  };

  const addItem = (sectionIndex) => {
    const newItem = {
      id: generateId('item'),
      label: 'New Item',
      type: 'pass_fail',
      required: false
    };
    const newSections = [...checklistStructure.sections];
    newSections[sectionIndex] = {
      ...newSections[sectionIndex],
      items: [...(newSections[sectionIndex].items || []), newItem]
    };
    setChecklistStructure({
      ...checklistStructure,
      sections: newSections
    });
    setEditingItem({ sectionIndex, itemIndex: newSections[sectionIndex].items.length - 1 });
  };

  const removeItem = (sectionIndex, itemIndex) => {
    const newSections = [...checklistStructure.sections];
    newSections[sectionIndex] = {
      ...newSections[sectionIndex],
      items: newSections[sectionIndex].items.filter((_, idx) => idx !== itemIndex)
    };
    setChecklistStructure({
      ...checklistStructure,
      sections: newSections
    });
  };

  const updateItem = (sectionIndex, itemIndex, updates) => {
    const newSections = [...checklistStructure.sections];
    newSections[sectionIndex] = {
      ...newSections[sectionIndex],
      items: newSections[sectionIndex].items.map((item, idx) => 
        idx === itemIndex ? { ...item, ...updates } : item
      )
    };
    setChecklistStructure({
      ...checklistStructure,
      sections: newSections
    });
  };

  const moveSection = (fromIndex, toIndex) => {
    const newSections = [...checklistStructure.sections];
    const [moved] = newSections.splice(fromIndex, 1);
    newSections.splice(toIndex, 0, moved);
    setChecklistStructure({
      ...checklistStructure,
      sections: newSections
    });
  };

  const moveItem = (sectionIndex, fromIndex, toIndex) => {
    const newSections = [...checklistStructure.sections];
    const items = [...newSections[sectionIndex].items];
    const [moved] = items.splice(fromIndex, 1);
    items.splice(toIndex, 0, moved);
    newSections[sectionIndex] = {
      ...newSections[sectionIndex],
      items
    };
    setChecklistStructure({
      ...checklistStructure,
      sections: newSections
    });
  };

  const handleSaveStructure = async () => {
    if (!selectedTemplate?.id) return;

    try {
      setSavingStructure(true);
      await updateChecklistTemplate(selectedTemplate.id, {
        checklist_structure: checklistStructure
      });
      
      // Reload template to get updated data
      const response = await getChecklistTemplate(selectedTemplate.id);
      setSelectedTemplate(response.data);
      setError('');
    } catch (error) {
      console.error('Error saving checklist structure:', error);
      setError(getErrorMessage(error, 'Save failed'));
    } finally {
      setSavingStructure(false);
    }
  };

  if (loading) {
    return <div className="loading">Loading checklist templates...</div>;
  }

  if (showDetails && selectedTemplate) {
    return (
      <div>
        <div style={{ marginBottom: '20px' }}>
          <button className="btn btn-secondary" onClick={() => {
            setShowDetails(false);
            setCurrentPage(1); // Reset to first page when returning
          }}>
            Back
          </button>
        </div>

        <div className="card">
          <h2>{selectedTemplate.template_name}</h2>
          <div style={{ marginTop: '20px', marginBottom: '20px' }}>
            <p><strong>Template Code:</strong> {selectedTemplate.template_code}</p>
            <p><strong>Description:</strong> {selectedTemplate.description || 'N/A'}</p>
            <p><strong>Asset Type:</strong> {selectedTemplate.asset_type}</p>
            <p><strong>Task Type:</strong> {selectedTemplate.task_type}</p>
            <p><strong>Frequency:</strong> {selectedTemplate.frequency || 'N/A'}</p>
          </div>

          {/* Admin-only: manual template metadata */}
          {isAdmin() && (
            <div style={{ marginTop: '20px', padding: '15px', background: '#f9f9f9', borderRadius: '4px' }}>
              <h4 style={{ marginTop: 0 }}>Template Metadata</h4>
              <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div className="form-group" style={{ flex: '1', minWidth: '200px' }}>
                  <label>Last Revision Date</label>
                  <input
                    type="date"
                    value={lastRevisionDate}
                    onChange={(e) => setLastRevisionDate(e.target.value)}
                    disabled={savingRevision}
                    style={{ width: '100%' }}
                  />
                  <small style={{ display: 'block', marginTop: '6px', color: '#666' }}>
                    Fills <code>{'{last_revision_date}'}</code>
                  </small>
                </div>
                <div className="form-group" style={{ flex: '1', minWidth: '200px' }}>
                  <label>Checklist Made By</label>
                  <input
                    type="text"
                    value={checklistMadeBy}
                    onChange={(e) => setChecklistMadeBy(e.target.value)}
                    disabled={savingRevision}
                    placeholder="and"
                    style={{ width: '100%' }}
                  />
                  <small style={{ display: 'block', marginTop: '6px', color: '#666' }}>
                    Fills <code>{'{checklist_made_by}'}</code>
                  </small>
                </div>
                <div className="form-group" style={{ flex: '1', minWidth: '200px' }}>
                  <label>Last Revision Approved By</label>
                  <input
                    type="text"
                    value={lastRevisionApprovedBy}
                    onChange={(e) => setLastRevisionApprovedBy(e.target.value)}
                    disabled={savingRevision}
                    placeholder="Floridas Moloto"
                    style={{ width: '100%' }}
                  />
                  <small style={{ display: 'block', marginTop: '6px', color: '#666' }}>
                    Fills <code>{'{last_revision_approved_by}'}</code>
                  </small>
                </div>
                <div style={{ flex: '0 0 auto' }}>
                  <button className="btn btn-primary" onClick={handleSaveLastRevisionDate} disabled={savingRevision}>
                    {savingRevision ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Checklist Structure Editor */}
          <div style={{ marginTop: '30px', borderTop: '2px solid #eee', paddingTop: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
              <h3 style={{ margin: 0 }}>Checklist Structure</h3>
              {canUpdate && (
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <button 
                    type="button"
                    className="btn btn-secondary" 
                    onClick={addSection}
                    disabled={savingStructure}
                    title="Add new section"
                  >
                    Add
                  </button>
                  <button
                    className="btn btn-primary"
                    onClick={handleSaveStructure}
                    disabled={savingStructure}
                  >
                    {savingStructure ? 'Saving...' : 'Save'}
                  </button>
                </div>
              )}
            </div>

            {canUpdate ? (
              <>

                {checklistStructure.sections.length === 0 ? (
                  <p style={{ color: '#666', fontStyle: 'italic', padding: '20px', textAlign: 'center', background: '#f9f9f9', borderRadius: '4px' }}>
                    No sections yet. Click "Add" to start building your checklist.
                  </p>
                ) : (
                  <div className="checklist-structure-editor">
                    {checklistStructure.sections.map((section, sectionIndex) => (
                      <div key={section.id || sectionIndex} className="checklist-section" style={{ 
                        marginBottom: '15px', 
                        border: '1px solid #ddd', 
                        borderRadius: '6px',
                        background: '#fff'
                      }}>
                        {/* Section Header */}
                        <div style={{ 
                          display: 'flex', 
                          alignItems: 'center', 
                          padding: '12px 15px',
                          background: '#f5f5f5',
                          borderBottom: '1px solid #ddd',
                          borderRadius: '6px 6px 0 0'
                        }}>
                          <button
                            type="button"
                            onClick={() => toggleSection(section.id || sectionIndex)}
                            style={{
                              background: 'none',
                              border: 'none',
                              cursor: 'pointer',
                              fontSize: '14px',
                              marginRight: '10px',
                              padding: '4px 8px',
                              color: '#007bff'
                            }}
                          >
                            {expandedSections.has(section.id || sectionIndex) ? '▼' : '▶'}
                          </button>
                          <span style={{ fontWeight: '600', marginRight: '10px' }}>
                            Section {sectionIndex + 1}:
                          </span>
                          {editingSection === (section.id || sectionIndex) ? (
                            <input
                              type="text"
                              value={section.title}
                              onChange={(e) => updateSectionTitle(sectionIndex, e.target.value)}
                              onBlur={() => setEditingSection(null)}
                              onKeyPress={(e) => e.key === 'Enter' && setEditingSection(null)}
                              autoFocus
                              style={{
                                flex: 1,
                                padding: '4px 8px',
                                border: '1px solid #007bff',
                                borderRadius: '4px',
                                fontSize: '14px'
                              }}
                            />
                          ) : (
                            <span 
                              onClick={() => setEditingSection(section.id || sectionIndex)}
                              style={{ flex: 1, cursor: 'pointer', padding: '4px 8px' }}
                              title="Click to edit"
                            >
                              {section.title || 'Untitled Section'}
                            </span>
                          )}
                          <div style={{ display: 'flex', gap: '5px', marginLeft: '10px' }}>
                            {sectionIndex > 0 && (
                              <button
                                type="button"
                                onClick={() => moveSection(sectionIndex, sectionIndex - 1)}
                                title="Move up"
                                style={{ padding: '4px 8px', fontSize: '12px', background: '#6c757d', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                              >
                                ↑
                              </button>
                            )}
                            {sectionIndex < checklistStructure.sections.length - 1 && (
                              <button
                                type="button"
                                onClick={() => moveSection(sectionIndex, sectionIndex + 1)}
                                title="Move down"
                                style={{ padding: '4px 8px', fontSize: '12px', background: '#6c757d', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                              >
                                ↓
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => removeSection(sectionIndex)}
                              title="Delete section"
                              style={{ padding: '4px 8px', fontSize: '12px', background: '#dc3545', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                            >
                              ×
                            </button>
                          </div>
                        </div>

                        {/* Section Items */}
                        {expandedSections.has(section.id || sectionIndex) && (
                          <div style={{ padding: '15px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                              <span style={{ fontSize: '13px', color: '#666' }}>
                                {section.items?.length || 0} item(s)
                              </span>
                              <button
                                type="button"
                                onClick={() => addItem(sectionIndex)}
                                style={{ padding: '6px 12px', fontSize: '12px', background: '#28a745', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                                title="Add new item"
                              >
                                Add
                              </button>
                            </div>

                            {(!section.items || section.items.length === 0) ? (
                              <p style={{ color: '#999', fontStyle: 'italic', fontSize: '13px', padding: '10px', textAlign: 'center' }}>
                                No items in this section. Click "Add" to add one.
                              </p>
                            ) : (
                              <div className="checklist-items">
                                {section.items.map((item, itemIndex) => (
                                  <div key={item.id || itemIndex} style={{
                                    marginBottom: '10px',
                                    padding: '12px',
                                    background: '#f9f9f9',
                                    borderRadius: '4px',
                                    border: editingItem?.sectionIndex === sectionIndex && editingItem?.itemIndex === itemIndex ? '2px solid #007bff' : '1px solid #e0e0e0'
                                  }}>
                                    {editingItem?.sectionIndex === sectionIndex && editingItem?.itemIndex === itemIndex ? (
                                      <div>
                                        <div style={{ marginBottom: '10px' }}>
                                          <label style={{ display: 'block', fontSize: '12px', fontWeight: '500', marginBottom: '4px' }}>Item Label *</label>
                                          <input
                                            type="text"
                                            value={item.label || ''}
                                            onChange={(e) => updateItem(sectionIndex, itemIndex, { label: e.target.value })}
                                            style={{ width: '100%', padding: '6px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '13px' }}
                                            placeholder="Enter item label"
                                          />
                                        </div>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
                                          <div>
                                            <label style={{ display: 'block', fontSize: '12px', fontWeight: '500', marginBottom: '4px' }}>Type</label>
                                            <select
                                              value={item.type || 'pass_fail'}
                                              onChange={(e) => updateItem(sectionIndex, itemIndex, { type: e.target.value })}
                                              style={{ width: '100%', padding: '6px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '13px' }}
                                            >
                                              <option value="pass_fail">Pass/Fail</option>
                                              <option value="text">Text</option>
                                              <option value="number">Number</option>
                                              <option value="date">Date</option>
                                              <option value="time">Time</option>
                                              <option value="pass_fail_with_measurement">Pass/Fail with Measurement</option>
                                            </select>
                                          </div>
                                          <div>
                                            <label style={{ display: 'flex', alignItems: 'center', fontSize: '12px', fontWeight: '500', marginTop: '20px' }}>
                                              <input
                                                type="checkbox"
                                                checked={item.required || false}
                                                onChange={(e) => updateItem(sectionIndex, itemIndex, { required: e.target.checked })}
                                                style={{ marginRight: '6px' }}
                                              />
                                              Required
                                            </label>
                                          </div>
                                        </div>
                                        <div style={{ display: 'flex', gap: '5px', justifyContent: 'flex-end' }}>
                                          <button
                                            type="button"
                                            onClick={() => setEditingItem(null)}
                                            style={{ padding: '6px 12px', fontSize: '12px', background: '#6c757d', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                                          >
                                            Done
                                          </button>
                                        </div>
                                      </div>
                                    ) : (
                                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                        <div style={{ flex: 1 }}>
                                          <div style={{ fontWeight: '500', marginBottom: '4px' }}>
                                            {itemIndex + 1}. {item.label || 'Untitled Item'}
                                            {item.required && <span style={{ color: '#dc3545', marginLeft: '5px' }}>*</span>}
                                          </div>
                                          <div style={{ fontSize: '12px', color: '#666' }}>
                                            Type: <strong>{item.type || 'pass_fail'}</strong>
                                            {item.has_observations && ' | Has Observations'}
                                            {item.measurement_fields && ` | ${item.measurement_fields.length} measurement field(s)`}
                                          </div>
                                        </div>
                                        <div style={{ display: 'flex', gap: '5px' }}>
                                          {itemIndex > 0 && (
                                            <button
                                              type="button"
                                              onClick={() => moveItem(sectionIndex, itemIndex, itemIndex - 1)}
                                              title="Move up"
                                              style={{ padding: '4px 8px', fontSize: '12px', background: '#6c757d', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                                            >
                                              ↑
                                            </button>
                                          )}
                                          {itemIndex < section.items.length - 1 && (
                                            <button
                                              type="button"
                                              onClick={() => moveItem(sectionIndex, itemIndex, itemIndex + 1)}
                                              title="Move down"
                                              style={{ padding: '4px 8px', fontSize: '12px', background: '#6c757d', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                                            >
                                              ↓
                                            </button>
                                          )}
                                          <button
                                            type="button"
                                            onClick={() => setEditingItem({ sectionIndex, itemIndex })}
                                            title="Edit item"
                                            style={{ padding: '4px 8px', fontSize: '12px', background: '#007bff', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                                          >
                                            Edit
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => removeItem(sectionIndex, itemIndex)}
                                            title="Delete item"
                                            style={{ padding: '4px 8px', fontSize: '12px', background: '#dc3545', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                                          >
                                            ×
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              // Read-only view for users without update permission
              <div>
                {renderChecklistStructure(checklistStructure)}
              </div>
            )}
          </div>

          {selectedTemplate.metadata && (
            <div style={{ marginTop: '30px', padding: '15px', background: '#f9f9f9', borderRadius: '4px' }}>
              <h4>Metadata</h4>
              <p><strong>Procedure:</strong> {selectedTemplate.metadata.procedure || 'N/A'}</p>
              <p><strong>Plant:</strong> {selectedTemplate.metadata.plant || 'N/A'}</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setUploadForm({ ...uploadForm, file });
      // Auto-detect asset type and prefix from filename
      const fileName = file.name.toLowerCase();
      if (fileName.includes('energy') || fileName.includes('meter')) {
        setUploadForm(prev => ({ ...prev, asset_type: 'energy_meter', asset_prefix: 'EM' }));
      } else if (fileName.includes('inverter')) {
        setUploadForm(prev => ({ ...prev, asset_type: 'inverter', asset_prefix: 'INV' }));
      } else if (fileName.includes('cctv')) {
        setUploadForm(prev => ({ ...prev, asset_type: 'cctv', asset_prefix: 'CCTV' }));
      } else if (fileName.includes('ventilation') || fileName.includes('vent')) {
        setUploadForm(prev => ({ ...prev, asset_type: 'ventilation', asset_prefix: 'VENT' }));
      } else if (fileName.includes('tracker')) {
        setUploadForm(prev => ({ ...prev, asset_type: 'tracker', asset_prefix: 'TRACKER' }));
      } else if (fileName.includes('substation') || fileName.includes('sub')) {
        setUploadForm(prev => ({ ...prev, asset_type: 'substation', asset_prefix: 'SUB' }));
      } else if (fileName.includes('scada')) {
        setUploadForm(prev => ({ ...prev, asset_type: 'scada', asset_prefix: 'SCADA' }));
      } else if (fileName.includes('combiner') || fileName.includes('string')) {
        setUploadForm(prev => ({ ...prev, asset_type: 'string_combiner_box', asset_prefix: 'SCB' }));
      } else if (fileName.includes('concentrated') || fileName.includes('cabinet')) {
        setUploadForm(prev => ({ ...prev, asset_type: 'concentrated_cabinet', asset_prefix: 'CC' }));
      } else if (fileName.includes('ct-mv') || fileName.includes('ct_mv')) {
        setUploadForm(prev => ({ ...prev, asset_type: 'ct_mv', asset_prefix: 'CT-MV' }));
      }
    }
  };

  const handleUpload = async () => {
    if (!uploadForm.file || !uploadForm.asset_type || !uploadForm.asset_prefix) {
      setError('File, asset type, and prefix required');
      return;
    }
    setError('');

    try {
      setUploading(true);
      const formData = new FormData();
      formData.append('file', uploadForm.file);
      formData.append('asset_type', uploadForm.asset_type);
      formData.append('asset_prefix', uploadForm.asset_prefix);
      if (uploadForm.template_code) formData.append('template_code', uploadForm.template_code);
      if (uploadForm.template_name) formData.append('template_name', uploadForm.template_name);
      if (uploadForm.frequency) formData.append('frequency', uploadForm.frequency);
      if (uploadForm.task_type) formData.append('task_type', uploadForm.task_type);
      if (uploadForm.update_existing) formData.append('update_existing', 'true');

      const response = await uploadTemplateFile(formData);
      setShowUploadModal(false);
      setUploadForm({
        file: null,
        asset_type: '',
        asset_prefix: '',
        template_code: '',
        template_name: '',
        frequency: 'monthly',
        task_type: 'PM',
        update_existing: false
      });
      setError('');
      loadTemplates();
    } catch (error) {
      console.error('Error uploading template:', error);
      setError(getErrorMessage(error, 'Upload failed'));
    } finally {
      setUploading(false);
    }
  };

  const handleCreate = async () => {
    if (!createForm.template_code || !createForm.template_name || !createForm.asset_type) {
      setError('Required fields missing');
      return;
    }
    setError('');

    try {
      setUploading(true);
      await createChecklistTemplate(createForm);
      setShowCreateModal(false);
      setError('');
      setCreateForm({
        template_code: '',
        template_name: '',
        description: '',
        asset_type: '',
        task_type: 'PM',
        frequency: 'monthly'
      });
      loadTemplates();
    } catch (error) {
      console.error('Error creating template:', error);
      setError(getErrorMessage(error, 'Create failed'));
    } finally {
      setUploading(false);
    }
  };

  const handleEdit = (template) => {
    setSelectedTemplate(template);
    setCreateForm({
      template_code: template.template_code,
      template_name: template.template_name,
      description: template.description || '',
      asset_type: template.asset_type,
      task_type: template.task_type,
      frequency: template.frequency || 'monthly'
    });
    setShowEditModal(true);
  };

  const handleUpdate = async () => {
    if (!selectedTemplate?.id) return;

    try {
      setUploading(true);
      await updateChecklistTemplate(selectedTemplate.id, createForm);
      setShowEditModal(false);
      setError('');
      loadTemplates();
    } catch (error) {
      console.error('Error updating template:', error);
      setError(getErrorMessage(error, 'Update failed'));
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteClick = (template) => {
    setTemplateToDelete(template);
    setShowDeleteConfirm(true);
  };

  const handleDelete = async () => {
    if (!templateToDelete?.id) return;

    try {
      setUploading(true);
      await deleteChecklistTemplate(templateToDelete.id);
      setShowDeleteConfirm(false);
      setTemplateToDelete(null);
      setError('');
      loadTemplates();
    } catch (error) {
      console.error('Error deleting template:', error);
      setError(getErrorMessage(error, 'Delete failed'));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h2 className="page-title">Checklist Templates</h2>
          <p style={{ marginTop: '8px', color: '#666' }}>
            View and manage all available checklist templates. Click "View" to see the complete structure.
          </p>
        </div>
        {canCreate && (
          <div style={{ display: 'flex', gap: '10px' }}>
            <button className="btn btn-primary" onClick={() => setShowUploadModal(true)} title="Upload template file">
              Upload
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="error">{error}</div>
      )}

      {templates.length === 0 && !loading ? (
        <div className="card">
          <p style={{ color: '#dc3545', fontWeight: 'bold', marginBottom: '15px' }}>No checklist templates found.</p>
          <p><strong>Possible issues:</strong></p>
          <ul style={{ marginLeft: '20px', marginTop: '10px', marginBottom: '15px' }}>
            <li>API connection issue - Check if backend is running on port 3001</li>
            <li>Check browser console (F12) for errors</li>
            <li>Verify API URL in client/.env file</li>
          </ul>
          <button className="btn btn-primary" onClick={loadTemplates} style={{ marginTop: '10px' }}>
            Retry
          </button>
        </div>
      ) : (
        <div className="card">
          {(() => {
            const totalPages = Math.ceil(templates.length / itemsPerPage);
            const startIndex = (currentPage - 1) * itemsPerPage;
            const endIndex = startIndex + itemsPerPage;
            const currentTemplates = templates.slice(startIndex, endIndex);
            const startItem = templates.length > 0 ? startIndex + 1 : 0;
            const endItem = Math.min(endIndex, templates.length);

            return (
              <>
                <table className="checklist-templates-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #ddd' }}>
                      <th style={{ padding: '10px', textAlign: 'left' }}>Template Code</th>
                      <th style={{ padding: '10px', textAlign: 'left' }}>Template Name</th>
                      <th style={{ padding: '10px', textAlign: 'left' }}>Asset Type</th>
                      <th style={{ padding: '10px', textAlign: 'left' }}>Task Type</th>
                      <th style={{ padding: '10px', textAlign: 'left' }}>Frequency</th>
                      <th style={{ padding: '10px', textAlign: 'left' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentTemplates.map((template) => (
                      <tr key={template.id} style={{ borderBottom: '1px solid #eee' }}>
                        <td data-label="Template Code" style={{ padding: '10px' }}>{template.template_code}</td>
                        <td data-label="Template Name" style={{ padding: '10px' }}>{template.template_name}</td>
                        <td data-label="Asset Type" style={{ padding: '10px' }}>{template.asset_type}</td>
                        <td data-label="Task Type" style={{ padding: '10px' }}>
                          <span className={`task-badge ${template.task_type}`}>{template.task_type}</span>
                        </td>
                        <td data-label="Frequency" style={{ padding: '10px' }}>{template.frequency || 'N/A'}</td>
                        <td data-label="Action" style={{ padding: '10px' }}>
                          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                            <button
                              className="btn btn-primary"
                              onClick={() => handleViewDetails(template.id)}
                              title="View template details"
                            >
                              View
                            </button>
                            {canDelete && (
                              <button
                                onClick={() => handleDeleteClick(template)}
                                title="Delete template"
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  padding: '4px',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center'
                                }}
                              >
                                <svg
                                  width="20"
                                  height="20"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  xmlns="http://www.w3.org/2000/svg"
                                >
                                  <path
                                    d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14zM10 11v6M14 11v6"
                                    stroke="#dc3545"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                </svg>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
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
                    Showing {startItem}-{endItem} of {templates.length} template{templates.length !== 1 ? 's' : ''}
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
            );
          })()}
        </div>
      )}

      {/* Upload Template Modal */}
      {showUploadModal && (
        <div className="modal-overlay" onClick={() => !uploading && setShowUploadModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>Upload Template File</h3>
            <p style={{ fontSize: '14px', color: '#666', marginBottom: '20px' }}>
              Upload an Excel (.xlsx, .xls) or Word (.docx) file. The system will automatically extract the checklist structure.
            </p>
            <div className="form-group">
              <label>File *</label>
              <input
                type="file"
                accept=".xlsx,.xls,.docx"
                onChange={handleFileChange}
                disabled={uploading}
              />
            </div>
            <div className="form-group">
              <label>Asset Type *</label>
              <select
                value={uploadForm.asset_type}
                onChange={(e) => setUploadForm({ ...uploadForm, asset_type: e.target.value })}
                disabled={uploading}
              >
                <option value="">Select Asset Type</option>
                <option value="energy_meter">Energy Meter</option>
                <option value="inverter">Inverter</option>
                <option value="cctv">CCTV</option>
                <option value="ventilation">Ventilation</option>
                <option value="tracker">Tracker</option>
                <option value="substation">Substation</option>
                <option value="scada">SCADA</option>
                <option value="string_combiner_box">String Combiner Box</option>
                <option value="concentrated_cabinet">Concentrated Cabinet</option>
                <option value="ct_mv">CT-MV</option>
              </select>
            </div>
            <div className="form-group">
              <label>Asset Prefix * (e.g., EM, INV, CCTV)</label>
              <input
                type="text"
                value={uploadForm.asset_prefix}
                onChange={(e) => setUploadForm({ ...uploadForm, asset_prefix: e.target.value.toUpperCase() })}
                disabled={uploading}
                placeholder="EM"
              />
            </div>
            <div className="form-group">
              <label>Template Code (optional, auto-generated if not provided)</label>
              <input
                type="text"
                value={uploadForm.template_code}
                onChange={(e) => setUploadForm({ ...uploadForm, template_code: e.target.value })}
                disabled={uploading}
                placeholder="EM-PM-014"
              />
            </div>
            <div className="form-group">
              <label>Frequency</label>
              <select
                value={uploadForm.frequency}
                onChange={(e) => setUploadForm({ ...uploadForm, frequency: e.target.value })}
                disabled={uploading}
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="bi-monthly">Bi-Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="annually">Annually</option>
              </select>
            </div>
            <div className="form-group">
              <label>
                <input
                  type="checkbox"
                  checked={uploadForm.update_existing}
                  onChange={(e) => setUploadForm({ ...uploadForm, update_existing: e.target.checked })}
                  disabled={uploading}
                />
                Update existing template if code matches
              </label>
            </div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '20px' }}>
              <button className="btn btn-secondary" onClick={() => setShowUploadModal(false)} disabled={uploading}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleUpload} disabled={uploading}>
                {uploading ? 'Uploading...' : 'Upload'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Template Modal */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => !uploading && setShowCreateModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>Create New Template</h3>
            <div className="form-group">
              <label>Template Code *</label>
              <input
                type="text"
                value={createForm.template_code}
                onChange={(e) => setCreateForm({ ...createForm, template_code: e.target.value })}
                disabled={uploading}
                placeholder="EM-PM-014"
              />
            </div>
            <div className="form-group">
              <label>Template Name *</label>
              <input
                type="text"
                value={createForm.template_name}
                onChange={(e) => setCreateForm({ ...createForm, template_name: e.target.value })}
                disabled={uploading}
                placeholder="Energy Meter Inspection"
              />
            </div>
            <div className="form-group">
              <label>Description</label>
              <textarea
                value={createForm.description}
                onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                disabled={uploading}
                rows="3"
              />
            </div>
            <div className="form-group">
              <label>Asset Type *</label>
              <select
                value={createForm.asset_type}
                onChange={(e) => setCreateForm({ ...createForm, asset_type: e.target.value })}
                disabled={uploading}
              >
                <option value="">Select Asset Type</option>
                <option value="energy_meter">Energy Meter</option>
                <option value="inverter">Inverter</option>
                <option value="cctv">CCTV</option>
                <option value="ventilation">Ventilation</option>
                <option value="tracker">Tracker</option>
                <option value="substation">Substation</option>
                <option value="scada">SCADA</option>
                <option value="string_combiner_box">String Combiner Box</option>
                <option value="concentrated_cabinet">Concentrated Cabinet</option>
                <option value="ct_mv">CT-MV</option>
              </select>
            </div>
            <div className="form-group">
              <label>Task Type</label>
              <select
                value={createForm.task_type}
                onChange={(e) => setCreateForm({ ...createForm, task_type: e.target.value })}
                disabled={uploading}
              >
                <option value="PM">PM</option>
                <option value="CM">CM</option>
              </select>
            </div>
            <div className="form-group">
              <label>Frequency</label>
              <select
                value={createForm.frequency}
                onChange={(e) => setCreateForm({ ...createForm, frequency: e.target.value })}
                disabled={uploading}
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="bi-monthly">Bi-Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="annually">Annually</option>
              </select>
            </div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '20px' }}>
              <button className="btn btn-secondary" onClick={() => setShowCreateModal(false)} disabled={uploading}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleCreate} disabled={uploading}>
                {uploading ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Template Modal */}
      {showEditModal && (
        <div className="modal-overlay" onClick={() => !uploading && setShowEditModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>Edit Template</h3>
            <div className="form-group">
              <label>Template Code *</label>
              <input
                type="text"
                value={createForm.template_code}
                onChange={(e) => setCreateForm({ ...createForm, template_code: e.target.value })}
                disabled={uploading}
              />
            </div>
            <div className="form-group">
              <label>Template Name *</label>
              <input
                type="text"
                value={createForm.template_name}
                onChange={(e) => setCreateForm({ ...createForm, template_name: e.target.value })}
                disabled={uploading}
              />
            </div>
            <div className="form-group">
              <label>Description</label>
              <textarea
                value={createForm.description}
                onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                disabled={uploading}
                rows="3"
              />
            </div>
            <div className="form-group">
              <label>Asset Type *</label>
              <select
                value={createForm.asset_type}
                onChange={(e) => setCreateForm({ ...createForm, asset_type: e.target.value })}
                disabled={uploading}
              >
                <option value="energy_meter">Energy Meter</option>
                <option value="inverter">Inverter</option>
                <option value="cctv">CCTV</option>
                <option value="ventilation">Ventilation</option>
                <option value="tracker">Tracker</option>
                <option value="substation">Substation</option>
                <option value="scada">SCADA</option>
                <option value="string_combiner_box">String Combiner Box</option>
                <option value="concentrated_cabinet">Concentrated Cabinet</option>
                <option value="ct_mv">CT-MV</option>
              </select>
            </div>
            <div className="form-group">
              <label>Task Type</label>
              <select
                value={createForm.task_type}
                onChange={(e) => setCreateForm({ ...createForm, task_type: e.target.value })}
                disabled={uploading}
              >
                <option value="PM">PM</option>
                <option value="CM">CM</option>
              </select>
            </div>
            <div className="form-group">
              <label>Frequency</label>
              <select
                value={createForm.frequency}
                onChange={(e) => setCreateForm({ ...createForm, frequency: e.target.value })}
                disabled={uploading}
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="bi-monthly">Bi-Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="annually">Annually</option>
              </select>
            </div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '20px' }}>
              <button className="btn btn-secondary" onClick={() => setShowEditModal(false)} disabled={uploading}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleUpdate} disabled={uploading}>
                {uploading ? 'Updating...' : 'Update'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && templateToDelete && (
        <div className="modal-overlay" onClick={() => !uploading && setShowDeleteConfirm(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>Delete Template</h3>
            <p>Are you sure you want to delete template <strong>{templateToDelete.template_code}</strong>?</p>
            <p style={{ color: '#dc3545', fontSize: '14px' }}>This action cannot be undone.</p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '20px' }}>
              <button className="btn btn-secondary" onClick={() => setShowDeleteConfirm(false)} disabled={uploading}>
                Cancel
              </button>
              <button className="btn btn-danger" onClick={handleDelete} disabled={uploading}>
                {uploading ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ChecklistTemplates;

