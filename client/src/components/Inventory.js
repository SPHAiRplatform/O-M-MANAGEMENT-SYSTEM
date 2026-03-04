import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getInventoryItems, adjustInventory, downloadInventoryExcel, getSparesUsage, createInventoryItem, updateInventoryItem } from '../api/api';
import { useAuth } from '../context/AuthContext';
import { hasOrganizationContext, isSystemOwnerWithoutCompany } from '../utils/organizationContext';
import { ErrorAlert, SuccessAlert } from './ErrorAlert';
import './Inventory.css';

function Inventory() {
  const { isAdmin, user, loading: authLoading } = useAuth();
  const [items, setItems] = useState([]);
  const [q, setQ] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [alertError, setAlertError] = useState(null);
  const [alertSuccess, setAlertSuccess] = useState(null);
  const searchDebounceRef = useRef(null);

  const [adjusting, setAdjusting] = useState(null); // item
  const [qtyChange, setQtyChange] = useState('');
  const [note, setNote] = useState('');
  const [expandedSections, setExpandedSections] = useState(new Set()); // Track which sections are expanded
  const [viewMode, setViewMode] = useState('inventory'); // 'inventory' or 'usage'
  const [usageDateRange, setUsageDateRange] = useState({ startDate: '', endDate: '' });
  const [sparesUsage, setSparesUsage] = useState([]);
  const [loadingUsage, setLoadingUsage] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [newItem, setNewItem] = useState({
    section: '',
    item_code: '',
    item_description: '',
    part_type: '',
    min_level: 0,
    actual_qty: 0
  });
  const [editForm, setEditForm] = useState({
    section: '',
    item_code: '',
    item_description: '',
    part_type: '',
    min_level: 0
  });

  const load = useCallback(async (searchQuery, lowStockFilter) => {
    try {
      setLoading(true);
      setError('');
      
      // Wait for AuthContext to finish loading before checking organization context
      if (authLoading) {
        setLoading(false);
        return;
      }
      
      // Check if user has organization context
      if (!hasOrganizationContext(user)) {
        // System owner without company: show empty inventory
        setItems([]);
        setLoading(false);
        return;
      }
      
      const query = searchQuery?.trim() || undefined;
      const low_stock = lowStockFilter ? 'true' : undefined;
      const resp = await getInventoryItems({ q: query, low_stock });
      setItems(resp.data || []);
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Failed to load inventory');
    } finally {
      setLoading(false);
    }
  }, [user, authLoading]);

  // Initial load
  useEffect(() => {
    // Wait for AuthContext to finish loading before loading data
    if (!authLoading) {
      load('', false);
    }
  }, [load, authLoading]);

  // Debounced auto-search (lets you type normally without firing on every keystroke)
  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      load(q, lowOnly);
    }, 450);

    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [q, lowOnly, load]);

  const groupedBySection = useMemo(() => {
    const map = new Map();
    for (const it of items) {
      // Extract subtitle part (before " | ") for grouping, keep numbers searchable in DB
      const fullSection = String(it.section || '').trim();
      const section = fullSection.includes(' | ') 
        ? fullSection.split(' | ')[0].trim() 
        : fullSection || 'Other';
      if (!map.has(section)) map.set(section, []);
      map.get(section).push(it);
    }
    return Array.from(map.entries()).map(([section, sectionItems]) => ({ section, items: sectionItems }));
  }, [items]);

  // Initialize all sections as collapsed by default when sections change
  useEffect(() => {
    const allSections = new Set(groupedBySection.map(g => g.section));
    setExpandedSections(prev => {
      const next = new Set();
      // Only keep sections that were already expanded (preserve user's manual expansion)
      for (const section of prev) {
        if (allSections.has(section)) {
          next.add(section);
        }
      }
      // New sections are not added (default to collapsed)
      return next;
    });
  }, [groupedBySection]);

  const toggleSection = (section) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  const expandAll = () => {
    setExpandedSections(new Set(groupedBySection.map(g => g.section)));
  };

  const collapseAll = () => {
    setExpandedSections(new Set());
  };

  const handleDownload = async () => {
    try {
      await downloadInventoryExcel();
      // Download is handled by the API function, no need to reload
    } catch (e) {
      setAlertError({ message: 'Download failed', details: e.response?.data?.error || e.message });
    }
  };

  const adjustFormRef = useRef(null);

  const openAdjust = (item) => {
    setAdjusting(item);
    setQtyChange('');
    setNote('');
    // Scroll to adjustment form after a brief delay to ensure it's rendered
    setTimeout(() => {
      if (adjustFormRef.current) {
        adjustFormRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Focus on the quantity input
        const qtyInput = adjustFormRef.current.querySelector('input[type="number"], input[placeholder*="e.g"]');
        if (qtyInput) {
          qtyInput.focus();
        }
      }
    }, 100);
  };

  const submitAdjust = async () => {
    try {
      const delta = parseInt(qtyChange, 10);
      if (!Number.isFinite(delta) || delta === 0) {
        setAlertError({ message: 'Enter a non-zero integer quantity change (e.g., 5 or -2)' });
        return;
      }
      await adjustInventory({ item_code: adjusting.item_code, qty_change: delta, note, tx_type: delta > 0 ? 'restock' : 'adjust' });
      setAdjusting(null);
      setAlertSuccess({ message: 'Inventory adjusted successfully!' });
      await load(q, lowOnly);
    } catch (e) {
      setAlertError({ message: 'Adjust failed', details: e.response?.data?.error || e.message });
    }
  };

  const loadSparesUsage = useCallback(async (startDate, endDate) => {
    try {
      setLoadingUsage(true);
      const params = {};
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;
      const resp = await getSparesUsage(params);
      setSparesUsage(resp.data || []);
    } catch (e) {
      console.error('Failed to load spares usage:', e);
      setSparesUsage([]);
    } finally {
      setLoadingUsage(false);
    }
  }, []);

  useEffect(() => {
    if (viewMode === 'usage') {
      loadSparesUsage(usageDateRange.startDate, usageDateRange.endDate);
    }
  }, [viewMode, usageDateRange.startDate, usageDateRange.endDate, loadSparesUsage]);

  if (loading && viewMode === 'inventory') return <div className="loading">Loading inventory...</div>;

  return (
    <div className="inventory-container">
      <ErrorAlert
        error={alertError}
        onClose={() => setAlertError(null)}
        title="Inventory Error"
      />
      <SuccessAlert
        message={alertSuccess?.message}
        onClose={() => setAlertSuccess(null)}
        title="Success"
      />
      <div className="inventory-header page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '15px' }}>
        <h2 className="page-title" style={{ margin: 0 }}>Inventory Count</h2>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: '2px', border: '1px solid var(--md-border)', borderRadius: '6px', padding: '2px' }}>
            <button
              className={`btn btn-sm ${viewMode === 'inventory' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setViewMode('inventory')}
              style={{ padding: '5px 10px', fontSize: '12px' }}
            >
              Stock
            </button>
            <button
              className={`btn btn-sm ${viewMode === 'usage' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setViewMode('usage')}
              style={{ padding: '5px 10px', fontSize: '12px' }}
            >
              Usage
            </button>
          </div>
          {isAdmin() && viewMode === 'inventory' && (
            <>
              <button 
                className="btn btn-sm btn-primary" 
                onClick={() => setShowAddModal(true)}
                style={{ padding: '5px 10px', fontSize: '12px' }}
              >
                + Add
              </button>
              <button 
                className="btn btn-sm btn-primary" 
                onClick={handleDownload}
                style={{ padding: '5px 10px', fontSize: '12px' }}
              >
                ↓ Export
              </button>
            </>
          )}
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {viewMode === 'usage' ? (
        <div>
          <div className="card" style={{ marginBottom: '12px', padding: '14px' }}>
            <div className="inventory-usage-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '15px' }}>
              <h3 style={{ marginTop: 0, marginBottom: 0, fontSize: '16px', fontWeight: '600' }}>Spares Usage Report</h3>
              <div className="inventory-usage-dates" style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <label style={{ fontSize: '13px', fontWeight: 500, whiteSpace: 'nowrap' }}>Start Date:</label>
                  <input
                    type="date"
                    value={usageDateRange.startDate}
                    onChange={(e) => setUsageDateRange({ ...usageDateRange, startDate: e.target.value })}
                    style={{ padding: '6px 10px', borderRadius: '4px', border: '1px solid var(--md-border)', fontSize: '13px' }}
                  />
                </div>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <label style={{ fontSize: '13px', fontWeight: 500, whiteSpace: 'nowrap' }}>End Date:</label>
                  <input
                    type="date"
                    value={usageDateRange.endDate}
                    onChange={(e) => setUsageDateRange({ ...usageDateRange, endDate: e.target.value })}
                    min={usageDateRange.startDate || undefined}
                    style={{ padding: '6px 10px', borderRadius: '4px', border: '1px solid var(--md-border)', fontSize: '13px' }}
                  />
                </div>
                <button
                  className="btn btn-sm btn-secondary"
                  onClick={() => setUsageDateRange({ startDate: '', endDate: '' })}
                  style={{ padding: '6px 12px', fontSize: '13px', whiteSpace: 'nowrap' }}
                >
                  Clear
                </button>
              </div>
            </div>
          </div>

          {loadingUsage ? (
            <div className="loading">Loading spares usage...</div>
          ) : sparesUsage.length === 0 ? (
            <div className="card">
              <p style={{ textAlign: 'center', color: '#666', padding: '40px' }}>
                No spares usage found{usageDateRange.startDate || usageDateRange.endDate ? ' for the selected date range' : ''}.
              </p>
            </div>
          ) : (
            <div className="card">
              <div className="table-responsive">
                <table className="inventory-usage-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #ddd' }}>
                      <th style={{ padding: '12px', textAlign: 'left' }}>Section</th>
                      <th style={{ padding: '12px', textAlign: 'left' }}>Item Code</th>
                      <th style={{ padding: '12px', textAlign: 'left' }}>Description</th>
                      <th style={{ padding: '12px', textAlign: 'right' }}>Total Qty Used</th>
                      <th style={{ padding: '12px', textAlign: 'right' }}>Usage Count</th>
                      <th style={{ padding: '12px', textAlign: 'left' }}>Last Used</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sparesUsage.map((item, idx) => (
                      <tr key={idx} style={{ borderBottom: '1px solid #eee' }}>
                        <td data-label="Section" style={{ padding: '12px', fontWeight: '500' }}>{item.section || '-'}</td>
                        <td data-label="Item Code" style={{ padding: '12px', fontFamily: 'monospace', fontSize: '13px' }}>{item.item_code}</td>
                        <td data-label="Description" style={{ padding: '12px' }}>{item.item_description || '-'}</td>
                        <td data-label="Total Qty Used" style={{ padding: '12px', textAlign: 'right', fontWeight: '600', color: 'var(--md-error)' }}>
                          {parseInt(item.total_qty_used) || 0}
                        </td>
                        <td data-label="Usage Count" style={{ padding: '12px', textAlign: 'right', color: '#666' }}>
                          {item.usage_count || 0}
                        </td>
                        <td data-label="Last Used" style={{ padding: '12px', fontSize: '13px', color: '#666' }}>
                          {item.last_used_at ? new Date(item.last_used_at).toLocaleDateString() : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="card" style={{ marginBottom: '15px' }}>
        <div className="inventory-search-row" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by item code, section or description..."
            className="inventory-search-input"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
                load(q, lowOnly);
              }
            }}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', whiteSpace: 'nowrap' }}>
            <input
              type="checkbox"
              checked={lowOnly}
              onChange={(e) => setLowOnly(e.target.checked)}
              style={{ width: '16px', height: '16px', cursor: 'pointer' }}
            />
            Low stock only
          </label>
          <button
            className="btn btn-sm btn-primary"
            onClick={() => {
              if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
              load(q, lowOnly);
            }}
            style={{ padding: '8px 16px', fontSize: '13px', whiteSpace: 'nowrap' }}
          >
            Search
          </button>
        </div>
        {q && (
          <div style={{ marginTop: '12px' }}>
            <button
              className="btn btn-sm btn-secondary"
              onClick={() => {
                setQ('');
                if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
                load('', lowOnly);
              }}
              style={{ padding: '4px 10px', fontSize: '12px' }}
            >
              Clear Search
            </button>
          </div>
        )}
      </div>

      <div className="card">
        <style>{`
          @keyframes blink {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.3; }
          }
        `}</style>
        <div className="inventory-items-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <h3 style={{ marginTop: 0, marginBottom: 0, fontSize: '16px' }}>Items ({items.length})</h3>
          <div style={{ display: 'flex', gap: '4px' }}>
            <button 
              className="btn btn-sm btn-secondary" 
              onClick={expandAll}
              style={{ padding: '4px 8px', fontSize: '11px' }}
            >
              Expand
            </button>
            <button 
              className="btn btn-sm btn-secondary" 
              onClick={collapseAll}
              style={{ padding: '4px 8px', fontSize: '11px' }}
            >
              Collapse
            </button>
          </div>
        </div>

        {groupedBySection.map((group) => {
          const isExpanded = expandedSections.has(group.section);
          return (
            <div key={group.section} style={{ marginTop: '12px' }}>
              <div
                className="inventory-section-header"
                onClick={() => toggleSection(group.section)}
              >
                <span style={{ fontSize: '12px', transition: 'transform 0.2s', transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>
                  ▶
                </span>
                <span>{group.section}</span>
                <span style={{ color: '#777', fontWeight: 500, fontSize: '13px' }}>({group.items.length})</span>
                {group.items.some(it => (it.actual_qty ?? 0) < (it.min_level ?? 0)) && (
                  <span 
                    style={{
                      display: 'inline-block',
                      fontSize: '18px',
                      animation: 'blink 1.5s infinite',
                      cursor: 'help',
                      marginLeft: 'auto'
                    }}
                    title={`Warning: Some items in this section are below minimum quantity`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <i className="bi bi-exclamation-triangle"></i>
                  </span>
                )}
              </div>
              {isExpanded && (
                <div className="table-responsive">
                  <table className="inventory-table-mobile" style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #ddd' }}>
                        <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: '13px', fontWeight: '600' }}>Location</th>
                        <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: '13px', fontWeight: '600' }}>Item Code</th>
                        <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: '13px', fontWeight: '600' }}>Description</th>
                        <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: '13px', fontWeight: '600' }}>Min</th>
                        <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: '13px', fontWeight: '600' }}>Actual Qty</th>
                        {isAdmin() && <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: '13px', fontWeight: '600' }}>Actions</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {group.items.map((it) => {
                        const actualQty = it.actual_qty ?? 0;
                        const minLevel = it.min_level ?? 0;
                        const low = actualQty < minLevel; // Below minimum
                        const atMinimum = actualQty === minLevel && minLevel > 0; // At minimum (not zero)
                        
                        // Extract section number from section string (e.g., "AC Meter Cabinet (AC Meter Cabinet) | 56" -> "56")
                        const extractSectionNumber = (sectionStr) => {
                          if (!sectionStr) return '-';
                          // Look for number after "| " separator
                          const match = sectionStr.match(/\|\s*(\d+)/);
                          if (match) return match[1];
                          // If no separator, try to find any number in the string
                          const numberMatch = sectionStr.match(/(\d+)/);
                          return numberMatch ? numberMatch[1] : sectionStr;
                        };
                        const sectionNumber = extractSectionNumber(it.section);
                        
                        // Determine background color: yellow for below minimum, light blue for at minimum
                        let rowBackground = 'transparent';
                        if (low) {
                          rowBackground = '#fff3cd'; // Yellow - below minimum
                        } else if (atMinimum) {
                          rowBackground = '#b3e5fc'; // Light blue - at minimum (equal to minimum level)
                        }
                        
                        return (
                          <tr key={it.id} style={{ borderBottom: '1px solid #eee', background: rowBackground }}>
                            <td data-label="Location" style={{ padding: '8px 10px', fontSize: '13px', color: '#666', fontFamily: 'monospace' }}>{sectionNumber}</td>
                            <td data-label="Item Code" style={{ padding: '8px 10px', fontWeight: '600', fontSize: '13px' }}>{it.item_code}</td>
                            <td data-label="Description" style={{ padding: '8px 10px', fontSize: '13px' }}>{it.item_description || '-'}</td>
                            <td data-label="Min Level" style={{ padding: '8px 10px', fontSize: '13px' }}>{it.min_level ?? 0}</td>
                            <td data-label="Actual Qty" style={{ padding: '8px 10px', fontSize: '13px' }}>{it.actual_qty ?? 0}</td>
                            {isAdmin() && (
                              <td data-label="Actions" style={{ padding: '8px 10px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                <button 
                                  className="btn btn-sm btn-secondary" 
                                  onClick={() => {
                                    setEditingItem(it);
                                    setEditForm({
                                      section: it.section || '',
                                      item_code: it.item_code || '',
                                      item_description: it.item_description || '',
                                      part_type: it.part_type || '',
                                      min_level: it.min_level || 0
                                    });
                                  }}
                                  title="Edit spare details"
                                  style={{ padding: '4px 10px', fontSize: '12px' }}
                                >
                                  Edit
                                </button>
                                <button 
                                  className="btn btn-sm btn-primary" 
                                  onClick={() => openAdjust(it)} 
                                  title="Restock when new stock arrives"
                                  style={{ padding: '4px 10px', fontSize: '12px' }}
                                >
                                  Restock
                                </button>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {adjusting && (
        <div ref={adjustFormRef} className="card" style={{ marginTop: '12px', border: '1px solid var(--md-info)', padding: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', paddingBottom: '10px', borderBottom: '1px solid var(--md-border)' }}>
            <div>
              <h3 style={{ marginTop: 0, marginBottom: '4px', color: 'var(--md-info)', fontSize: '17px' }}>Restock Item: {adjusting.item_code}</h3>
              <p style={{ color: '#666', margin: 0, fontSize: '13px' }}>{adjusting.item_description}</p>
            </div>
            <button 
              className="btn btn-sm btn-secondary" 
              onClick={() => setAdjusting(null)}
              style={{ padding: '5px 12px', fontSize: '12px' }}
            >
              Close
            </button>
          </div>
          
          <div style={{ background: '#f8f9fa', padding: '10px', borderRadius: '4px', marginBottom: '14px', borderLeft: '3px solid var(--md-info)' }}>
            <p style={{ margin: 0, fontSize: '12px', color: '#666' }}>
              Use this form only when new stock arrives from suppliers. Spares used in tasks are automatically deducted.
            </p>
          </div>

          <div className="inventory-adjust-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
            <div>
              <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>Current Stock</div>
              <div style={{ fontSize: '20px', fontWeight: 'bold', color: 'var(--md-text-dark)' }}>
                {adjusting.actual_qty ?? 0}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>Minimum Level</div>
              <div style={{ fontSize: '16px', fontWeight: '600', color: (adjusting.actual_qty ?? 0) <= (adjusting.min_level ?? 0) ? 'var(--md-error)' : 'var(--md-success)' }}>
                {adjusting.min_level ?? 0}
              </div>
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: '12px' }}>
            <label style={{ fontSize: '13px', marginBottom: '6px', display: 'block', fontWeight: '500' }}>
              Quantity to Add <span style={{ color: 'var(--md-error)' }}>*</span>
            </label>
            <input 
              type="number" 
              value={qtyChange} 
              onChange={(e) => {
                const val = e.target.value;
                // Only allow positive numbers for restocking
                if (val === '' || (parseInt(val, 10) > 0)) {
                  setQtyChange(val);
                }
              }} 
              placeholder="e.g. 10" 
              min="1"
              style={{ width: '100%', fontSize: '14px', padding: '8px 12px', border: '1px solid #ddd', borderRadius: '4px' }}
            />
          </div>
          <div className="form-group" style={{ marginBottom: '16px' }}>
            <label style={{ fontSize: '13px', marginBottom: '6px', display: 'block', fontWeight: '500' }}>Note (optional)</label>
            <input 
              value={note} 
              onChange={(e) => setNote(e.target.value)} 
              placeholder="e.g. New stock received from supplier..." 
              style={{ width: '100%', fontSize: '14px', padding: '8px 12px', border: '1px solid #ddd', borderRadius: '4px' }}
            />
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '16px', paddingTop: '16px', borderTop: '1px solid #eee' }}>
            <button 
              className="btn btn-sm btn-primary" 
              onClick={submitAdjust} 
              style={{ flex: 1, padding: '8px 16px', fontSize: '13px' }}
            >
              Save Restock
            </button>
            <button 
              className="btn btn-sm btn-secondary" 
              onClick={() => setAdjusting(null)} 
              style={{ flex: 1, padding: '8px 16px', fontSize: '13px' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {!adjusting && viewMode === 'inventory' && (
        <p style={{ marginTop: '16px', marginBottom: 0, fontSize: '11px', color: '#dc3545', textAlign: 'center' }}>
          When spares are selected and used during PM/PCM tasks, they are automatically deducted from the available stock (Actual Qty). The "Restock" button should only be used when new stock arrives from suppliers.
        </p>
      )}

      {/* Add New Spare Modal */}
      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '550px', padding: '20px' }}>
            <div className="modal-header" style={{ marginBottom: '16px', paddingBottom: '12px' }}>
              <h2 style={{ margin: 0, fontSize: '20px' }}>Add New Spare</h2>
              <button className="modal-close" onClick={() => setShowAddModal(false)} style={{ fontSize: '24px', width: '28px', height: '28px' }}>×</button>
            </div>
            <form onSubmit={async (e) => {
              e.preventDefault();
              try {
                await createInventoryItem(newItem);
                setShowAddModal(false);
                setNewItem({ section: '', item_code: '', item_description: '', part_type: '', min_level: 0, actual_qty: 0 });
                setAlertSuccess({ message: 'Spare created successfully!' });
                await load(q, lowOnly);
              } catch (error) {
                setAlertError({ message: 'Failed to create spare', details: error.response?.data?.error || error.message });
              }
            }}>
              <div className="form-group" style={{ marginBottom: '14px' }}>
                <label style={{ fontSize: '13px', marginBottom: '6px', display: 'block', fontWeight: '500' }}>Item Code *</label>
                <input
                  type="text"
                  value={newItem.item_code}
                  onChange={(e) => setNewItem({ ...newItem, item_code: e.target.value.toUpperCase() })}
                  required
                  placeholder="e.g., SP-001"
                  style={{ width: '100%', padding: '8px 12px', fontSize: '14px', border: '1px solid #ddd', borderRadius: '4px' }}
                />
              </div>
              <div className="form-group" style={{ marginBottom: '14px' }}>
                <label style={{ fontSize: '13px', marginBottom: '6px', display: 'block', fontWeight: '500' }}>Description</label>
                <input
                  type="text"
                  value={newItem.item_description}
                  onChange={(e) => setNewItem({ ...newItem, item_description: e.target.value })}
                  placeholder="Item description"
                  style={{ width: '100%', padding: '8px 12px', fontSize: '14px', border: '1px solid #ddd', borderRadius: '4px' }}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label style={{ fontSize: '13px', marginBottom: '6px', display: 'block', fontWeight: '500' }}>Section</label>
                  <input
                    type="text"
                    value={newItem.section}
                    onChange={(e) => setNewItem({ ...newItem, section: e.target.value })}
                    placeholder="e.g., Section 1"
                    style={{ width: '100%', padding: '8px 12px', fontSize: '14px', border: '1px solid #ddd', borderRadius: '4px' }}
                  />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label style={{ fontSize: '13px', marginBottom: '6px', display: 'block', fontWeight: '500' }}>Part Type</label>
                  <input
                    type="text"
                    value={newItem.part_type}
                    onChange={(e) => setNewItem({ ...newItem, part_type: e.target.value })}
                    placeholder="e.g., Spare Part"
                    style={{ width: '100%', padding: '8px 12px', fontSize: '14px', border: '1px solid #ddd', borderRadius: '4px' }}
                  />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label style={{ fontSize: '13px', marginBottom: '6px', display: 'block', fontWeight: '500' }}>Minimum Level</label>
                  <input
                    type="number"
                    value={newItem.min_level}
                    onChange={(e) => setNewItem({ ...newItem, min_level: parseInt(e.target.value, 10) || 0 })}
                    min="0"
                    style={{ width: '100%', padding: '8px 12px', fontSize: '14px', border: '1px solid #ddd', borderRadius: '4px' }}
                  />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label style={{ fontSize: '13px', marginBottom: '6px', display: 'block', fontWeight: '500' }}>Initial Quantity</label>
                  <input
                    type="number"
                    value={newItem.actual_qty}
                    onChange={(e) => setNewItem({ ...newItem, actual_qty: parseInt(e.target.value, 10) || 0 })}
                    min="0"
                    style={{ width: '100%', padding: '8px 12px', fontSize: '14px', border: '1px solid #ddd', borderRadius: '4px' }}
                  />
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px', marginTop: '16px', paddingTop: '16px', borderTop: '1px solid #eee' }}>
                <button 
                  type="submit" 
                  className="btn btn-sm btn-primary" 
                  style={{ flex: 1, padding: '8px 16px', fontSize: '13px' }}
                >
                  Create Spare
                </button>
                <button 
                  type="button" 
                  className="btn btn-sm btn-secondary" 
                  onClick={() => setShowAddModal(false)} 
                  style={{ flex: 1, padding: '8px 16px', fontSize: '13px' }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Spare Modal */}
      {editingItem && (
        <div className="modal-overlay" onClick={() => setEditingItem(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '600px', padding: '20px' }}>
            <div className="modal-header" style={{ marginBottom: '16px', paddingBottom: '12px' }}>
              <h2 style={{ margin: 0, fontSize: '20px' }}>Edit Spare</h2>
              <button className="modal-close" onClick={() => setEditingItem(null)} style={{ fontSize: '24px', width: '28px', height: '28px' }}>×</button>
            </div>
            <div style={{ marginBottom: '16px', padding: '10px', background: '#f8f9fa', borderRadius: '4px', fontSize: '12px', color: '#666' }}>
              <p style={{ margin: 0 }}>Update only the fields you want to change. The Excel sheet will be updated automatically. Use the "Restock" button to update actual quantity.</p>
            </div>
            <form onSubmit={async (e) => {
              e.preventDefault();
              try {
                // Build update object with only changed fields
                const updates = {};
                if (editForm.section !== (editingItem.section || '')) {
                  updates.section = editForm.section;
                }
                if (editForm.item_code !== editingItem.item_code) {
                  updates.item_code = editForm.item_code.toUpperCase();
                }
                if (editForm.item_description !== (editingItem.item_description || '')) {
                  updates.item_description = editForm.item_description;
                }
                if (editForm.part_type !== (editingItem.part_type || '')) {
                  updates.part_type = editForm.part_type;
                }
                if (parseInt(editForm.min_level, 10) !== (editingItem.min_level || 0)) {
                  updates.min_level = parseInt(editForm.min_level, 10) || 0;
                }

                if (Object.keys(updates).length === 0) {
                  setAlertError({ message: 'No changes detected. Please modify at least one field.' });
                  return;
                }

                await updateInventoryItem(editingItem.item_code, updates);
                setEditingItem(null);
                setEditForm({ section: '', item_code: '', item_description: '', part_type: '', min_level: 0 });
                setAlertSuccess({ message: 'Spare updated successfully!' });
                await load(q, lowOnly);
              } catch (error) {
                setAlertError({ message: 'Failed to update spare', details: error.response?.data?.error || error.message });
              }
            }}>
              <div className="form-group" style={{ marginBottom: '14px' }}>
                <label style={{ fontSize: '13px', marginBottom: '6px', display: 'block', fontWeight: '500' }}>Item Code *</label>
                <input
                  type="text"
                  value={editForm.item_code}
                  onChange={(e) => setEditForm({ ...editForm, item_code: e.target.value.toUpperCase() })}
                  required
                  style={{ width: '100%', padding: '8px 12px', fontSize: '14px', border: '1px solid #ddd', borderRadius: '4px' }}
                />
                <small style={{ color: '#666', marginTop: '4px', display: 'block', fontSize: '11px' }}>
                  Current: {editingItem.item_code}
                </small>
              </div>
              <div className="form-group" style={{ marginBottom: '14px' }}>
                <label style={{ fontSize: '13px', marginBottom: '6px', display: 'block', fontWeight: '500' }}>Description</label>
                <input
                  type="text"
                  value={editForm.item_description}
                  onChange={(e) => setEditForm({ ...editForm, item_description: e.target.value })}
                  style={{ width: '100%', padding: '8px 12px', fontSize: '14px', border: '1px solid #ddd', borderRadius: '4px' }}
                />
                <small style={{ color: '#666', marginTop: '4px', display: 'block', fontSize: '11px' }}>
                  Current: {editingItem.item_description || '-'}
                </small>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label style={{ fontSize: '13px', marginBottom: '6px', display: 'block', fontWeight: '500' }}>Section</label>
                  <input
                    type="text"
                    value={editForm.section}
                    onChange={(e) => setEditForm({ ...editForm, section: e.target.value })}
                    style={{ width: '100%', padding: '8px 12px', fontSize: '14px', border: '1px solid #ddd', borderRadius: '4px' }}
                  />
                  <small style={{ color: '#666', marginTop: '4px', display: 'block', fontSize: '11px' }}>
                    Current: {editingItem.section || '-'}
                  </small>
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label style={{ fontSize: '13px', marginBottom: '6px', display: 'block', fontWeight: '500' }}>Part Type</label>
                  <input
                    type="text"
                    value={editForm.part_type}
                    onChange={(e) => setEditForm({ ...editForm, part_type: e.target.value })}
                    style={{ width: '100%', padding: '8px 12px', fontSize: '14px', border: '1px solid #ddd', borderRadius: '4px' }}
                  />
                  <small style={{ color: '#666', marginTop: '4px', display: 'block', fontSize: '11px' }}>
                    Current: {editingItem.part_type || '-'}
                  </small>
                </div>
              </div>
              <div className="form-group" style={{ marginBottom: '16px' }}>
                <label style={{ fontSize: '13px', marginBottom: '6px', display: 'block', fontWeight: '500' }}>Minimum Level</label>
                <input
                  type="number"
                  value={editForm.min_level}
                  onChange={(e) => setEditForm({ ...editForm, min_level: parseInt(e.target.value, 10) || 0 })}
                  min="0"
                  style={{ width: '100%', padding: '8px 12px', fontSize: '14px', border: '1px solid #ddd', borderRadius: '4px' }}
                />
                <small style={{ color: '#666', marginTop: '4px', display: 'block', fontSize: '11px' }}>
                  Current: {editingItem.min_level || 0}
                </small>
              </div>
              <div style={{ display: 'flex', gap: '8px', marginTop: '16px', paddingTop: '16px', borderTop: '1px solid #eee' }}>
                <button 
                  type="submit" 
                  className="btn btn-sm btn-primary" 
                  style={{ flex: 1, padding: '8px 16px', fontSize: '13px' }}
                >
                  Update Spare
                </button>
                <button 
                  type="button" 
                  className="btn btn-sm btn-secondary" 
                  onClick={() => setEditingItem(null)} 
                  style={{ flex: 1, padding: '8px 16px', fontSize: '13px' }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
        </>
      )}
    </div>
  );
}

export default Inventory;


