import React, { useState, useEffect, useCallback } from 'react';
import { getApiBaseUrl } from '../api/api';
import { getErrorMessage } from '../utils/errorHandler';
import './ScadaDashboard.css';

function ScadaDashboard() {
  const [summary, setSummary] = useState(null);
  const [alarms, setAlarms] = useState([]);
  const [timeseries, setTimeseries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [timeRange, setTimeRange] = useState('24h');
  const [autoRefresh, setAutoRefresh] = useState(true);

  const loadData = useCallback(async () => {
    try {
      setError('');

      const [summaryRes, alarmsRes, timeseriesRes] = await Promise.all([
        fetch(`${getApiBaseUrl()}/scada/data/summary`, { credentials: 'include' }),
        fetch(`${getApiBaseUrl()}/scada/alarms?status=active&limit=20`, { credentials: 'include' }),
        fetch(`${getApiBaseUrl()}/scada/data/timeseries?type=power&range=${timeRange}`, { credentials: 'include' })
      ]);

      if (summaryRes.ok) {
        const summaryData = await summaryRes.json();
        setSummary(summaryData);
      }

      if (alarmsRes.ok) {
        const alarmsData = await alarmsRes.json();
        setAlarms(alarmsData);
      }

      if (timeseriesRes.ok) {
        const tsData = await timeseriesRes.json();
        setTimeseries(tsData);
      }

      setLoading(false);
    } catch (err) {
      console.error('Error loading SCADA data:', err);
      setError(getErrorMessage(err));
      setLoading(false);
    }
  }, [timeRange]);

  useEffect(() => {
    loadData();

    let interval;
    if (autoRefresh) {
      interval = setInterval(loadData, 60000); // Refresh every minute
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [loadData, autoRefresh]);

  const formatPower = (value) => {
    if (value === null || value === undefined) return '--';
    if (value >= 1000) return `${(value / 1000).toFixed(1)} MW`;
    return `${value.toFixed(1)} kW`;
  };

  const formatEnergy = (value) => {
    if (value === null || value === undefined) return '--';
    if (value >= 1000) return `${(value / 1000).toFixed(1)} MWh`;
    return `${value.toFixed(1)} kWh`;
  };

  const getSeverityClass = (severity) => {
    switch (severity) {
      case 'critical': return 'severity-critical';
      case 'warning': return 'severity-warning';
      default: return 'severity-info';
    }
  };

  const getSeverityIcon = (severity) => {
    switch (severity) {
      case 'critical': return 'bi-exclamation-octagon-fill';
      case 'warning': return 'bi-exclamation-triangle-fill';
      default: return 'bi-info-circle-fill';
    }
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

  const handleAcknowledgeAlarm = async (alarmId) => {
    try {
      const response = await fetch(`${getApiBaseUrl()}/scada/alarms/${alarmId}/acknowledge`, {
        method: 'POST',
        credentials: 'include'
      });
      if (response.ok) {
        loadData();
      }
    } catch (err) {
      console.error('Error acknowledging alarm:', err);
    }
  };

  // Compute simple chart data (bar chart using CSS)
  const maxPower = Math.max(...timeseries.map(d => d.value || 0), 1);

  if (loading) {
    return (
      <div className="scada-dashboard-container">
        <div className="scada-dash-header">
          <h1><i className="bi bi-broadcast"></i> Plant Performance</h1>
          <p className="scada-dash-subtitle">Real-time monitoring and performance data</p>
        </div>
        <div className="scada-kpi-grid">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="scada-kpi-card scada-skeleton-card"></div>
          ))}
        </div>
      </div>
    );
  }

  const hasData = summary && (summary.latestReadings?.length > 0 || summary.todayEnergy !== undefined);

  return (
    <div className="scada-dashboard-container">
      <div className="scada-dash-header">
        <div className="header-left">
          <h1><i className="bi bi-broadcast"></i> Plant Performance</h1>
          <p className="scada-dash-subtitle">Real-time monitoring and performance data</p>
        </div>
        <div className="header-controls">
          <label className="auto-refresh-toggle">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            <span>Auto-refresh</span>
          </label>
          <button className="btn btn-secondary btn-sm" onClick={loadData}>
            <i className="bi bi-arrow-clockwise"></i> Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="scada-alert scada-alert-error">
          <i className="bi bi-exclamation-triangle"></i>
          <span>{error}</span>
        </div>
      )}

      {!hasData ? (
        <div className="scada-no-data">
          <i className="bi bi-broadcast"></i>
          <h3>No SCADA Data Available</h3>
          <p>SCADA data will appear here once connections are configured and syncing. Contact your system administrator to set up SCADA integration.</p>
        </div>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="scada-kpi-grid">
            <div className="scada-kpi-card kpi-power">
              <div className="kpi-icon"><i className="bi bi-lightning-charge-fill"></i></div>
              <div className="kpi-content">
                <span className="kpi-label">Current Power</span>
                <span className="kpi-value">{formatPower(getLatestValue(summary, 'power'))}</span>
              </div>
            </div>

            <div className="scada-kpi-card kpi-energy">
              <div className="kpi-icon"><i className="bi bi-sun-fill"></i></div>
              <div className="kpi-content">
                <span className="kpi-label">Today's Yield</span>
                <span className="kpi-value">{formatEnergy(summary.todayEnergy)}</span>
              </div>
            </div>

            <div className="scada-kpi-card kpi-availability">
              <div className="kpi-icon"><i className="bi bi-check-circle-fill"></i></div>
              <div className="kpi-content">
                <span className="kpi-label">Plant Availability</span>
                <span className="kpi-value">
                  {summary.inverters
                    ? `${Math.round((summary.inverters.filter(i => i.status === 'online').length / summary.inverters.length) * 100)}%`
                    : '--'}
                </span>
              </div>
            </div>

            <div className="scada-kpi-card kpi-alarms">
              <div className="kpi-icon"><i className="bi bi-bell-fill"></i></div>
              <div className="kpi-content">
                <span className="kpi-label">Active Alarms</span>
                <span className="kpi-value">{summary.alarms?.active || 0}</span>
              </div>
              {(summary.alarms?.critical || 0) > 0 && (
                <span className="kpi-tag kpi-tag-critical">{summary.alarms.critical} critical</span>
              )}
            </div>
          </div>

          {/* Two-Column: Chart + Inverters */}
          <div className="scada-main-grid">
            {/* Power Output Chart */}
            <div className="scada-chart-card">
              <div className="chart-header">
                <h2>Power Output</h2>
                <div className="chart-range-selector">
                  {['24h', '7d', '30d'].map(range => (
                    <button
                      key={range}
                      className={`range-btn ${timeRange === range ? 'active' : ''}`}
                      onClick={() => setTimeRange(range)}
                    >
                      {range}
                    </button>
                  ))}
                </div>
              </div>

              {timeseries.length > 0 ? (
                <div className="simple-bar-chart">
                  <div className="chart-bars">
                    {timeseries.slice(-48).map((point, index) => (
                      <div
                        key={index}
                        className="chart-bar-wrapper"
                        title={`${new Date(point.timestamp).toLocaleString()}: ${formatPower(point.value)}`}
                      >
                        <div
                          className="chart-bar"
                          style={{ height: `${(point.value / maxPower) * 100}%` }}
                        ></div>
                      </div>
                    ))}
                  </div>
                  <div className="chart-x-axis">
                    <span>{timeseries.length > 0 ? new Date(timeseries[0].timestamp).toLocaleDateString() : ''}</span>
                    <span>Now</span>
                  </div>
                </div>
              ) : (
                <div className="chart-empty">
                  <i className="bi bi-bar-chart"></i>
                  <p>No time-series data available for this range</p>
                </div>
              )}
            </div>

            {/* Inverter Status Grid */}
            <div className="scada-inverters-card">
              <h2>Inverter Status</h2>
              {summary.inverters && summary.inverters.length > 0 ? (
                <div className="inverter-grid">
                  {summary.inverters.map((inv, index) => (
                    <div
                      key={index}
                      className={`inverter-item inverter-${inv.status || 'unknown'}`}
                      title={`${inv.device_id}: ${inv.status} - ${formatPower(inv.value)}`}
                    >
                      <i className="bi bi-cpu"></i>
                      <span className="inverter-id">{inv.device_id || `INV-${index + 1}`}</span>
                      <span className="inverter-power">{formatPower(inv.value)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="inverter-empty">
                  <i className="bi bi-cpu"></i>
                  <p>No inverter data</p>
                </div>
              )}

              <div className="inverter-legend">
                <span className="legend-item"><span className="legend-dot dot-online"></span> Online</span>
                <span className="legend-item"><span className="legend-dot dot-warning"></span> Warning</span>
                <span className="legend-item"><span className="legend-dot dot-offline"></span> Offline</span>
              </div>
            </div>
          </div>

          {/* Active Alarms */}
          <div className="scada-alarms-card">
            <div className="alarms-header">
              <h2><i className="bi bi-bell"></i> Active Alarms</h2>
              <span className="alarm-count">{alarms.length} active</span>
            </div>

            {alarms.length === 0 ? (
              <div className="alarms-empty">
                <i className="bi bi-check-circle"></i>
                <p>No active alarms — all systems nominal</p>
              </div>
            ) : (
              <div className="alarms-list">
                {alarms.map(alarm => (
                  <div key={alarm.id} className={`alarm-item ${getSeverityClass(alarm.severity)}`}>
                    <div className="alarm-severity-icon">
                      <i className={`bi ${getSeverityIcon(alarm.severity)}`}></i>
                    </div>
                    <div className="alarm-content">
                      <div className="alarm-message">{alarm.message}</div>
                      <div className="alarm-meta">
                        {alarm.device_name && <span className="alarm-device">{alarm.device_name}</span>}
                        <span className="alarm-time">{getTimeAgo(alarm.occurred_at)}</span>
                        {alarm.alarm_code && <span className="alarm-code">{alarm.alarm_code}</span>}
                      </div>
                    </div>
                    <button
                      className="btn btn-sm btn-outline"
                      onClick={() => handleAcknowledgeAlarm(alarm.id)}
                      title="Acknowledge alarm"
                    >
                      <i className="bi bi-check-lg"></i> Ack
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function getLatestValue(summary, type) {
  if (!summary?.latestReadings) return null;
  const reading = summary.latestReadings.find(r => r.data_type === type);
  return reading ? parseFloat(reading.value) : null;
}

export default ScadaDashboard;
