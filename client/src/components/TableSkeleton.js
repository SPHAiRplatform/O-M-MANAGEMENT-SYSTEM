import React from 'react';
import './DataTable.css';

/**
 * TableSkeleton - renders a shimmer loading state for tables.
 *
 * Props:
 *   rows    - number of skeleton body rows (default 5)
 *   columns - number of columns (default 4)
 */
function TableSkeleton({ rows = 5, columns = 4 }) {
  const headerCells = Array.from({ length: columns }, (_, i) => i);
  const bodyRows = Array.from({ length: rows }, (_, i) => i);

  return (
    <div className="table-skeleton">
      {/* Header row */}
      <div className="skeleton-header skeleton-row">
        {headerCells.map(i => (
          <div key={`header-${i}`} className="skeleton-cell">
            <div className="skeleton-bar"></div>
          </div>
        ))}
      </div>

      {/* Body rows */}
      {bodyRows.map(rowIdx => (
        <div key={`row-${rowIdx}`} className="skeleton-row">
          {headerCells.map(colIdx => (
            <div key={`cell-${rowIdx}-${colIdx}`} className="skeleton-cell">
              <div className="skeleton-bar"></div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export default TableSkeleton;
