import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ErrorAlert, SuccessAlert } from './ErrorAlert';
import './SitemapBuilder.css';

// Cabinet mapping (same as Plant.js)
const getCorrectCabinet = (trackerId) => {
  if (!trackerId.startsWith('M')) return '';
  const num = parseInt(trackerId.substring(1), 10);
  if (isNaN(num) || num < 1 || num > 99) return '';
  if (num >= 93) return 'CT24';
  return `CT${Math.ceil(num / 4).toString().padStart(2, '0')}`;
};

// Max undo history size
const MAX_HISTORY = 50;

// Memoized builder block
const BuilderBlock = React.memo(({ block, blockSize, isSelected, isDragging, onMouseDown, onClick, onCtrlClick }) => {
  const x = block.col * blockSize;
  const y = block.row * blockSize;
  const isSiteOffice = block.id.startsWith('SITE_OFFICE');
  const fontSize = Math.max(5, blockSize * 0.25);

  return (
    <div
      onMouseDown={onMouseDown}
      onTouchStart={onMouseDown}
      onClick={(e) => { if (e.ctrlKey || e.metaKey) { e.stopPropagation(); onCtrlClick(e); } else { onClick(e); } }}
      className={`builder-block${isSelected ? ' selected' : ''}${isDragging ? ' dragging' : ''}`}
      style={{
        left: x,
        top: y,
        width: blockSize,
        height: blockSize,
        backgroundColor: isSiteOffice ? '#4169E1' : '#ffffff',
        border: isSelected ? '2px solid #007bff' : '1px solid #333',
        color: isSiteOffice ? '#fff' : '#000',
        zIndex: isSelected ? 10 : 1,
        fontSize: `${fontSize}px`
      }}
      title={`${block.label}${block.cabinet ? ' - ' + block.cabinet : ''} (col: ${block.col}, row: ${block.row})`}
    >
      <div style={{ fontWeight: 'bold', lineHeight: 1.1 }}>{block.label}</div>
      {block.sublabel && <div style={{ lineHeight: 1, fontSize: `${fontSize * 0.8}px` }}>{block.sublabel}</div>}
      {block.cabinet && <div style={{ color: isSiteOffice ? '#ccc' : '#555', lineHeight: 1, fontSize: `${fontSize * 0.8}px` }}>{block.cabinet}</div>}
    </div>
  );
});

BuilderBlock.displayName = 'BuilderBlock';

function SitemapBuilder({ initialTrackers, initialLabels, onSave, onExit }) {
  const [blocks, setBlocks] = useState([]);
  const [selectedBlockIds, setSelectedBlockIds] = useState([]);
  const [blockSize, setBlockSize] = useState(28);
  const [gridCols, setGridCols] = useState(60);
  const [gridRows, setGridRows] = useState(30);
  const [draggingId, setDraggingId] = useState(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [saving, setSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [zoom, setZoom] = useState(1);
  // Custom terminology labels
  const [labels, setLabels] = useState({
    trackerName: initialLabels?.trackerName || 'Trackers',
    cycleName: initialLabels?.cycleName || 'Cycle'
  });

  // Undo/Redo history
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const isUndoRedoAction = useRef(false);

  // Clipboard for copy/cut/paste
  const clipboard = useRef([]);

  const gridRef = useRef(null);
  const scrollRef = useRef(null);

  // Initialize blocks from props
  useEffect(() => {
    if (initialTrackers && initialTrackers.length > 0) {
      const initial = initialTrackers.map(t => ({ ...t }));
      setBlocks(initial);
      // Seed history with initial state
      setHistory([JSON.stringify(initial)]);
      setHistoryIndex(0);
      // Auto-size grid to fit existing blocks + padding
      const maxCol = Math.max(...initialTrackers.map(t => t.col || 0));
      const maxRow = Math.max(...initialTrackers.map(t => t.row || 0));
      setGridCols(Math.max(60, Math.ceil(maxCol) + 10));
      setGridRows(Math.max(30, Math.ceil(maxRow) + 10));
    }
  }, [initialTrackers]);

  // Push to undo history whenever blocks change (except during undo/redo)
  useEffect(() => {
    if (isUndoRedoAction.current) {
      isUndoRedoAction.current = false;
      return;
    }
    if (blocks.length === 0 && historyIndex === -1) return; // Skip initial empty state
    const snapshot = JSON.stringify(blocks);
    // Avoid duplicate consecutive snapshots
    if (history[historyIndex] === snapshot) return;

    setHistory(prev => {
      const trimmed = prev.slice(0, historyIndex + 1);
      const next = [...trimmed, snapshot];
      if (next.length > MAX_HISTORY) next.shift();
      return next;
    });
    setHistoryIndex(prev => {
      const newIdx = Math.min(prev + 1, MAX_HISTORY - 1);
      return newIdx;
    });
  }, [blocks]); // intentionally only depend on blocks

  // Undo
  const undo = useCallback(() => {
    if (historyIndex <= 0) return;
    isUndoRedoAction.current = true;
    const newIndex = historyIndex - 1;
    setHistoryIndex(newIndex);
    setBlocks(JSON.parse(history[newIndex]));
    setHasUnsavedChanges(true);
  }, [historyIndex, history]);

  // Redo
  const redo = useCallback(() => {
    if (historyIndex >= history.length - 1) return;
    isUndoRedoAction.current = true;
    const newIndex = historyIndex + 1;
    setHistoryIndex(newIndex);
    setBlocks(JSON.parse(history[newIndex]));
    setHasUnsavedChanges(true);
  }, [historyIndex, history]);

  // Unsaved changes warning
  useEffect(() => {
    const handler = (e) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasUnsavedChanges]);

  // Get selected block data (for property panel - show first selected)
  const selectedBlockId = selectedBlockIds.length === 1 ? selectedBlockIds[0] : null;
  const selectedBlock = selectedBlockId ? blocks.find(b => b.id === selectedBlockId) : null;

  // Generate a unique tracker ID
  const getNextTrackerId = useCallback((currentBlocks) => {
    const existingNums = currentBlocks
      .map(b => b.id)
      .filter(id => /^M\d+$/.test(id))
      .map(id => parseInt(id.substring(1), 10));
    let nextNum = 1;
    while (existingNums.includes(nextNum) && nextNum <= 99) nextNum++;
    if (nextNum > 99) return null;
    return `M${String(nextNum).padStart(2, '0')}`;
  }, []);

  // Generate a unique site office ID
  const getNextSiteOfficeId = useCallback((currentBlocks) => {
    const existingOffices = currentBlocks.filter(b => b.id.startsWith('SITE_OFFICE'));
    if (existingOffices.length === 0) return 'SITE_OFFICE';
    let num = 2;
    while (currentBlocks.some(b => b.id === `SITE_OFFICE_${num}`)) num++;
    return `SITE_OFFICE_${num}`;
  }, []);

  // Add a new tracker block
  const addBlock = useCallback(() => {
    const id = getNextTrackerId(blocks);
    if (!id) {
      setError('Maximum 99 tracker blocks (M01-M99) reached');
      return;
    }

    const scrollEl = scrollRef.current;
    let centerCol = Math.floor(gridCols / 2);
    let centerRow = Math.floor(gridRows / 2);
    if (scrollEl) {
      centerCol = Math.floor((scrollEl.scrollLeft + scrollEl.clientWidth / 2) / blockSize);
      centerRow = Math.floor((scrollEl.scrollTop + scrollEl.clientHeight / 2) / blockSize);
    }

    const newBlock = {
      id,
      col: centerCol,
      row: centerRow,
      label: id,
      sublabel: '',
      cabinet: getCorrectCabinet(id),
      color: '#ffffff',
      grassCuttingColor: '#ffffff',
      panelWashColor: '#ffffff'
    };

    setBlocks(prev => [...prev, newBlock]);
    setSelectedBlockIds([id]);
    setHasUnsavedChanges(true);
  }, [blocks, gridCols, gridRows, blockSize, getNextTrackerId]);

  // Add site office block (supports multiple)
  const addSiteOffice = useCallback(() => {
    const id = getNextSiteOfficeId(blocks);

    const scrollEl = scrollRef.current;
    let centerCol = 1;
    let centerRow = 1;
    if (scrollEl) {
      centerCol = Math.floor((scrollEl.scrollLeft + scrollEl.clientWidth / 2) / blockSize);
      centerRow = Math.floor((scrollEl.scrollTop + scrollEl.clientHeight / 2) / blockSize);
    }

    const newBlock = {
      id,
      col: centerCol,
      row: centerRow,
      label: 'OFFICE',
      sublabel: 'SITE',
      cabinet: '',
      color: '#4169E1',
      grassCuttingColor: '#4169E1',
      panelWashColor: '#4169E1'
    };

    setBlocks(prev => [...prev, newBlock]);
    setSelectedBlockIds([id]);
    setHasUnsavedChanges(true);
  }, [blocks, blockSize, getNextSiteOfficeId]);

  // Delete selected block(s)
  const deleteBlock = useCallback(() => {
    if (selectedBlockIds.length === 0) return;
    setBlocks(prev => prev.filter(b => !selectedBlockIds.includes(b.id)));
    setSelectedBlockIds([]);
    setHasUnsavedChanges(true);
  }, [selectedBlockIds]);

  // Copy selected blocks to clipboard
  const copyBlocks = useCallback(() => {
    if (selectedBlockIds.length === 0) return;
    const selected = blocks.filter(b => selectedBlockIds.includes(b.id));
    clipboard.current = selected.map(b => ({ ...b }));
  }, [selectedBlockIds, blocks]);

  // Cut selected blocks (copy + delete)
  const cutBlocks = useCallback(() => {
    if (selectedBlockIds.length === 0) return;
    copyBlocks();
    deleteBlock();
  }, [selectedBlockIds, copyBlocks, deleteBlock]);

  // Paste blocks from clipboard
  const pasteBlocks = useCallback(() => {
    if (clipboard.current.length === 0) return;

    const newBlocks = [];
    const newIds = [];
    let currentBlocksList = [...blocks];

    for (const src of clipboard.current) {
      let newId;
      if (src.id.startsWith('SITE_OFFICE')) {
        newId = getNextSiteOfficeId(currentBlocksList);
      } else {
        newId = getNextTrackerId(currentBlocksList);
        if (!newId) continue; // Skip if max reached
      }
      const newBlock = {
        ...src,
        id: newId,
        label: src.id.startsWith('SITE_OFFICE') ? src.label : newId,
        cabinet: src.id.startsWith('SITE_OFFICE') ? '' : getCorrectCabinet(newId),
        col: Math.round((src.col + 1) * 5) / 5, // Offset by 1 cell
        row: Math.round((src.row + 1) * 5) / 5
      };
      newBlocks.push(newBlock);
      newIds.push(newId);
      currentBlocksList.push(newBlock);
    }

    if (newBlocks.length > 0) {
      setBlocks(prev => [...prev, ...newBlocks]);
      setSelectedBlockIds(newIds);
      setHasUnsavedChanges(true);
    }
  }, [blocks, getNextTrackerId, getNextSiteOfficeId]);

  // Duplicate selected blocks (copy + paste in one step)
  const duplicateBlocks = useCallback(() => {
    copyBlocks();
    // Use setTimeout to ensure clipboard is set before paste
    setTimeout(() => pasteBlocks(), 0);
  }, [copyBlocks, pasteBlocks]);

  // Alignment functions for multi-selected blocks
  const alignBlocks = useCallback((alignment) => {
    if (selectedBlockIds.length < 2) return;
    const selected = blocks.filter(b => selectedBlockIds.includes(b.id));

    let targetValue;
    switch (alignment) {
      case 'left':
        targetValue = Math.min(...selected.map(b => b.col));
        setBlocks(prev => prev.map(b =>
          selectedBlockIds.includes(b.id) ? { ...b, col: targetValue } : b
        ));
        break;
      case 'right':
        targetValue = Math.max(...selected.map(b => b.col));
        setBlocks(prev => prev.map(b =>
          selectedBlockIds.includes(b.id) ? { ...b, col: targetValue } : b
        ));
        break;
      case 'top':
        targetValue = Math.min(...selected.map(b => b.row));
        setBlocks(prev => prev.map(b =>
          selectedBlockIds.includes(b.id) ? { ...b, row: targetValue } : b
        ));
        break;
      case 'bottom':
        targetValue = Math.max(...selected.map(b => b.row));
        setBlocks(prev => prev.map(b =>
          selectedBlockIds.includes(b.id) ? { ...b, row: targetValue } : b
        ));
        break;
      case 'distribute-h': {
        const sorted = [...selected].sort((a, b) => a.col - b.col);
        if (sorted.length < 3) return;
        const minCol = sorted[0].col;
        const maxCol = sorted[sorted.length - 1].col;
        const step = (maxCol - minCol) / (sorted.length - 1);
        const idToCol = {};
        sorted.forEach((b, i) => { idToCol[b.id] = Math.round((minCol + i * step) * 5) / 5; });
        setBlocks(prev => prev.map(b =>
          idToCol[b.id] !== undefined ? { ...b, col: idToCol[b.id] } : b
        ));
        break;
      }
      case 'distribute-v': {
        const sorted = [...selected].sort((a, b) => a.row - b.row);
        if (sorted.length < 3) return;
        const minRow = sorted[0].row;
        const maxRow = sorted[sorted.length - 1].row;
        const step = (maxRow - minRow) / (sorted.length - 1);
        const idToRow = {};
        sorted.forEach((b, i) => { idToRow[b.id] = Math.round((minRow + i * step) * 5) / 5; });
        setBlocks(prev => prev.map(b =>
          idToRow[b.id] !== undefined ? { ...b, row: idToRow[b.id] } : b
        ));
        break;
      }
      default: return;
    }
    setHasUnsavedChanges(true);
  }, [selectedBlockIds, blocks]);

  // Update block property (for property panel - single selection only)
  const updateBlockProperty = useCallback((prop, value) => {
    if (selectedBlockIds.length !== 1) return;
    const id = selectedBlockIds[0];
    setBlocks(prev => prev.map(b =>
      b.id === id ? { ...b, [prop]: value } : b
    ));
    setHasUnsavedChanges(true);
  }, [selectedBlockIds]);

  // Get mouse/touch position relative to grid (accounting for zoom)
  const getGridPosition = useCallback((e) => {
    if (!gridRef.current) return { x: 0, y: 0 };
    const rect = gridRef.current.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: (clientX - rect.left) / zoom,
      y: (clientY - rect.top) / zoom
    };
  }, [zoom]);

  // Mouse wheel zoom
  const handleWheel = useCallback((e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setZoom(prev => {
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        return Math.max(0.25, Math.min(3, Math.round((prev + delta) * 100) / 100));
      });
    }
  }, []);

  // Drag start
  const handleBlockMouseDown = useCallback((e, blockId) => {
    if (e.ctrlKey || e.metaKey) return; // Ctrl+click is for multi-select, not drag
    e.preventDefault();
    e.stopPropagation();
    const block = blocks.find(b => b.id === blockId);
    if (!block) return;

    const pos = getGridPosition(e);
    const blockX = block.col * blockSize;
    const blockY = block.row * blockSize;

    setDragOffset({ x: pos.x - blockX, y: pos.y - blockY });
    setDraggingId(blockId);
    // If dragging a block that's part of a multi-selection, keep the selection
    if (!selectedBlockIds.includes(blockId)) {
      setSelectedBlockIds([blockId]);
    }
  }, [blocks, blockSize, getGridPosition, selectedBlockIds]);

  // Drag move
  const handleGridMouseMove = useCallback((e) => {
    if (!draggingId) return;
    e.preventDefault();

    const pos = getGridPosition(e);
    const snapUnit = blockSize / 5; // Snap to subdivision lines
    const rawCol = (pos.x - dragOffset.x) / snapUnit;
    const rawRow = (pos.y - dragOffset.y) / snapUnit;
    const newCol = Math.max(0, Math.min(gridCols * 5 - 5, Math.round(rawCol))) / 5;
    const newRow = Math.max(0, Math.min(gridRows * 5 - 5, Math.round(rawRow))) / 5;

    setBlocks(prev => {
      const dragBlock = prev.find(b => b.id === draggingId);
      if (!dragBlock) return prev;
      const deltaCol = newCol - dragBlock.col;
      const deltaRow = newRow - dragBlock.row;
      if (deltaCol === 0 && deltaRow === 0) return prev;

      // If dragging block is part of multi-selection, move all selected
      const idsToMove = selectedBlockIds.includes(draggingId) ? selectedBlockIds : [draggingId];
      return prev.map(b => {
        if (idsToMove.includes(b.id)) {
          return {
            ...b,
            col: Math.max(0, Math.min(gridCols - 1, b.col + deltaCol)),
            row: Math.max(0, Math.min(gridRows - 1, b.row + deltaRow))
          };
        }
        return b;
      });
    });
  }, [draggingId, dragOffset, blockSize, gridCols, gridRows, getGridPosition, selectedBlockIds]);

  // Drag end
  const handleGridMouseUp = useCallback(() => {
    if (draggingId) {
      setDraggingId(null);
      setHasUnsavedChanges(true);
    }
  }, [draggingId]);

  // Click on empty grid space to deselect all
  const handleGridClick = useCallback((e) => {
    if (e.target === gridRef.current) {
      setSelectedBlockIds([]);
    }
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Don't intercept if user is typing in an input/select
      const isInput = e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA';

      // Ctrl/Cmd shortcuts that work even without selection
      if (e.ctrlKey || e.metaKey) {
        switch (e.key) {
          case 'z':
            if (isInput) return;
            e.preventDefault();
            if (e.shiftKey) { redo(); } else { undo(); }
            return;
          case 'y':
            if (isInput) return;
            e.preventDefault();
            redo();
            return;
          case 's':
            e.preventDefault();
            if (hasUnsavedChanges && !saving) handleSaveRef.current();
            return;
          case 'a':
            if (isInput) return;
            e.preventDefault();
            setSelectedBlockIds(blocks.map(b => b.id));
            return;
          case 'c':
            if (isInput) return;
            e.preventDefault();
            copyBlocks();
            return;
          case 'x':
            if (isInput) return;
            e.preventDefault();
            cutBlocks();
            return;
          case 'v':
            if (isInput) return;
            e.preventDefault();
            pasteBlocks();
            return;
          case 'd':
            if (isInput) return;
            e.preventDefault();
            duplicateBlocks();
            return;
          default: break;
        }
      }

      if (selectedBlockIds.length === 0) return;
      if (isInput) return;

      const step = 1 / 5; // One sub-grid unit
      let deltaCol = 0;
      let deltaRow = 0;

      switch (e.key) {
        case 'ArrowLeft':  deltaCol = -step; break;
        case 'ArrowRight': deltaCol = step; break;
        case 'ArrowUp':    deltaRow = -step; break;
        case 'ArrowDown':  deltaRow = step; break;
        case 'Delete':
        case 'Backspace':
          e.preventDefault();
          deleteBlock();
          return;
        case 'Escape':
          setSelectedBlockIds([]);
          return;
        default: return;
      }

      e.preventDefault();
      // Shift+arrow = move by full grid cell instead of sub-grid
      if (e.shiftKey) {
        deltaCol *= 5;
        deltaRow *= 5;
      }

      setBlocks(prev => prev.map(b => {
        if (!selectedBlockIds.includes(b.id)) return b;
        return {
          ...b,
          col: Math.max(0, Math.min(gridCols - 1, Math.round((b.col + deltaCol) * 5) / 5)),
          row: Math.max(0, Math.min(gridRows - 1, Math.round((b.row + deltaRow) * 5) / 5))
        };
      }));
      setHasUnsavedChanges(true);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedBlockIds, blocks, gridCols, gridRows, deleteBlock, undo, redo, copyBlocks, cutBlocks, pasteBlocks, duplicateBlocks, hasUnsavedChanges, saving]);

  // Ctrl+click to toggle block in multi-selection
  const handleCtrlClick = useCallback((blockId) => {
    setSelectedBlockIds(prev =>
      prev.includes(blockId)
        ? prev.filter(id => id !== blockId)
        : [...prev, blockId]
    );
  }, []);

  // Save map (use ref so keyboard shortcut always has latest)
  const handleSaveRef = useRef(null);
  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      await onSave(blocks, labels);
      setHasUnsavedChanges(false);
      setSuccess('Sitemap saved successfully');
    } catch (err) {
      setError('Failed to save: ' + (err.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };
  handleSaveRef.current = handleSave;

  // Exit builder
  const handleExit = () => {
    if (hasUnsavedChanges) {
      if (!window.confirm('You have unsaved changes. Exit without saving?')) return;
    }
    onExit();
  };

  // Grid background style with major gridlines + 4 subdivision lines per cell
  const subSize = blockSize / 5;
  const gridStyle = {
    width: gridCols * blockSize,
    height: gridRows * blockSize,
    backgroundSize: `${blockSize}px ${blockSize}px, ${blockSize}px ${blockSize}px, ${subSize}px ${subSize}px, ${subSize}px ${subSize}px`,
    backgroundImage: `
      linear-gradient(to right, rgba(0, 0, 0, 0.18) 1px, transparent 1px),
      linear-gradient(to bottom, rgba(0, 0, 0, 0.18) 1px, transparent 1px),
      linear-gradient(to right, rgba(0, 0, 0, 0.06) 1px, transparent 1px),
      linear-gradient(to bottom, rgba(0, 0, 0, 0.06) 1px, transparent 1px)
    `,
    transform: `scale(${zoom})`,
    transformOrigin: 'top left'
  };

  const trackerCount = blocks.filter(b => !b.id.startsWith('SITE_OFFICE')).length;
  const siteOfficeCount = blocks.filter(b => b.id.startsWith('SITE_OFFICE')).length;
  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < history.length - 1;

  return (
    <div className="sitemap-builder" tabIndex={-1}>
      <ErrorAlert message={error} onClose={() => setError(null)} />
      <SuccessAlert message={success} onClose={() => setSuccess(null)} />

      {/* Toolbar */}
      <div className="builder-toolbar">
        <button className="btn btn-sm btn-primary" onClick={addBlock} disabled={trackerCount >= 99} title="Add a new tracker block">
          + Tracker
        </button>
        <button className="btn btn-sm btn-secondary" onClick={addSiteOffice} title="Add a site office block">
          + Office
        </button>

        <div className="builder-toolbar-divider" />

        {/* Undo / Redo */}
        <button className="btn btn-sm btn-secondary" onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)" style={{ minWidth: '32px' }}>
          &#x21A9;
        </button>
        <button className="btn btn-sm btn-secondary" onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Y)" style={{ minWidth: '32px' }}>
          &#x21AA;
        </button>

        <div className="builder-toolbar-divider" />

        {/* Clipboard */}
        <button className="btn btn-sm btn-secondary" onClick={copyBlocks} disabled={selectedBlockIds.length === 0} title="Copy (Ctrl+C)">
          Copy
        </button>
        <button className="btn btn-sm btn-secondary" onClick={cutBlocks} disabled={selectedBlockIds.length === 0} title="Cut (Ctrl+X)">
          Cut
        </button>
        <button className="btn btn-sm btn-secondary" onClick={pasteBlocks} disabled={clipboard.current.length === 0} title="Paste (Ctrl+V)">
          Paste
        </button>
        <button className="btn btn-sm btn-secondary" onClick={duplicateBlocks} disabled={selectedBlockIds.length === 0} title="Duplicate (Ctrl+D)">
          Duplicate
        </button>

        <div className="builder-toolbar-divider" />

        <button className="btn btn-sm btn-danger" onClick={deleteBlock} disabled={selectedBlockIds.length === 0} title="Delete selected (Del)">
          Delete
        </button>

        <div className="builder-toolbar-divider" />

        <label>Block:</label>
        <select value={blockSize} onChange={e => setBlockSize(Number(e.target.value))}>
          <option value={20}>20px</option>
          <option value={28}>28px</option>
          <option value={36}>36px</option>
          <option value={48}>48px</option>
          <option value={60}>60px</option>
        </select>

        <div className="builder-toolbar-divider" />

        <label>Grid:</label>
        <input
          type="number"
          value={gridCols}
          min={10}
          max={150}
          onChange={e => setGridCols(Math.max(10, Math.min(150, Number(e.target.value))))}
        />
        <span className="grid-size-label">x</span>
        <input
          type="number"
          value={gridRows}
          min={10}
          max={100}
          onChange={e => setGridRows(Math.max(10, Math.min(100, Number(e.target.value))))}
        />

        <div className="builder-toolbar-divider" />

        <label>Zoom:</label>
        <div className="zoom-controls">
          <button className="btn btn-xs btn-secondary" onClick={() => setZoom(prev => Math.max(0.25, Math.round((prev - 0.25) * 100) / 100))} title="Zoom out">
            <i className="bi bi-dash"></i>
          </button>
          <span className="zoom-level">{Math.round(zoom * 100)}%</span>
          <button className="btn btn-xs btn-secondary" onClick={() => setZoom(prev => Math.min(3, Math.round((prev + 0.25) * 100) / 100))} title="Zoom in">
            <i className="bi bi-plus"></i>
          </button>
          <button className="btn btn-xs btn-secondary" onClick={() => setZoom(1)} title="Reset zoom" style={{ marginLeft: '2px' }}>
            Fit
          </button>
        </div>

        <div className="builder-toolbar-divider" />

        <button className="btn btn-sm btn-primary" onClick={handleSave} disabled={saving || !hasUnsavedChanges} title="Save map (Ctrl+S)">
          {saving ? (<><span className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }}></span> Saving...</>) : 'Save'}
        </button>
        <button className="btn btn-sm btn-secondary" onClick={handleExit} title="Exit builder">
          Exit
        </button>

        {hasUnsavedChanges && <span className="unsaved-indicator">Unsaved changes</span>}
      </div>

      {/* Workspace: Grid + Property Panel */}
      <div className="builder-workspace">
        {/* Scrollable grid area */}
        <div className="builder-grid-scroll" ref={scrollRef} onWheel={handleWheel}>
          <div
            ref={gridRef}
            className="builder-grid"
            style={gridStyle}
            onMouseMove={handleGridMouseMove}
            onMouseUp={handleGridMouseUp}
            onMouseLeave={handleGridMouseUp}
            onTouchMove={handleGridMouseMove}
            onTouchEnd={handleGridMouseUp}
            onClick={handleGridClick}
          >
            {blocks.map(block => (
              <BuilderBlock
                key={block.id}
                block={block}
                blockSize={blockSize}
                isSelected={selectedBlockIds.includes(block.id)}
                isDragging={draggingId === block.id}
                onMouseDown={(e) => handleBlockMouseDown(e, block.id)}
                onClick={() => setSelectedBlockIds([block.id])}
                onCtrlClick={() => handleCtrlClick(block.id)}
              />
            ))}
          </div>
        </div>

        {/* Property Panel */}
        <div className="builder-property-panel">
          <h4>Block Properties</h4>
          {selectedBlockIds.length > 1 ? (
            <>
              <div className="property-field">
                <label>Selected</label>
                <div className="position-display">{selectedBlockIds.length} blocks</div>
              </div>

              {/* Alignment tools */}
              <div style={{ marginBottom: '10px' }}>
                <label style={{ fontSize: '11px', fontWeight: 600, marginBottom: '6px', display: 'block' }}>Align</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '4px' }}>
                  <button className="btn btn-xs btn-secondary" onClick={() => alignBlocks('left')} title="Align left">
                    Left
                  </button>
                  <button className="btn btn-xs btn-secondary" onClick={() => alignBlocks('top')} title="Align top">
                    Top
                  </button>
                  <button className="btn btn-xs btn-secondary" onClick={() => alignBlocks('right')} title="Align right">
                    Right
                  </button>
                  <button className="btn btn-xs btn-secondary" onClick={() => alignBlocks('bottom')} title="Align bottom">
                    Bottom
                  </button>
                  <button className="btn btn-xs btn-secondary" onClick={() => alignBlocks('distribute-h')} title="Distribute horizontally (3+ blocks)" disabled={selectedBlockIds.length < 3}>
                    Dist H
                  </button>
                  <button className="btn btn-xs btn-secondary" onClick={() => alignBlocks('distribute-v')} title="Distribute vertically (3+ blocks)" disabled={selectedBlockIds.length < 3}>
                    Dist V
                  </button>
                </div>
              </div>

              <div style={{ fontSize: '11px', color: '#666', marginBottom: '8px', lineHeight: 1.4 }}>
                Arrow keys to move. Shift+Arrow for larger steps. Delete to remove.
              </div>
              <div className="property-actions">
                <button className="btn btn-sm btn-danger" onClick={deleteBlock}>
                  Delete {selectedBlockIds.length} Blocks
                </button>
              </div>
            </>
          ) : selectedBlock ? (
            <>
              <div className="property-field">
                <label>ID</label>
                <input value={selectedBlock.id} disabled />
              </div>
              <div className="property-field">
                <label>Label</label>
                <input
                  value={selectedBlock.label}
                  onChange={e => updateBlockProperty('label', e.target.value)}
                  placeholder="Block label"
                />
              </div>
              <div className="property-field">
                <label>Sublabel</label>
                <input
                  value={selectedBlock.sublabel || ''}
                  onChange={e => updateBlockProperty('sublabel', e.target.value)}
                  placeholder="Optional sublabel"
                />
              </div>
              <div className="property-field">
                <label>Cabinet</label>
                <input
                  value={selectedBlock.cabinet || ''}
                  onChange={e => updateBlockProperty('cabinet', e.target.value)}
                  placeholder="e.g. CT01"
                />
              </div>
              <div className="property-field">
                <label>Position</label>
                <div className="position-display">
                  Col: {selectedBlock.col} &nbsp; Row: {selectedBlock.row}
                </div>
              </div>
              <div className="property-actions">
                <button className="btn btn-sm btn-danger" onClick={deleteBlock}>
                  Delete Block
                </button>
              </div>
            </>
          ) : (
            <div className="property-empty">
              Click a block to edit its properties, or drag to reposition.
            </div>
          )}

          {/* Keyboard shortcuts reference */}
          <div className="builder-shortcuts-section">
            <h4>Shortcuts</h4>
            <div style={{ fontSize: '11px', color: '#666', lineHeight: 1.8 }}>
              <div><kbd>Ctrl+Z</kbd> Undo</div>
              <div><kbd>Ctrl+Y</kbd> Redo</div>
              <div><kbd>Ctrl+C</kbd> Copy</div>
              <div><kbd>Ctrl+X</kbd> Cut</div>
              <div><kbd>Ctrl+V</kbd> Paste</div>
              <div><kbd>Ctrl+D</kbd> Duplicate</div>
              <div><kbd>Ctrl+A</kbd> Select all</div>
              <div><kbd>Ctrl+S</kbd> Save</div>
              <div><kbd>Del</kbd> Delete selected</div>
              <div><kbd>Esc</kbd> Deselect</div>
              <div><kbd>Arrows</kbd> Move block</div>
              <div><kbd>Shift+Arrows</kbd> Move faster</div>
              <div><kbd>Ctrl+Click</kbd> Multi-select</div>
              <div><kbd>Ctrl+Scroll</kbd> Zoom</div>
            </div>
          </div>

          {/* Custom Terminology */}
          <div className="builder-labels-section">
            <h4>Terminology</h4>
            <p className="labels-hint">
              Customize the names displayed for this organization. Different companies may use different terms.
            </p>
            <div className="property-field">
              <label>Block Name</label>
              <input
                value={labels.trackerName}
                onChange={e => {
                  setLabels(prev => ({ ...prev, trackerName: e.target.value }));
                  setHasUnsavedChanges(true);
                }}
                placeholder="e.g. Trackers, Panels, Modules"
              />
            </div>
            <div className="property-field">
              <label>Cycle Name</label>
              <input
                value={labels.cycleName}
                onChange={e => {
                  setLabels(prev => ({ ...prev, cycleName: e.target.value }));
                  setHasUnsavedChanges(true);
                }}
                placeholder="e.g. Cycle, Round, Phase"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Footer stats */}
      <div className="builder-footer">
        <span>{trackerCount} {labels.trackerName.toLowerCase()}</span>
        <span>Grid: {gridCols} x {gridRows}</span>
        <span>Block: {blockSize}px</span>
        {siteOfficeCount > 0 && <span>{siteOfficeCount} office{siteOfficeCount > 1 ? 's' : ''}</span>}
        <span>Zoom: {Math.round(zoom * 100)}%</span>
        {selectedBlockIds.length > 0 && <span style={{ color: '#1A73E8', fontWeight: 500 }}>{selectedBlockIds.length} selected</span>}
        {canUndo && <span style={{ color: '#999', fontSize: '11px' }}>Undo available</span>}
      </div>
    </div>
  );
}

export default SitemapBuilder;
