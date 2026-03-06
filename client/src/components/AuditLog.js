import React, { useState, useEffect } from 'react';
import { getApiBaseUrl, authFetch } from '../api/api';
import { getErrorMessage } from '../utils/errorHandler';
import DataTable from './DataTable';
import TableSkeleton from './TableSkeleton';
import './AuditLog.css';

function AuditLog() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actions, setActions] = useState([]);
  const [entityTypes, setEntityTypes] = useState([]);

  // Filters
  const [actionFilter, setActionFilter] = useState('');
  const [entityFilter, setEntityFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  // Pagination
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    loadAuditLog();
    loadFilters();
  }, [page, actionFilter, entityFilter, searchQuery, fromDate, toDate]);

  const loadAuditLog = async () => {
    try {
      setLoading(true);
      setError('');

      const params = new URLSearchParams();
      params.append('page', page);
      params.append('limit', pageSize);
      if (actionFilter) params.append('action', actionFilter);
      if (entityFilter) params.append('entity_type', entityFilter);
      if (searchQuery) params.append('search', searchQuery);
      if (fromDate) params.append('from', fromDate);
      if (toDate) params.append('to', toDate);

      const response = await authFetch(`${getApiBaseUrl()}/audit-log?${params}`);

      if (!response.ok) throw new Error('Failed to load audit log');

      const data = await response.json();
      setEntries(data.entries || []);
      setTotal(data.total || 0);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const loadFilters = async () => {
    try {
      const [actionsRes, typesRes] = await Promise.all([
        authFetch(`${getApiBaseUrl()}/audit-log/actions`),
        authFetch(`${getApiBaseUrl()}/audit-log/entity-types`)
      ]);

      if (actionsRes.ok) {
        const data = await actionsRes.json();
        setActions(data);
      }
      if (typesRes.ok) {
        const data = await typesRes.json();
        setEntityTypes(data);
      }
    } catch (err) {
      console.error('Failed to load filters:', err);
    }
  };

  const handleReset = () => {
    setActionFilter('');
    setEntityFilter('');
    setSearchQuery('');
    setFromDate('');
    setToDate('');
    setPage(1);
  };

  const getActionBadgeClass = (action) => {
    switch (action) {
      case 'create': return 'action-create';
      case 'update': return 'action-update';
      case 'delete': return 'action-delete';
      case 'login': return 'action-login';
      default: return 'action-default';
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleString();
  };

  const getTimeAgo = (timestamp) => {
    if (!timestamp) return '';
    const diff = Date.now() - new Date(timestamp).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  const columns = [
    {
      key: 'created_at',
      label: 'Time',
      sortable: true,
      render: (value, row) => (
        <div title={formatDate(row.created_at)}>
          {getTimeAgo(row.created_at)}
        </div>
      )
    },
    {
      key: 'username',
      label: 'User',
      sortable: true,
      render: (value, row) => row.username || 'System'
    },
    {
      key: 'action',
      label: 'Action',
      sortable: true,
      render: (value, row) => (
        <span className={`action-badge ${getActionBadgeClass(row.action)}`}>
          {row.action}
        </span>
      )
    },
    {
      key: 'entity_type',
      label: 'Entity Type',
      sortable: true
    },
    {
      key: 'entity_id',
      label: 'Entity ID',
      render: (value, row) => row.entity_id || '-'
    },
    {
      key: 'organization_name',
      label: 'Organization',
      render: (value, row) => row.organization_name || '-'
    },
    {
      key: 'details',
      label: 'Details',
      render: (value, row) => {
        const details = row.details || {};
        const str = JSON.stringify(details).substring(0, 50);
        return <span title={JSON.stringify(details)}>{str}...</span>;
      }
    }
  ];

  return (
    <div className="audit-log-container">
      <div className="audit-log-header">
        <h1><i className="bi bi-journal-text"></i> Audit Log</h1>
        <p className="audit-subtitle">Track all system events and user actions</p>
      </div>

      {error && (
        <div className="audit-alert audit-alert-error">
          <i className="bi bi-exclamation-triangle"></i> {error}
        </div>
      )}

      <div className="audit-filters">
        <div className="filter-group">
          <label>From</label>
          <input
            type="datetime-local"
            value={fromDate}
            onChange={(e) => {
              setFromDate(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="filter-group">
          <label>To</label>
          <input
            type="datetime-local"
            value={toDate}
            onChange={(e) => {
              setToDate(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="filter-group">
          <label>Action</label>
          <select
            value={actionFilter}
            onChange={(e) => {
              setActionFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All Actions</option>
            {actions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
        <div className="filter-group">
          <label>Entity Type</label>
          <select
            value={entityFilter}
            onChange={(e) => {
              setEntityFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All Types</option>
            {entityTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="filter-group">
          <label>Search</label>
          <input
            type="text"
            placeholder="Username, action..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <button className="btn btn-secondary" onClick={handleReset}>
          <i className="bi bi-arrow-clockwise"></i> Reset
        </button>
      </div>

      {loading ? (
        <TableSkeleton rows={10} columns={7} />
      ) : (
        <DataTable
          columns={columns}
          data={entries}
          defaultSortKey="created_at"
          defaultSortDir="desc"
          pageSize={pageSize}
          emptyIcon="bi-inbox"
          emptyMessage="No audit log entries found"
        />
      )}
    </div>
  );
}

export default AuditLog;
