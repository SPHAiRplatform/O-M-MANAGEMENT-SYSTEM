import React, { useState, useMemo, useCallback } from 'react';
import './DataTable.css';

/**
 * Reusable DataTable component with client-side pagination and sorting.
 *
 * Props:
 *   columns        - Array of { key, label, sortable (bool), render (optional fn(value, row)) }
 *   data           - Array of row objects
 *   defaultSortKey - Initial sort column key
 *   defaultSortDir - 'asc' or 'desc' (default 'asc')
 *   pageSize       - Items per page (default 10)
 *   emptyIcon      - Bootstrap Icon class for empty state (default 'bi-inbox')
 *   emptyMessage   - Message when no data (default 'No data available')
 *   onRowClick     - Optional callback (row) => void
 */
function DataTable({
  columns = [],
  data = [],
  defaultSortKey = '',
  defaultSortDir = 'asc',
  pageSize: initialPageSize = 10,
  emptyIcon = 'bi-inbox',
  emptyMessage = 'No data available',
  onRowClick
}) {
  const [sortKey, setSortKey] = useState(defaultSortKey);
  const [sortDir, setSortDir] = useState(defaultSortDir);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);

  // Sort data
  const sortedData = useMemo(() => {
    if (!sortKey) return data;

    const sorted = [...data].sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];

      // Handle nulls / undefined
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;

      // Numeric comparison
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
      }

      // Boolean comparison
      if (typeof aVal === 'boolean' && typeof bVal === 'boolean') {
        return sortDir === 'asc'
          ? (aVal === bVal ? 0 : aVal ? -1 : 1)
          : (aVal === bVal ? 0 : aVal ? 1 : -1);
      }

      // String comparison (case insensitive)
      const aStr = String(aVal).toLowerCase();
      const bStr = String(bVal).toLowerCase();
      if (aStr < bStr) return sortDir === 'asc' ? -1 : 1;
      if (aStr > bStr) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    return sorted;
  }, [data, sortKey, sortDir]);

  // Pagination
  const totalItems = sortedData.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(currentPage, totalPages);

  const paginatedData = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return sortedData.slice(start, start + pageSize);
  }, [sortedData, safePage, pageSize]);

  const showingFrom = totalItems === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const showingTo = Math.min(safePage * pageSize, totalItems);

  // Handlers
  const handleSort = useCallback((key) => {
    if (key === sortKey) {
      setSortDir(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
    setCurrentPage(1);
  }, [sortKey]);

  const handlePageChange = useCallback((page) => {
    setCurrentPage(page);
  }, []);

  const handlePageSizeChange = useCallback((e) => {
    setPageSize(Number(e.target.value));
    setCurrentPage(1);
  }, []);

  // Build page number buttons with ellipsis
  const getPageNumbers = () => {
    const pages = [];
    const maxVisible = 5;

    if (totalPages <= maxVisible + 2) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      // Always show first page
      pages.push(1);

      let start = Math.max(2, safePage - 1);
      let end = Math.min(totalPages - 1, safePage + 1);

      // Adjust range if near the edges
      if (safePage <= 3) {
        end = Math.min(totalPages - 1, maxVisible);
      }
      if (safePage >= totalPages - 2) {
        start = Math.max(2, totalPages - maxVisible + 1);
      }

      if (start > 2) {
        pages.push('ellipsis-start');
      }

      for (let i = start; i <= end; i++) {
        pages.push(i);
      }

      if (end < totalPages - 1) {
        pages.push('ellipsis-end');
      }

      // Always show last page
      pages.push(totalPages);
    }

    return pages;
  };

  // Render sort icon
  const renderSortIcon = (col) => {
    if (!col.sortable) return null;
    if (sortKey === col.key) {
      return (
        <span className="sort-icon">
          <i className={sortDir === 'asc' ? 'bi bi-chevron-up' : 'bi bi-chevron-down'}></i>
        </span>
      );
    }
    return (
      <span className="sort-icon inactive">
        <i className="bi bi-chevron-expand"></i>
      </span>
    );
  };

  // Empty state
  if (totalItems === 0) {
    return (
      <div className="data-table-container">
        <div className="data-table-empty">
          <div className="empty-icon">
            <i className={`bi ${emptyIcon}`}></i>
          </div>
          <div className="empty-message">{emptyMessage}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="data-table-container">
      {/* Toolbar */}
      <div className="data-table-toolbar">
        <div className="data-table-page-size">
          <label htmlFor="dt-page-size">Show</label>
          <select
            id="dt-page-size"
            value={pageSize}
            onChange={handlePageSizeChange}
          >
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
          </select>
          <span>entries</span>
        </div>
        <div className="data-table-info">
          Showing {showingFrom}-{showingTo} of {totalItems}
        </div>
      </div>

      {/* Table */}
      <div className="data-table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              {columns.map(col => (
                <th
                  key={col.key}
                  className={col.sortable ? 'sortable' : ''}
                  onClick={col.sortable ? () => handleSort(col.key) : undefined}
                >
                  {col.label}
                  {renderSortIcon(col)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paginatedData.map((row, rowIdx) => (
              <tr
                key={row.id || rowIdx}
                className={onRowClick ? 'clickable' : ''}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {columns.map(col => (
                  <td key={col.key}>
                    {col.render ? col.render(row[col.key], row) : (row[col.key] ?? '-')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="data-table-pagination">
          <button
            onClick={() => handlePageChange(safePage - 1)}
            disabled={safePage === 1}
          >
            Previous
          </button>

          {getPageNumbers().map((page, idx) => {
            if (typeof page === 'string') {
              return (
                <span key={page} className="pagination-ellipsis">...</span>
              );
            }
            return (
              <button
                key={page}
                className={page === safePage ? 'active' : ''}
                onClick={() => handlePageChange(page)}
              >
                {page}
              </button>
            );
          })}

          <button
            onClick={() => handlePageChange(safePage + 1)}
            disabled={safePage >= totalPages}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

export default DataTable;
