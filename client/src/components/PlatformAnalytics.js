import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getApiBaseUrl, authFetch } from '../api/api';
import { getErrorMessage } from '../utils/errorHandler';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Tooltip,
  Legend,
  Title
} from 'chart.js';
import { Line, Bar, Doughnut } from 'react-chartjs-2';
import './PlatformAnalytics.css';

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Tooltip,
  Legend,
  Title
);

function PlatformAnalytics() {
  const navigate = useNavigate();
  const { isSuperAdmin } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [analytics, setAnalytics] = useState(null);
  const [timeRange, setTimeRange] = useState('30d');
  const [performerSort, setPerformerSort] = useState({ key: 'overallScore', dir: 'desc' });

  useEffect(() => {
    if (!isSuperAdmin()) {
      setError('Access denied. System owner privileges required.');
      setLoading(false);
      return;
    }
    loadAnalytics();
  }, [isSuperAdmin, timeRange]);

  const loadAnalytics = async () => {
    try {
      setLoading(true);
      setError('');

      const response = await authFetch(`${getApiBaseUrl()}/platform/analytics?range=${timeRange}`);

      if (!response.ok) {
        throw new Error('Failed to load analytics');
      }

      const data = await response.json();
      setAnalytics(data);
      setLoading(false);
    } catch (error) {
      console.error('Error loading analytics:', error);
      setError('Failed to load analytics: ' + getErrorMessage(error));
      setLoading(false);
    }
  };

  const formatNumber = (num) => {
    return new Intl.NumberFormat().format(num);
  };

  const formatPercentage = (num) => {
    return `${num}%`;
  };

  // Chart.js options for consistent styling
  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top',
        labels: {
          font: {
            size: 12,
            family: 'Roboto, sans-serif'
          },
          padding: 15,
          usePointStyle: true
        }
      },
      tooltip: {
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        padding: 12,
        titleFont: {
          size: 14,
          weight: 'bold'
        },
        bodyFont: {
          size: 13
        },
        borderColor: 'rgba(255, 255, 255, 0.1)',
        borderWidth: 1,
        cornerRadius: 6
      }
    },
    scales: {
      y: {
        beginAtZero: true,
        grid: {
          color: 'rgba(0, 0, 0, 0.05)'
        },
        ticks: {
          font: {
            size: 11
          }
        }
      },
      x: {
        grid: {
          display: false
        },
        ticks: {
          font: {
            size: 11
          }
        }
      }
    }
  };

  // Task Activity Trend Chart (Line Chart)
  const getTaskActivityChartData = () => {
    if (!analytics?.activity || analytics.activity.length === 0) {
      return null;
    }

    const labels = analytics.activity.map(item => {
      const date = new Date(item.date);
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    });

    return {
      labels,
      datasets: [
        {
          label: 'Tasks Created',
          data: analytics.activity.map(item => item.tasksCreated || 0),
          borderColor: '#4285F4',
          backgroundColor: 'rgba(66, 133, 244, 0.1)',
          borderWidth: 2,
          fill: true,
          tension: 0.4,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: '#4285F4',
          pointBorderColor: '#fff',
          pointBorderWidth: 2
        },
        {
          label: 'Tasks Completed',
          data: analytics.activity.map(item => item.tasksCompleted || 0),
          borderColor: '#34A853',
          backgroundColor: 'rgba(52, 168, 83, 0.1)',
          borderWidth: 2,
          fill: true,
          tension: 0.4,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: '#34A853',
          pointBorderColor: '#fff',
          pointBorderWidth: 2
        }
      ]
    };
  };

  // Task Completion Rate Trend (Line Chart)
  const getCompletionRateChartData = () => {
    if (!analytics?.activity || analytics.activity.length === 0) {
      return null;
    }

    const labels = analytics.activity.map(item => {
      const date = new Date(item.date);
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    });

    const completionRates = analytics.activity.map(item => {
      const total = (item.tasksCreated || 0) + (item.tasksCompleted || 0);
      return total > 0 ? Math.round((item.tasksCompleted || 0) / total * 100) : 0;
    });

    return {
      labels,
      datasets: [
        {
          label: 'Completion Rate (%)',
          data: completionRates,
          borderColor: '#9C27B0',
          backgroundColor: 'rgba(156, 39, 176, 0.1)',
          borderWidth: 3,
          fill: true,
          tension: 0.4,
          pointRadius: 5,
          pointHoverRadius: 7,
          pointBackgroundColor: '#9C27B0',
          pointBorderColor: '#fff',
          pointBorderWidth: 2
        }
      ]
    };
  };

  // Organization Performance Comparison (Horizontal Bar Chart)
  const getOrganizationPerformanceChartData = () => {
    if (!analytics?.organizations || analytics.organizations.length === 0) {
      return null;
    }

    // Sort by completion rate and take top 10
    const sortedOrgs = [...analytics.organizations]
      .sort((a, b) => b.completion_rate - a.completion_rate)
      .slice(0, 10);

    return {
      labels: sortedOrgs.map(org => org.name.length > 20 ? org.name.substring(0, 20) + '...' : org.name),
      datasets: [
        {
          label: 'Completion Rate (%)',
          data: sortedOrgs.map(org => org.completion_rate),
          backgroundColor: sortedOrgs.map(org => {
            if (org.completion_rate >= 80) return '#4CAF50';
            if (org.completion_rate >= 50) return '#FF9800';
            return '#F44335';
          }),
          borderColor: '#fff',
          borderWidth: 2,
          borderRadius: 6
        }
      ]
    };
  };

  const orgPerformanceOptions = {
    ...chartOptions,
    indexAxis: 'y',
    plugins: {
      ...chartOptions.plugins,
      title: {
        display: true,
        text: 'Top Organizations by Completion Rate',
        font: {
          size: 14,
          weight: 'bold'
        },
        padding: {
          bottom: 15
        }
      }
    }
  };

  // Task Status Distribution (Doughnut Chart)
  const getTaskStatusChartData = () => {
    if (!analytics?.overview?.tasks) {
      return null;
    }

    const { total, completed, pending } = analytics.overview.tasks;
    const inProgress = total - completed - pending;

    return {
      labels: ['Completed', 'In Progress', 'Pending'],
      datasets: [
        {
          data: [completed, inProgress, pending],
          backgroundColor: [
            '#4CAF50',
            '#FF9800',
            '#F44335'
          ],
          borderColor: '#fff',
          borderWidth: 3,
          hoverOffset: 8
        }
      ]
    };
  };

  // User Growth Trend (Line Chart)
  const getUserGrowthChartData = () => {
    if (!analytics?.growth?.users || analytics.growth.users.length === 0) {
      return null;
    }

    const labels = analytics.growth.users.map(item => {
      const date = new Date(item.date);
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    });

    return {
      labels,
      datasets: [
        {
          label: 'New Users',
          data: analytics.growth.users.map(item => item.usersCreated),
          borderColor: '#00BCD4',
          backgroundColor: 'rgba(0, 188, 212, 0.1)',
          borderWidth: 2,
          fill: true,
          tension: 0.4,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: '#00BCD4',
          pointBorderColor: '#fff',
          pointBorderWidth: 2
        }
      ]
    };
  };

  // Organization Growth Trend (Line Chart)
  const getOrgGrowthChartData = () => {
    if (!analytics?.growth?.organizations || analytics.growth.organizations.length === 0) {
      return null;
    }

    const labels = analytics.growth.organizations.map(item => {
      const date = new Date(item.date);
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    });

    return {
      labels,
      datasets: [
        {
          label: 'New Organizations',
          data: analytics.growth.organizations.map(item => item.organizationsCreated),
          borderColor: '#1A73E8',
          backgroundColor: 'rgba(26, 115, 232, 0.1)',
          borderWidth: 2,
          fill: true,
          tension: 0.4,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: '#1A73E8',
          pointBorderColor: '#fff',
          pointBorderWidth: 2
        }
      ]
    };
  };

  // --- Individual Performance helpers ---

  const getSortedPerformers = () => {
    if (!analytics?.performers) return [];
    return [...analytics.performers].sort((a, b) => {
      const aVal = a[performerSort.key] ?? 0;
      const bVal = b[performerSort.key] ?? 0;
      return performerSort.dir === 'desc' ? bVal - aVal : aVal - bVal;
    });
  };

  const handlePerformerSort = (key) => {
    setPerformerSort(prev => ({
      key,
      dir: prev.key === key && prev.dir === 'desc' ? 'asc' : 'desc'
    }));
  };

  const getSortIcon = (key) => {
    if (performerSort.key !== key) return ' \u2195';
    return performerSort.dir === 'desc' ? ' \u2193' : ' \u2191';
  };

  const getScoreClass = (score) => {
    if (score >= 80) return 'high';
    if (score >= 50) return 'medium';
    return 'low';
  };

  const getRoleBadgeClass = (role) => {
    if (role === 'admin' || role === 'super_admin') return 'badge-admin';
    if (role === 'supervisor') return 'badge-supervisor';
    return 'badge-technician';
  };

  const getPerformerSummary = () => {
    const performers = analytics?.performers || [];
    if (performers.length === 0) return { avgCompletion: 0, avgOnTime: 0, avgQuality: 0, workloadBalance: 'N/A' };

    const avgCompletion = Math.round(performers.reduce((s, p) => s + p.completionRate, 0) / performers.length);
    const avgOnTime = Math.round(performers.reduce((s, p) => s + p.onTimeRate, 0) / performers.length);
    const avgQuality = Math.round(performers.reduce((s, p) => s + p.qualityScore, 0) / performers.length);

    // Workload balance: standard deviation of totalAssigned
    const avgWorkload = performers.reduce((s, p) => s + p.totalAssigned, 0) / performers.length;
    const variance = performers.reduce((s, p) => s + Math.pow(p.totalAssigned - avgWorkload, 2), 0) / performers.length;
    const stdDev = Math.sqrt(variance);
    const cv = avgWorkload > 0 ? (stdDev / avgWorkload) * 100 : 0;
    let workloadBalance;
    if (cv <= 25) workloadBalance = 'Well Balanced';
    else if (cv <= 50) workloadBalance = 'Moderate';
    else workloadBalance = 'Imbalanced';

    return { avgCompletion, avgOnTime, avgQuality, workloadBalance };
  };

  // Top Performers Chart
  const getTopPerformersChartData = () => {
    const performers = analytics?.performers || [];
    if (performers.length === 0) return null;

    const top = [...performers].sort((a, b) => b.overallScore - a.overallScore).slice(0, 10);

    return {
      labels: top.map(p => p.name.length > 18 ? p.name.substring(0, 18) + '...' : p.name),
      datasets: [{
        label: 'Overall Score',
        data: top.map(p => p.overallScore),
        backgroundColor: top.map(p => {
          if (p.overallScore >= 80) return '#4CAF50';
          if (p.overallScore >= 50) return '#FF9800';
          return '#F44335';
        }),
        borderColor: '#fff',
        borderWidth: 2,
        borderRadius: 6
      }]
    };
  };

  // Workload Distribution Chart
  const getWorkloadChartData = () => {
    const performers = analytics?.performers || [];
    if (performers.length === 0) return null;

    const sorted = [...performers].sort((a, b) => b.totalAssigned - a.totalAssigned).slice(0, 15);

    return {
      labels: sorted.map(p => p.name.length > 15 ? p.name.substring(0, 15) + '...' : p.name),
      datasets: [
        {
          label: 'Completed',
          data: sorted.map(p => p.completed),
          backgroundColor: '#4CAF50',
          borderRadius: 4
        },
        {
          label: 'Pending',
          data: sorted.map(p => p.pending),
          backgroundColor: '#FF9800',
          borderRadius: 4
        }
      ]
    };
  };

  const workloadChartOptions = {
    ...chartOptions,
    plugins: {
      ...chartOptions.plugins,
      title: { display: false }
    },
    scales: {
      ...chartOptions.scales,
      x: { ...chartOptions.scales.x, stacked: true },
      y: { ...chartOptions.scales.y, stacked: true }
    }
  };

  const topPerformerOptions = {
    ...chartOptions,
    indexAxis: 'y',
    plugins: {
      ...chartOptions.plugins,
      title: { display: false },
      legend: { display: false }
    },
    scales: {
      ...chartOptions.scales,
      x: { ...chartOptions.scales.x, max: 100, title: { display: true, text: 'Score %' } }
    }
  };

  if (loading) {
    return (
      <div className="platform-analytics-container">
        <div className="loading">Loading analytics...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="platform-analytics-container">
        <div className="error-message">{error}</div>
      </div>
    );
  }

  if (!analytics) {
    return null;
  }

  const { overview, activity, organizations, growth } = analytics;

  return (
    <div className="platform-analytics-container">
      <div className="platform-analytics-header">
        <div>
          <h1>Platform Analytics</h1>
          <p className="platform-subtitle">Comprehensive overview of all organizations and system performance</p>
        </div>
        
        <div className="analytics-controls">
          <div className="control-group">
            <label>Time Range:</label>
            <select value={timeRange} onChange={(e) => setTimeRange(e.target.value)} className="control-select">
              <option value="7d">Last 7 Days</option>
              <option value="30d">Last 30 Days</option>
              <option value="90d">Last 90 Days</option>
              <option value="1y">Last Year</option>
            </select>
          </div>
          <button
            className="btn btn-secondary"
            onClick={loadAnalytics}
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Key Performance Indicators */}
      <div className="analytics-kpi-grid">
        <div className="kpi-card">
          <div className="kpi-label">Total Organizations</div>
          <div className="kpi-value">{formatNumber(overview.organizations.total)}</div>
          <div className="kpi-detail">
            {overview.organizations.active} active • {overview.organizations.newThisPeriod} new
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">Total Users</div>
          <div className="kpi-value">{formatNumber(overview.users.total)}</div>
          <div className="kpi-detail">
            {overview.users.active} active • {overview.users.newThisPeriod} new
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">Total Tasks</div>
          <div className="kpi-value">{formatNumber(overview.tasks.total)}</div>
          <div className="kpi-detail">
            {overview.tasks.completed} completed • {overview.tasks.pending} pending
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">Task Completion Rate</div>
          <div className="kpi-value">
            {overview.tasks.total > 0 
              ? formatPercentage(Math.round((overview.tasks.completed / overview.tasks.total) * 100))
              : '0%'}
          </div>
          <div className="kpi-detail">
            {overview.tasks.completed} of {overview.tasks.total} tasks
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">Active Organizations</div>
          <div className="kpi-value">{formatNumber(overview.organizations.active)}</div>
          <div className="kpi-detail">
            {overview.organizations.total > 0 
              ? formatPercentage(Math.round((overview.organizations.active / overview.organizations.total) * 100))
              : '0%'} of total
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">Avg Users per Org</div>
          <div className="kpi-value">
            {overview.organizations.total > 0
              ? formatNumber(Math.round(overview.users.total / overview.organizations.total))
              : '0'}
          </div>
          <div className="kpi-detail">
            Across all organizations
          </div>
        </div>
      </div>

      {/* Main Charts Section */}
      <div className="analytics-charts-grid">
        {/* Task Activity Trend */}
        <div className="analytics-section chart-section">
          <h2>Task Activity Trend</h2>
          <p className="section-description">Daily task creation and completion over time</p>
          <div className="chart-wrapper">
            {getTaskActivityChartData() ? (
              <Line data={getTaskActivityChartData()} options={chartOptions} />
            ) : (
              <div className="no-data">No activity data available</div>
            )}
          </div>
        </div>

        {/* Task Completion Rate Trend */}
        <div className="analytics-section chart-section">
          <h2>Completion Rate Trend</h2>
          <p className="section-description">Task completion percentage over time</p>
          <div className="chart-wrapper">
            {getCompletionRateChartData() ? (
              <Line data={getCompletionRateChartData()} options={chartOptions} />
            ) : (
              <div className="no-data">No completion data available</div>
            )}
          </div>
        </div>
      </div>

      {/* Secondary Charts Section */}
      <div className="analytics-charts-grid">
        {/* Task Status Distribution */}
        <div className="analytics-section chart-section">
          <h2>Task Status Distribution</h2>
          <p className="section-description">Overall task status breakdown</p>
          <div className="chart-wrapper doughnut-wrapper">
            {getTaskStatusChartData() ? (
              <Doughnut 
                data={getTaskStatusChartData()} 
                options={{
                  ...chartOptions,
                  plugins: {
                    ...chartOptions.plugins,
                    legend: {
                      ...chartOptions.plugins.legend,
                      position: 'bottom'
                    }
                  }
                }} 
              />
            ) : (
              <div className="no-data">No task data available</div>
            )}
          </div>
        </div>

        {/* Organization Performance */}
        <div className="analytics-section chart-section">
          <h2>Organization Performance</h2>
          <p className="section-description">Top organizations by completion rate</p>
          <div className="chart-wrapper">
            {getOrganizationPerformanceChartData() ? (
              <Bar data={getOrganizationPerformanceChartData()} options={orgPerformanceOptions} />
            ) : (
              <div className="no-data">No organization data available</div>
            )}
          </div>
        </div>
      </div>

      {/* Growth Trends */}
      <div className="analytics-charts-grid">
        {/* User Growth */}
        <div className="analytics-section chart-section">
          <h2>User Growth</h2>
          <p className="section-description">New users added over time</p>
          <div className="chart-wrapper">
            {getUserGrowthChartData() ? (
              <Line data={getUserGrowthChartData()} options={chartOptions} />
            ) : (
              <div className="no-data">No user growth data available</div>
            )}
          </div>
        </div>

        {/* Organization Growth */}
        <div className="analytics-section chart-section">
          <h2>Organization Growth</h2>
          <p className="section-description">New organizations added over time</p>
          <div className="chart-wrapper">
            {getOrgGrowthChartData() ? (
              <Line data={getOrgGrowthChartData()} options={chartOptions} />
            ) : (
              <div className="no-data">No organization growth data available</div>
            )}
          </div>
        </div>
      </div>

      {/* Organization Comparison Table */}
      <div className="analytics-section">
        <div className="section-header">
          <div>
            <h2>Organization Activity Details</h2>
            <p className="section-description">Detailed metrics for each organization</p>
          </div>
        </div>
        <div className="org-comparison-table-container">
          {organizations.length === 0 ? (
            <div className="no-data">No organization data available</div>
          ) : (
            <table className="org-comparison-table">
              <thead>
                <tr>
                  <th>Organization</th>
                  <th>Users</th>
                  <th>Total Tasks</th>
                  <th>Completed</th>
                  <th>Completion Rate</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {organizations.map(org => (
                  <tr key={org.id}>
                    <td>
                      <strong>{org.name}</strong>
                      <div className="org-slug">{org.slug}</div>
                    </td>
                    <td>{formatNumber(org.user_count)}</td>
                    <td>{formatNumber(org.task_count)}</td>
                    <td>{formatNumber(org.completed_tasks)}</td>
                    <td>
                      <div className="completion-rate-cell">
                        <span className={`completion-rate ${org.completion_rate >= 80 ? 'high' : org.completion_rate >= 50 ? 'medium' : 'low'}`}>
                          {formatPercentage(org.completion_rate)}
                        </span>
                      </div>
                    </td>
                    <td>
                      <button
                        className="btn btn-sm btn-secondary"
                        onClick={() => navigate(`/platform/organizations/${org.id}/settings`)}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* INDIVIDUAL PERFORMANCE SECTION                                 */}
      {/* ═══════════════════════════════════════════════════════════════ */}

      <div className="performance-divider">
        <h2 className="performance-divider-title">
          <i className="fas fa-user-chart"></i> Individual Performance KPIs
        </h2>
        <p className="performance-divider-subtitle">
          Assess employee performance, identify top performers, and monitor workload balance across teams
        </p>
      </div>

      {/* Performance Summary KPIs */}
      {analytics?.performers && analytics.performers.length > 0 && (() => {
        const summary = getPerformerSummary();
        return (
          <div className="performer-kpi-grid">
            <div className="performer-kpi-card">
              <div className="performer-kpi-icon" style={{ background: '#e8f5e9', color: '#2e7d32' }}>
                <i className="fas fa-check-circle"></i>
              </div>
              <div className="performer-kpi-content">
                <div className="performer-kpi-label">Avg Completion Rate</div>
                <div className="performer-kpi-value">{summary.avgCompletion}%</div>
                <div className="performer-kpi-sub">Across all personnel</div>
              </div>
            </div>
            <div className="performer-kpi-card">
              <div className="performer-kpi-icon" style={{ background: '#e3f2fd', color: '#1565c0' }}>
                <i className="fas fa-clock"></i>
              </div>
              <div className="performer-kpi-content">
                <div className="performer-kpi-label">Avg On-Time Rate</div>
                <div className="performer-kpi-value">{summary.avgOnTime}%</div>
                <div className="performer-kpi-sub">Tasks completed by schedule</div>
              </div>
            </div>
            <div className="performer-kpi-card">
              <div className="performer-kpi-icon" style={{ background: '#fce4ec', color: '#c62828' }}>
                <i className="fas fa-award"></i>
              </div>
              <div className="performer-kpi-content">
                <div className="performer-kpi-label">Avg Quality Score</div>
                <div className="performer-kpi-value">{summary.avgQuality}%</div>
                <div className="performer-kpi-sub">Inspection pass rate</div>
              </div>
            </div>
            <div className="performer-kpi-card">
              <div className="performer-kpi-icon" style={{ background: '#fff3e0', color: '#e65100' }}>
                <i className="fas fa-balance-scale"></i>
              </div>
              <div className="performer-kpi-content">
                <div className="performer-kpi-label">Workload Balance</div>
                <div className="performer-kpi-value">{summary.workloadBalance}</div>
                <div className="performer-kpi-sub">Task distribution equity</div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Performance Charts */}
      <div className="analytics-charts-grid">
        <div className="analytics-section chart-section">
          <h2>Top Performers</h2>
          <p className="section-description">Ranked by overall score (40% completion + 30% on-time + 30% quality)</p>
          <div className="chart-wrapper">
            {getTopPerformersChartData() ? (
              <Bar data={getTopPerformersChartData()} options={topPerformerOptions} />
            ) : (
              <div className="no-data">No performer data available</div>
            )}
          </div>
        </div>

        <div className="analytics-section chart-section">
          <h2>Workload Distribution</h2>
          <p className="section-description">Tasks assigned per person — completed vs pending</p>
          <div className="chart-wrapper">
            {getWorkloadChartData() ? (
              <Bar data={getWorkloadChartData()} options={workloadChartOptions} />
            ) : (
              <div className="no-data">No workload data available</div>
            )}
          </div>
        </div>
      </div>

      {/* Performer Scorecard Table */}
      <div className="analytics-section">
        <div className="section-header">
          <div>
            <h2>Employee Performance Scorecard</h2>
            <p className="section-description">
              Detailed KPI breakdown per employee — click column headers to sort
            </p>
          </div>
          <div className="performer-count">
            {analytics?.performers?.length || 0} employees tracked
          </div>
        </div>
        <div className="org-comparison-table-container">
          {!analytics?.performers || analytics.performers.length === 0 ? (
            <div className="no-data">No performer data available for the selected period</div>
          ) : (
            <table className="org-comparison-table performer-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Employee</th>
                  <th className="sortable-col" onClick={() => handlePerformerSort('totalAssigned')}>
                    Assigned{getSortIcon('totalAssigned')}
                  </th>
                  <th className="sortable-col" onClick={() => handlePerformerSort('completed')}>
                    Completed{getSortIcon('completed')}
                  </th>
                  <th className="sortable-col" onClick={() => handlePerformerSort('completionRate')}>
                    Completion %{getSortIcon('completionRate')}
                  </th>
                  <th className="sortable-col" onClick={() => handlePerformerSort('onTimeRate')}>
                    On-Time %{getSortIcon('onTimeRate')}
                  </th>
                  <th className="sortable-col" onClick={() => handlePerformerSort('qualityScore')}>
                    Quality %{getSortIcon('qualityScore')}
                  </th>
                  <th className="sortable-col" onClick={() => handlePerformerSort('avgHours')}>
                    Avg Hours{getSortIcon('avgHours')}
                  </th>
                  <th className="sortable-col" onClick={() => handlePerformerSort('flagged')}>
                    Flagged{getSortIcon('flagged')}
                  </th>
                  <th className="sortable-col" onClick={() => handlePerformerSort('overallScore')}>
                    Score{getSortIcon('overallScore')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {getSortedPerformers().map((p, idx) => (
                  <tr key={p.id}>
                    <td className="performer-rank">{idx + 1}</td>
                    <td>
                      <div className="performer-name">{p.name}</div>
                      <div className="performer-meta">
                        <span className={`role-badge ${getRoleBadgeClass(p.role)}`}>
                          {p.role?.replace('_', ' ')}
                        </span>
                        <span className="performer-org">{p.organization}</span>
                      </div>
                    </td>
                    <td>{p.totalAssigned}</td>
                    <td>{p.completed}</td>
                    <td>
                      <span className={`score-badge ${getScoreClass(p.completionRate)}`}>
                        {p.completionRate}%
                      </span>
                    </td>
                    <td>
                      <span className={`score-badge ${getScoreClass(p.onTimeRate)}`}>
                        {p.onTimeRate}%
                      </span>
                    </td>
                    <td>
                      <span className={`score-badge ${getScoreClass(p.qualityScore)}`}>
                        {p.qualityScore}%
                      </span>
                    </td>
                    <td>{p.avgHours !== null ? `${p.avgHours}h` : '-'}</td>
                    <td>
                      {p.flagged > 0 ? (
                        <span className="flagged-count">{p.flagged}</span>
                      ) : (
                        <span className="no-flags">0</span>
                      )}
                    </td>
                    <td>
                      <div className="overall-score-cell">
                        <span className={`score-badge overall ${getScoreClass(p.overallScore)}`}>
                          {p.overallScore}
                        </span>
                        <div className="score-bar">
                          <div
                            className={`score-bar-fill ${getScoreClass(p.overallScore)}`}
                            style={{ width: `${p.overallScore}%` }}
                          ></div>
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

export default PlatformAnalytics;
