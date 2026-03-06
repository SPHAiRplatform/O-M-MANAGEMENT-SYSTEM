import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { 
  getTasks, 
  getCMLetters, 
  getPlantMapStructure, 
  getCalendarEventsByDate, 
  getInventoryItems 
} from '../api/api';
import './Dashboard.css';
import { getApiBaseUrl, authFetch } from '../api/api';
import { useAuth } from '../context/AuthContext';
import { hasOrganizationContext, isSystemOwnerWithoutCompany, getCurrentOrganizationSlug } from '../utils/organizationContext';
import { 
  Chart as ChartJS, 
  ArcElement, 
  Tooltip, 
  Legend, 
  CategoryScale,
  LinearScale,
  BarElement
} from 'chart.js';
import { Doughnut, Bar, Line } from 'react-chartjs-2';
import { LineElement, PointElement } from 'chart.js';

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement, LineElement, PointElement);

// Color mapping for different task frequencies (from Calendar.js)
const FREQUENCY_COLORS = {
  'weekly': '#ffff00',        // Yellow - WEEKLY
  'monthly': '#92d050',        // Green - MONTHLY
  'quarterly': '#00b0f0',      // Blue - QUARTERLY
  'biannually': '#BFBFBF',     // Light Grey - BI-ANNUAL
  'bi-annually': '#BFBFBF',    // Light Grey - BI-ANNUAL
  'bi-annual': '#BFBFBF',      // Light Grey - BI-ANNUAL
  'annually': '#CC5C0B',       // Orange/Brown - ANNUAL
  'annual': '#CC5C0B',         // Orange/Brown - ANNUAL
  'bimonthly': '#F9B380',      // Light Orange - BI-MONTHLY
  'bi-monthly': '#F9B380',    // Light Orange - BI-MONTHLY
  'public holiday': '#808080', // Grey - PUBLIC HOLIDAY
  'holiday': '#808080',        // Grey - PUBLIC HOLIDAY
  'public': '#808080'          // Grey - PUBLIC HOLIDAY
};

// Function to get event color (from Calendar.js)
function getEventColor(event) {
  // Check for "Complete Outstanding PM's and reports" - return special marker
  if (event.task_title) {
    const title = typeof event.task_title === 'string' 
      ? event.task_title 
      : (event.task_title.text || event.task_title.richText?.map(r => r.text).join('') || '');
    if (title.toLowerCase().includes("complete outstanding")) {
      return '#FF0000'; // Red for outstanding tasks
    }
  }
  
  // First check if frequency is explicitly set
  if (event.frequency) {
    const freq = event.frequency.toLowerCase();
    if (FREQUENCY_COLORS[freq]) {
      return FREQUENCY_COLORS[freq];
    }
  }
  
  // Try to detect from task title
  if (event.task_title) {
    const title = typeof event.task_title === 'string' 
      ? event.task_title.toLowerCase()
      : (event.task_title.text || event.task_title.richText?.map(r => r.text).join('') || '').toLowerCase();
    
    // Check for public holiday first (most specific)
    if (title.includes('public holiday') || title.includes('holiday')) {
      return FREQUENCY_COLORS['public holiday'];
    }
    
    // Check for bi-monthly
    if (title.includes('bi-monthly') || title.includes('bimonthly')) {
      return FREQUENCY_COLORS['bi-monthly'];
    }
    
    // Check for bi-annually
    if (title.includes('bi-annually') || title.includes('biannually') || title.includes('bi-annual')) {
      return FREQUENCY_COLORS['bi-annually'];
    }
    
    // Check for annually/annual
    if (title.includes('annually') || title.includes('annual')) {
      return FREQUENCY_COLORS['annually'];
    }
    
    // Check for quarterly
    if (title.includes('quarterly') || title.includes('quaterly')) {
      return FREQUENCY_COLORS['quarterly'];
    }
    
    // Check for monthly
    if (title.includes('monthly')) {
      return FREQUENCY_COLORS['monthly'];
    }
    
    // Check for weekly
    if (title.includes('weekly')) {
      return FREQUENCY_COLORS['weekly'];
    }
  }
  
  // Default color if no match
  return '#3498db';
}

// Plugin to display numbers in the middle of horizontal bars
ChartJS.register({
  id: 'barValuePlugin',
  afterDatasetsDraw: (chart) => {
    // Only apply to bar charts, not doughnut charts
    if (chart.config.type !== 'bar') return;
    
    const ctx = chart.ctx;
    const meta = chart.getDatasetMeta(0);
    
    meta.data.forEach((bar, index) => {
      const value = chart.data.datasets[0].data[index];
      if (value > 0) {
        // For horizontal bars (indexAxis: 'y'), x is the value position, y is the category position
        // Position text at the middle of the bar horizontally
        const x = bar.x / 2; // Middle of the bar (halfway from 0 to bar.x)
        const y = bar.y;
        
        ctx.save();
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 13px Roboto, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
        ctx.shadowBlur = 2;
        ctx.fillText(value.toString(), x, y);
        ctx.restore();
      }
    });
  }
});

// BI Color Palette
const BI_COLORS = {
  primary: '#1A73E8',
  success: '#4CAF50',
  warning: '#FF9800',
  error: '#F44335',
  info: '#00BCD4',
  secondary: '#9E9E9E',
  lightGray: '#E0E0E0',
  darkGray: '#757575'
};

// Create gradient function for charts (vertical gradient for doughnuts)
const createGradient = (ctx, chartArea, color1, color2) => {
  if (!chartArea) {
    return color1;
  }
  const gradient = ctx.createLinearGradient(0, chartArea.bottom, 0, chartArea.top);
  gradient.addColorStop(0, color1);
  gradient.addColorStop(0.5, color2);
  gradient.addColorStop(1, color1);
  return gradient;
};

// Create horizontal gradient for bar charts
const createHorizontalGradient = (ctx, chartArea, color1, color2) => {
  if (!chartArea) {
    return color1;
  }
  const gradient = ctx.createLinearGradient(chartArea.left, 0, chartArea.right, 0);
  gradient.addColorStop(0, color1);
  gradient.addColorStop(1, color2);
  return gradient;
};

function Dashboard() {
  const { user, loading: authLoading } = useAuth();
  const [companyLogo, setCompanyLogo] = useState(null); // Start with null, only set if company is selected
  const [stats, setStats] = useState({
    pendingTasks: 0,
    inProgressTasks: 0,
    completedTasks: 0,
    openCMLetters: 0,
  });
  const [loading, setLoading] = useState(true);
  const [pmPeriod, setPmPeriod] = useState('monthly');
  const [pmStats, setPmStats] = useState({
    total: 0,
    completed: 0,
  });
  const [grassCuttingProgress, setGrassCuttingProgress] = useState(0);
  const [panelWashProgress, setPanelWashProgress] = useState(0);
  const [trackerViewMode, setTrackerViewMode] = useState('grass_cutting');
  const [inventoryStats, setInventoryStats] = useState({
    inStock: 0,
    lowStock: 0,
    outOfStock: 0,
    total: 0
  });
  const [todayActivities, setTodayActivities] = useState([]);
  const [currentTime, setCurrentTime] = useState(new Date());

  // Live clock - update every second
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    // Wait for AuthContext to finish loading before checking organization context
    if (authLoading) {
      return; // Don't check until auth is loaded
    }
    
    // Only load data if user has organization context
    if (hasOrganizationContext(user)) {
      loadDashboardData();
      loadCompanyLogo();

      // Auto-refresh dashboard data and logo every 30 seconds
      const refreshInterval = setInterval(() => {
        loadDashboardData();
        loadCompanyLogo(); // Also refresh logo in case branding was updated
      }, 30000); // 30 seconds

      return () => clearInterval(refreshInterval);
    } else {
      // System owner without company: show empty dashboard
      setStats({ pendingTasks: 0, inProgressTasks: 0, completedTasks: 0, openCMLetters: 0 });
      setPmStats({ total: 0, completed: 0 });
      setGrassCuttingProgress(0);
      setPanelWashProgress(0);
      setInventoryStats({ inStock: 0, lowStock: 0, outOfStock: 0, total: 0 });
      setTodayActivities([]);
      setCompanyLogo(null); // No logo when no company selected
      setLoading(false);
    }
  }, [pmPeriod, user, authLoading]);

  /**
   * Build base URL for static files (uploads). Logo and other files are served at
   * /uploads/..., not under /api, so we must use origin without /api.
   */
  const getUploadsBaseUrl = () => {
    const apiBase = getApiBaseUrl();
    return apiBase.replace(/\/api\/?$/, '') || apiBase;
  };

  /**
   * Load company logo from organization branding (database)
   *
   * - Fetches logo_url from organization_branding table
   * - Uses uploads base URL (no /api) so /uploads/... resolves correctly
   * - Falls back to default file path only if logo_url not set or image fails
   * - Cache-bust with updated_at so changes/removals show immediately
   */
  const loadCompanyLogo = async () => {
    try {
      // Check if user has organization context
      if (!hasOrganizationContext(user)) {
        setCompanyLogo(null);
        return;
      }

      const uploadsBase = getUploadsBaseUrl();

      // Fetch branding from database (includes logo_url, updated_at)
      try {
        const response = await authFetch(`${getApiBaseUrl()}/organizations/current/branding`);

        if (response.ok) {
          const branding = await response.json();
          
          // Branding row exists and has explicit logo_url: use it (with cache-busting)
          if (branding && branding.logo_url) {
            const path = branding.logo_url.startsWith('http')
              ? branding.logo_url
              : `${uploadsBase}${branding.logo_url.startsWith('/') ? branding.logo_url : '/' + branding.logo_url}`;
            const t = branding.updated_at ? new Date(branding.updated_at).getTime() : Date.now();
            const logoUrl = path + (path.includes('?') ? `&t=${t}` : `?t=${t}`);
            
            const img = new Image();
            img.onload = () => setCompanyLogo(logoUrl);
            img.onerror = () => loadDefaultLogo();
            img.src = logoUrl;
            return;
          }
          
          // Branding row exists but logo_url is empty (e.g. legacy data):
          // fall back to default company logo file if it exists
          await loadDefaultLogo();
          return;
        }
      } catch (brandingError) {
        console.error('Error fetching branding:', brandingError);
      }

      // No branding or fetch failed: try default file path (e.g. first-time, no logo set yet)
      loadDefaultLogo();
    } catch (error) {
      console.error('Error loading company logo:', error);
      setCompanyLogo(null);
    }
  };

  /**
   * Load default logo from file system
   * Used as fallback when logo_url not set in database
   */
  const loadDefaultLogo = async () => {
    try {
      const organizationSlug = getCurrentOrganizationSlug(user);

      if (!organizationSlug) {
        setCompanyLogo(null);
        return;
      }

      const baseUrl = getUploadsBaseUrl();
      const logoUrl = `${baseUrl}/uploads/companies/${organizationSlug}/logos/logo.png`;

      // Test if default logo exists
      const img = new Image();
      img.onload = () => {
        setCompanyLogo(logoUrl);
      };
      img.onerror = () => {
        setCompanyLogo(null);
      };
      img.src = logoUrl;
    } catch (error) {
      console.error('Error loading default logo:', error);
      setCompanyLogo(null);
    }
  };

  const loadDashboardData = async () => {
    try {
      // Check if user has organization context
      if (!hasOrganizationContext(user)) {
        // System owner without company: set all stats to zero
        setStats({ pendingTasks: 0, inProgressTasks: 0, completedTasks: 0, openCMLetters: 0 });
        setPmStats({ total: 0, completed: 0 });
        setGrassCuttingProgress(0);
        setPanelWashProgress(0);
        setInventoryStats({ inStock: 0, lowStock: 0, outOfStock: 0, total: 0 });
        setTodayActivities([]);
        setLoading(false);
        return;
      }
      
      setLoading(true);
      
      // Load all data in parallel
      // IMPORTANT: All API calls are company-specific via tenantContextMiddleware
      const [tasksRes, cmLettersRes, plantRes, inventoryRes] = await Promise.all([
        getTasks({ task_type: 'PM' }),
        getCMLetters({ status: 'open' }),
        getPlantMapStructure().catch(() => ({ structure: [] })), // Returns empty if no company map
        getInventoryItems().catch(() => ({ data: [] }))
      ]);

      const tasks = tasksRes.data || [];
      const cmLetters = cmLettersRes.data || [];
      // plantStructure is company-specific - comes from company folder only
      const plantStructure = (plantRes && plantRes.structure && Array.isArray(plantRes.structure)) 
        ? plantRes.structure 
        : [];
      const inventoryItems = inventoryRes.data || [];

      // Calculate stats
      const statsData = {
        pendingTasks: tasks.filter(t => t.status === 'pending').length,
        inProgressTasks: tasks.filter(t => t.status === 'in_progress').length,
        completedTasks: tasks.filter(t => t.status === 'completed').length,
        openCMLetters: cmLetters.length,
      };
      setStats(statsData);

      // Calculate PM stats based on period
      const now = new Date();
      let startDate, endDate;
      
      if (pmPeriod === 'weekly') {
        startDate = new Date(now);
        startDate.setDate(now.getDate() - 7);
        endDate = now;
      } else if (pmPeriod === 'monthly') {
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      } else { // yearly
        startDate = new Date(now.getFullYear(), 0, 1);
        endDate = new Date(now.getFullYear(), 11, 31);
      }

      const periodTasks = tasks.filter(task => {
        if (!task.scheduled_date) return false;
        const taskDate = new Date(task.scheduled_date);
        return taskDate >= startDate && taskDate <= endDate;
      });

      const pmData = {
        total: periodTasks.length,
        completed: periodTasks.filter(t => t.status === 'completed').length,
      };
      setPmStats(pmData);

      // Calculate Grass Cutting and Panel Wash progress from Plant data
      // PERMANENT SOLUTION: plantStructure comes from getPlantMapStructure() which loads from company folder
      // If plantStructure is empty or null, progress must be 0 (company has no map data)
      // This ensures no cross-company data leakage
      const allTrackers = plantStructure && Array.isArray(plantStructure) && plantStructure.length > 0
        ? plantStructure.filter(t => t && t.id && t.id.startsWith('M') && /^M\d{2}$/.test(t.id))
        : [];

      // Only calculate progress if company has trackers (has plant map)
      if (allTrackers.length > 0) {
        // Grass Cutting
        const grassDoneCount = allTrackers.filter(t => {
          const color = t.grassCuttingColor || '#ffffff';
          return color === '#4CAF50' || color === '#90EE90';
        }).length;
        const grassHalfwayCount = allTrackers.filter(t => {
          const color = t.grassCuttingColor || '#ffffff';
          return color === '#FF9800' || color === '#FFD700';
        }).length;
        const grassProgress = ((grassDoneCount + grassHalfwayCount * 0.5) / allTrackers.length) * 100;
        setGrassCuttingProgress(grassProgress);

        // Panel Wash
        const panelDoneCount = allTrackers.filter(t => {
          const color = t.panelWashColor || '#ffffff';
          return color === '#4CAF50' || color === '#90EE90';
        }).length;
        const panelHalfwayCount = allTrackers.filter(t => {
          const color = t.panelWashColor || '#ffffff';
          return color === '#FF9800' || color === '#FFD700';
        }).length;
        const panelProgress = ((panelDoneCount + panelHalfwayCount * 0.5) / allTrackers.length) * 100;
        setPanelWashProgress(panelProgress);
      } else {
        // No trackers = no progress (company has no plant map)
        setGrassCuttingProgress(0);
        setPanelWashProgress(0);
      }

      // Calculate Inventory Stats
      const invStats = {
        inStock: inventoryItems.filter(item => {
          const qty = item.quantity || 0;
          const minQty = item.minimum_quantity || 0;
          return qty > minQty;
        }).length,
        lowStock: inventoryItems.filter(item => {
          const qty = item.quantity || 0;
          const minQty = item.minimum_quantity || 0;
          return qty > 0 && qty <= minQty;
        }).length,
        outOfStock: inventoryItems.filter(item => {
          const qty = item.quantity || 0;
          return qty === 0;
        }).length,
        total: inventoryItems.length
      };
      setInventoryStats(invStats);

      // Load today's calendar activities and tasks
      const today = new Date().toISOString().split('T')[0];
      try {
        const [calendarRes] = await Promise.all([
          getCalendarEventsByDate(today).catch(() => ({ data: [] }))
        ]);
        
        const events = calendarRes.data || [];
        
        // Filter tasks scheduled for today
        const todayTasks = tasks.filter(task => {
          if (!task.scheduled_date) return false;
          const taskDate = new Date(task.scheduled_date).toISOString().split('T')[0];
          return taskDate === today;
        });
        
        // Combine calendar events and tasks
        const combinedActivities = [
          // Calendar events
          ...events.map(event => ({
            id: `event-${event.id}`,
            title: event.task_title || event.event_name || 'Untitled Event',
            description: event.description,
            event_date: event.event_date,
            type: 'calendar_event',
            frequency: event.frequency,
            color: getEventColor(event)
          })),
          // Tasks scheduled for today
          ...todayTasks.map(task => ({
            id: `task-${task.id}`,
            title: task.template_name || task.task_code || 'Task',
            description: task.location ? `Location: ${task.location}` : null,
            event_date: task.scheduled_date,
            type: 'task',
            status: task.status,
            task_code: task.task_code,
            frequency: task.frequency || null,
            // For tasks, try to get color from template frequency or default
            color: task.frequency ? (FREQUENCY_COLORS[task.frequency.toLowerCase()] || '#3498db') : '#3498db'
          }))
        ];
        
        // Sort by time if available, otherwise by title
        combinedActivities.sort((a, b) => {
          if (a.event_date && b.event_date) {
            return a.event_date.localeCompare(b.event_date);
          }
          return (a.title || '').localeCompare(b.title || '');
        });
        
        setTodayActivities(combinedActivities.slice(0, 5)); // Show max 5 activities
      } catch (error) {
        console.error('Error loading today\'s activities:', error);
        setTodayActivities([]);
      }

      setLoading(false);
    } catch (error) {
      console.error('Error loading dashboard:', error);
      setLoading(false);
    }
  };

  // PM Chart Data with Gradient
  const getPMChartData = () => {
    const completed = pmStats.completed;
    const remaining = Math.max(0, pmStats.total - completed);

    return {
      labels: ['Completed', 'Remaining'],
      datasets: [{
        data: [completed, remaining],
        backgroundColor: (context) => {
          const chart = context.chart;
          const {ctx, chartArea} = chart;
          if (context.dataIndex === 0) {
            // Vibrant green gradient for completed
            return createGradient(ctx, chartArea, '#2E7D32', '#81C784');
          }
          // Subtle gray gradient for remaining
          return createGradient(ctx, chartArea, '#BDBDBD', '#E0E0E0');
        },
        borderColor: '#ffffff',
        borderWidth: 3,
        hoverBorderWidth: 5,
        hoverOffset: 10,
      }],
    };
  };

  // Grass Cutting/Panel Wash Chart Data - Doughnut Chart
  const getTrackerChartData = () => {
    const progress = trackerViewMode === 'grass_cutting' ? grassCuttingProgress : panelWashProgress;
    const completedProgress = progress;
    const remainingProgress = 100 - progress;

    return {
      labels: ['Completed', 'Remaining'],
      datasets: [{
        data: [completedProgress, remainingProgress],
        backgroundColor: (context) => {
          const chart = context.chart;
          const {ctx, chartArea} = chart;
          if (context.dataIndex === 0) {
            // Green gradient for grass cutting, blue gradient for panel wash
            if (trackerViewMode === 'grass_cutting') {
              return createGradient(ctx, chartArea, '#1B5E20', '#66BB6A');
            } else {
              return createGradient(ctx, chartArea, '#0D47A1', '#64B5F6');
            }
          }
          // Subtle gray gradient for remaining
          return createGradient(ctx, chartArea, '#BDBDBD', '#E0E0E0');
        },
        borderColor: '#ffffff',
        borderWidth: 3,
        hoverBorderWidth: 5,
        hoverOffset: 10,
      }],
    };
  };

  // Inventory Chart Data with Gradient
  const getInventoryChartData = () => {
    const { inStock, lowStock, outOfStock } = inventoryStats;

    return {
      labels: ['In Stock', 'Low Stock', 'Out of Stock'],
      datasets: [{
        label: 'Items',
        data: [inStock, lowStock, outOfStock],
        backgroundColor: (context) => {
          const chart = context.chart;
          const {ctx, chartArea} = chart;
          // Horizontal gradients for bar chart - left to right flow
          const gradients = [
            // In Stock: Rich green gradient
            createHorizontalGradient(ctx, chartArea, '#2E7D32', '#81C784'),
            // Low Stock: Amber/orange warning gradient
            createHorizontalGradient(ctx, chartArea, '#E65100', '#FFB74D'),
            // Out of Stock: Red danger gradient
            createHorizontalGradient(ctx, chartArea, '#B71C1C', '#EF5350')
          ];
          return gradients[context.dataIndex] || '#9E9E9E';
        },
        borderColor: '#ffffff',
        borderWidth: 2,
        borderRadius: 8,
      }],
    };
  };

  // Spares Inventory Chart Data - Only Low Stock and Out of Stock
  const getSparesInventoryChartData = () => {
    const { lowStock, outOfStock } = inventoryStats;

    return {
      labels: ['Out of Stock', 'Low Stock'],
      datasets: [{
        label: 'Items',
        data: [outOfStock, lowStock],
        backgroundColor: (context) => {
          const chart = context.chart;
          const {ctx, chartArea} = chart;
          // Horizontal gradients for bar chart - left to right flow
          const gradients = [
            // Out of Stock: Red gradient
            createHorizontalGradient(ctx, chartArea, '#B71C1C', '#EF5350'),
            // Low Stock: Orange gradient
            createHorizontalGradient(ctx, chartArea, '#E65100', '#FF9800')
          ];
          return gradients[context.dataIndex] || '#9E9E9E';
        },
        borderColor: '#ffffff',
        borderWidth: 2,
        borderRadius: 8,
      }],
    };
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: true,
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        enabled: true,
        backgroundColor: 'rgba(0, 0, 0, 0.85)',
        padding: 14,
        titleFont: {
          size: 15,
          weight: '600',
          family: "'Roboto', sans-serif",
        },
        bodyFont: {
          size: 14,
          family: "'Roboto', sans-serif",
        },
        callbacks: {
          title: function(context) {
            return context[0].label;
          },
          label: function(context) {
            const value = context.parsed || 0;
            const total = context.dataset.data.reduce((a, b) => a + b, 0);
            const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
            return `${value} • ${percentage}%`;
          },
        },
        displayColors: true,
        boxPadding: 8,
        cornerRadius: 8,
        titleColor: '#fff',
        bodyColor: '#fff',
      },
    },
    animation: {
      animateRotate: true,
      animateScale: true,
      duration: 1200,
      easing: 'easeOutQuart',
    },
    elements: {
      arc: {
        borderRadius: 12,
        spacing: 4,
      },
    },
  };

  const barChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: 'y',
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        enabled: true,
        backgroundColor: 'rgba(0, 0, 0, 0.85)',
        padding: 14,
        titleFont: {
          size: 15,
          weight: '600',
          family: "'Roboto', sans-serif",
        },
        bodyFont: {
          size: 14,
          family: "'Roboto', sans-serif",
        },
        callbacks: {
          label: function(context) {
            return `${context.parsed.x} items`;
          },
        },
        displayColors: true,
        boxPadding: 8,
        cornerRadius: 8,
        titleColor: '#fff',
        bodyColor: '#fff',
      },
    },
    scales: {
      x: {
        beginAtZero: true,
        max: 100,
        ticks: {
          font: {
            family: "'Roboto', sans-serif",
            size: 12,
          },
        },
        grid: {
          display: false,
        },
      },
      y: {
        ticks: {
          font: {
            family: "'Roboto', sans-serif",
            size: 12,
          },
        },
        grid: {
          display: false,
        },
      },
    },
    animation: {
      duration: 1200,
      easing: 'easeOutQuart',
    },
  };

  // Options for Grass Cutting/Panel Wash horizontal bar chart
  const trackerBarChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: 'y',
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        enabled: true,
        backgroundColor: 'rgba(0, 0, 0, 0.85)',
        padding: 14,
        titleFont: {
          size: 15,
          weight: '600',
          family: "'Roboto', sans-serif",
        },
        bodyFont: {
          size: 14,
          family: "'Roboto', sans-serif",
        },
        callbacks: {
          label: function(context) {
            return `${context.parsed.x.toFixed(1)}%`;
          },
        },
        displayColors: true,
        boxPadding: 8,
        cornerRadius: 8,
        titleColor: '#fff',
        bodyColor: '#fff',
      },
    },
    scales: {
      x: {
        beginAtZero: true,
        max: 100,
        ticks: {
          font: {
            family: "'Roboto', sans-serif",
            size: 12,
          },
          callback: function(value) {
            return value + '%';
          },
        },
        grid: {
          display: false,
        },
      },
      y: {
        ticks: {
          font: {
            family: "'Roboto', sans-serif",
            size: 12,
          },
        },
        grid: {
          display: false,
        },
      },
    },
    animation: {
      duration: 1200,
      easing: 'easeOutQuart',
    },
  };

  if (loading) {
    return <div className="loading">Loading dashboard...</div>;
  }

  return (
    <div className="dashboard-container">
      <div className="dashboard-header">
        <div className="dashboard-header-logo-slot">
          {companyLogo && (
            <img src={companyLogo} alt="Company Logo" className="dashboard-logo" />
          )}
        </div>
        <h2 className="dashboard-title">Dashboard</h2>
      </div>
      
      {/* Stat Cards */}
      <div className="dashboard-stats">
        <Link to="/tenant/tasks" className="card stat-card">
          <h3>Pending Tasks</h3>
          <p className="stat-number" style={{ color: '#ffc107' }}>
            {stats.pendingTasks}
          </p>
        </Link>
        <Link to="/tenant/tasks" className="card stat-card">
          <h3>In Progress</h3>
          <p className="stat-number" style={{ color: '#17a2b8' }}>
            {stats.inProgressTasks}
          </p>
        </Link>
        <Link to="/tenant/tasks" className="card stat-card">
          <h3>Completed</h3>
          <p className="stat-number" style={{ color: '#28a745' }}>
            {stats.completedTasks}
          </p>
        </Link>
        <Link to="/tenant/cm-letters" className="card stat-card">
          <h3>Open CM Letters</h3>
          <p className="stat-number" style={{ color: '#dc3545' }}>
            {stats.openCMLetters}
          </p>
        </Link>
      </div>

      {/* Main Dashboard Grid - 2x2 Layout */}
      <div className="dashboard-grid">
        {/* Row 1: PM Completion Rate and Grass Cutting Progress */}
        <div className="dashboard-row">
          {/* PM Completion Rate */}
          <div className="dashboard-card">
            <div className="card-header">
              <h3>PM Completion Rate</h3>
              <select 
                className="period-dropdown"
                value={pmPeriod}
                onChange={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setPmPeriod(e.target.value);
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
            </div>
            <div className="pm-chart-container">
              <div className="pm-chart-wrapper">
                <Doughnut
                  data={getPMChartData()}
                  options={{
                    ...chartOptions,
                    cutout: '65%',
                  }}
                />
                <div className="chart-center-text">
                  <div className="chart-percentage">
                    {pmStats.total > 0 ? ((pmStats.completed / pmStats.total) * 100).toFixed(0) : 0}%
                  </div>
                  <div className="chart-label">Complete</div>
                </div>
              </div>
              <div className="pm-stats-breakdown">
                <div className="pm-stat-item">
                  <div className="pm-stat-label">Completed</div>
                  <div className="pm-stat-value compact">{pmStats.completed}</div>
                  <div className="pm-stat-percentage">
                    {pmStats.total > 0 ? ((pmStats.completed / pmStats.total) * 100).toFixed(0) : 0}%
                  </div>
                </div>
                <div className="pm-stat-item">
                  <div className="pm-stat-label">Remaining</div>
                  <div className="pm-stat-value compact">{pmStats.total - pmStats.completed}</div>
                  <div className="pm-stat-percentage">
                    {pmStats.total > 0 ? (((pmStats.total - pmStats.completed) / pmStats.total) * 100).toFixed(0) : 0}%
                  </div>
                </div>
                <div className="pm-stat-item">
                  <div className="pm-stat-label">Total ({pmPeriod.charAt(0).toUpperCase() + pmPeriod.slice(1)})</div>
                  <div className="pm-stat-value compact">{pmStats.total}</div>
                </div>
              </div>
            </div>
            <div className="card-footer">
              <Link to="/tenant/tasks" className="view-button">View</Link>
            </div>
          </div>

          {/* Grass Cutting / Panel Wash Progress */}
          <div className="dashboard-card">
            <div className="card-header">
              <h3>Grass Cutting Progress</h3>
              <select 
                className="period-dropdown"
                value={trackerViewMode}
                onChange={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setTrackerViewMode(e.target.value);
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <option value="grass_cutting">Grass Cutting</option>
                <option value="panel_wash">Panel Wash</option>
              </select>
            </div>
            <div className="tracker-chart-container">
              <div className="tracker-chart-wrapper">
                <Doughnut
                  data={getTrackerChartData()}
                  options={{
                    ...chartOptions,
                    cutout: '65%',
                  }}
                />
                <div className="chart-center-text">
                  <div className="chart-percentage">
                    {(trackerViewMode === 'grass_cutting' ? grassCuttingProgress : panelWashProgress).toFixed(0)}%
                  </div>
                  <div className="chart-label">Progress</div>
                </div>
              </div>
            </div>
            <div className="card-footer">
              <Link to="/tenant/plant" className="view-button">View</Link>
            </div>
          </div>
        </div>

        {/* Row 2: Today's Activities and Spares Inventory Status */}
        <div className="dashboard-row">
          {/* Today's Activities */}
          <div className="dashboard-card daily-activities-card">
            <div className="card-header">
              <h3>Today's Activities</h3>
              <span className="today-datetime-inline">
                {currentTime.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                {' \u00B7 '}
                {currentTime.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
                {' '}
                {currentTime.getHours() < 12 ? 'AM' : 'PM'}
              </span>
            </div>
            <div className="daily-activities-list">
              {todayActivities.length === 0 ? (
                <div className="no-activities">No activities scheduled for today</div>
              ) : (
                <ul>
                  {todayActivities.map((activity, index) => {
                    const activityColor = activity.color || '#3498db';
                    return (
                      <li 
                        key={activity.id || index} 
                        className="activity-item"
                        style={{
                          borderLeftColor: activityColor,
                          borderLeftWidth: '4px'
                        }}
                      >
                        <div className="activity-title">
                          {activity.title || activity.event_name || 'Untitled Event'}
                          {activity.type === 'task' && activity.task_code && (
                            <span style={{ fontSize: '11px', color: '#666', marginLeft: '6px', fontFamily: 'monospace' }}>
                              ({activity.task_code})
                            </span>
                          )}
                        </div>
                        {activity.description && (
                          <div className="activity-description">{activity.description}</div>
                        )}
                        {activity.type === 'task' && activity.status && (
                          <div className="activity-status" style={{ 
                            fontSize: '11px', 
                            color: activity.status === 'completed' ? '#28a745' : 
                                   activity.status === 'in_progress' ? '#17a2b8' : '#ffc107',
                            fontWeight: '500',
                            marginTop: '2px'
                          }}>
                            {activity.status.charAt(0).toUpperCase() + activity.status.slice(1).replace('_', ' ')}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <div className="card-footer">
              <Link to="/tenant/calendar" className="view-button">View</Link>
            </div>
          </div>

          {/* Spares Inventory Status - Bar Chart */}
          <div className="dashboard-card spares-card">
            <div className="card-header">
              <h3>Spares Inventory Status</h3>
            </div>
            <div className="spares-chart-container">
              <Bar
                data={getSparesInventoryChartData()}
                options={{
                  ...barChartOptions,
                  scales: {
                    ...barChartOptions.scales,
                    x: {
                      ...barChartOptions.scales.x,
                      max: Math.max(
                        Math.ceil((inventoryStats.outOfStock + inventoryStats.lowStock) * 1.2),
                        10
                      ),
                    },
                  },
                }}
                plugins={[{
                  id: 'barValuePlugin',
                  afterDatasetsDraw: (chart) => {
                    const ctx = chart.ctx;
                    const meta = chart.getDatasetMeta(0);
                    
                    meta.data.forEach((bar, index) => {
                      const value = chart.data.datasets[0].data[index];
                      if (value > 0) {
                        const x = bar.x / 2;
                        const y = bar.y;
                        
                        ctx.save();
                        ctx.fillStyle = '#ffffff';
                        ctx.font = 'bold 13px Roboto, sans-serif';
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
                        ctx.shadowBlur = 2;
                        ctx.fillText(value.toString(), x, y);
                        ctx.restore();
                      }
                    });
                  }
                }]}
              />
            </div>
            <div className="card-footer">
              <Link to="/tenant/inventory" className="view-button">View</Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
