/**
 * Development Tools Panel
 * Injects a floating widget into the bottom-right corner of the screen
 * allowing developers to trigger backend seeding scenarios.
 * Only injected if window.LOCAL_AUTO_LOGIN_ENABLED is true.
 */

const DEV_METRICS_STORAGE_KEY = 'pf_dev_metrics_v1';

class DevMetricsTracker {
  constructor() {
    this.state = this._loadState();
  }

  _defaultState() {
    return {
      endpoint_hits: {},
      route_template_hits: {},
      module_hits: {},
      balance_history_cache_hits: 0,
      balance_history_network_hits: 0,
      full_history_calls: {
        transactions_full_history: 0,
        account_balance_history: 0,
      },
      total_network_hits: 0,
      updated_at: Date.now(),
    };
  }

  _loadState() {
    try {
      const rawState = localStorage.getItem(DEV_METRICS_STORAGE_KEY);
      if (!rawState) return this._defaultState();

      const parsedState = JSON.parse(rawState);
      if (!parsedState || typeof parsedState !== 'object') {
        return this._defaultState();
      }

      return {
        ...this._defaultState(),
        ...parsedState,
      };
    } catch (error) {
      console.debug('[DevMetrics] Failed to load state', error);
      return this._defaultState();
    }
  }

  _saveState() {
    try {
      this.state.updated_at = Date.now();
      localStorage.setItem(DEV_METRICS_STORAGE_KEY, JSON.stringify(this.state));
    } catch (error) {
      console.debug('[DevMetrics] Failed to save state', error);
    }
  }

  _normalizeEndpoint(url) {
    try {
      const parsedUrl = new URL(url, window.location.origin);
      return parsedUrl.pathname || url;
    } catch (_error) {
      const baseWithoutQuery = String(url || '').split('?')[0];
      return baseWithoutQuery || 'unknown_endpoint';
    }
  }

  _isDynamicSegment(segment) {
    if (!segment) return false;

    const dynamicPatterns = [
      /^\d+$/,
      /^[0-9a-f]{8,}$/i,
      /^(acc|manual|txn|bank|item|plaid|cat|bill|user)_[a-zA-Z0-9_-]+$/,
      /^[A-Za-z0-9_-]{16,}$/,
    ];

    return dynamicPatterns.some(pattern => pattern.test(segment));
  }

  _buildRouteTemplate(pathname) {
    const pathOnly = String(pathname || '').split('?')[0];
    const segments = pathOnly.split('/').filter(Boolean);
    if (segments.length === 0) {
      return '/';
    }

    const templateSegments = segments.map(segment => {
      return this._isDynamicSegment(segment) ? ':id' : segment;
    });

    return `/${templateSegments.join('/')}`;
  }

  _buildModuleBucket(pathname) {
    const pathOnly = String(pathname || '').split('?')[0];
    const segments = pathOnly.split('/').filter(Boolean);

    if (segments.length === 0) return '/';

    if (segments[0] === 'api' && segments[1]) {
      return `/api/${segments[1]}`;
    }

    return `/${segments[0]}`;
  }

  recordNetworkHit({ url, method = 'GET', status = null } = {}) {
    const endpointPath = this._normalizeEndpoint(url);
    const normalizedMethod = String(method || 'GET').toUpperCase();
    const routeTemplate = this._buildRouteTemplate(endpointPath);
    const moduleBucket = this._buildModuleBucket(endpointPath);
    const endpointKey = `${normalizedMethod} ${routeTemplate}`;
    const moduleKey = `${normalizedMethod} ${moduleBucket}`;

    this.state.endpoint_hits[endpointKey] = (this.state.endpoint_hits[endpointKey] || 0) + 1;
    this.state.route_template_hits[endpointKey] = (this.state.route_template_hits[endpointKey] || 0) + 1;
    this.state.module_hits[moduleKey] = (this.state.module_hits[moduleKey] || 0) + 1;
    this.state.total_network_hits += 1;
    this._saveState();

    return {
      endpoint: endpointKey,
      status,
      hits: this.state.endpoint_hits[endpointKey],
      module: moduleKey,
    };
  }

  recordBalanceHistoryCacheHit() {
    this.state.balance_history_cache_hits += 1;
    this._saveState();
  }

  recordBalanceHistoryNetworkHit() {
    this.state.balance_history_network_hits += 1;
    this._saveState();
  }

  recordFullHistoryCall(callType) {
    if (!callType) return;
    if (!this.state.full_history_calls || typeof this.state.full_history_calls !== 'object') {
      this.state.full_history_calls = {
        transactions_full_history: 0,
        account_balance_history: 0,
      };
    }

    if (typeof this.state.full_history_calls[callType] !== 'number') {
      this.state.full_history_calls[callType] = 0;
    }

    this.state.full_history_calls[callType] += 1;
    this._saveState();
  }

  _getTopHits(hitMap, limit = 10) {
    return Object.entries(hitMap || {})
      .sort((first, second) => second[1] - first[1])
      .slice(0, limit)
      .map(([label, hits], index) => ({
        rank: index + 1,
        label,
        hits,
      }));
  }

  getTopNetworkModules(limit = 10) {
    return this._getTopHits(this.state.module_hits, limit).map(entry => ({
      rank: entry.rank,
      module: entry.label,
      hits: entry.hits,
    }));
  }

  getTopRouteTemplates(limit = 10) {
    return this._getTopHits(this.state.route_template_hits, limit).map(entry => ({
      rank: entry.rank,
      route: entry.label,
      hits: entry.hits,
    }));
  }

  getSummary(limit = 10) {
    return {
      total_network_hits: this.state.total_network_hits,
      balance_history_cache_hits: this.state.balance_history_cache_hits,
      balance_history_network_hits: this.state.balance_history_network_hits,
      full_history_calls: {
        transactions_full_history: this.state.full_history_calls?.transactions_full_history || 0,
        account_balance_history: this.state.full_history_calls?.account_balance_history || 0,
      },
      top_modules: this.getTopNetworkModules(limit),
      top_route_templates: this.getTopRouteTemplates(limit),
      top_endpoints: this.getTopNetworkModules(limit),
      updated_at_iso: new Date(this.state.updated_at).toISOString(),
    };
  }

  printSummary(limit = 10) {
    const summary = this.getSummary(limit);
    console.groupCollapsed('[DevMetrics] Network Summary');
    console.log('Total network hits:', summary.total_network_hits);
    console.log('Balance history cache hits:', summary.balance_history_cache_hits);
    console.log('Balance history network hits:', summary.balance_history_network_hits);
    console.log('Full history calls:', summary.full_history_calls);
    console.log('Top modules:');
    console.table(summary.top_modules);
    console.log('Top route templates:');
    console.table(summary.top_route_templates);
    console.log('Updated at:', summary.updated_at_iso);
    console.groupEnd();
    return summary;
  }

  reset() {
    this.state = this._defaultState();
    this._saveState();
    return this.getSummary(10);
  }
}

if (!window.PFDevMetrics) {
  window.PFDevMetrics = new DevMetricsTracker();
}

window.printDevNetworkMetrics = function(limit = 10) {
  return window.PFDevMetrics.printSummary(limit);
};

window.resetDevNetworkMetrics = function() {
  return window.PFDevMetrics.reset();
};

class DevToolsWidget {
  constructor() {
    this.createWidget();
    this.attachEvents();
  }

  createWidget() {
    this.container = document.createElement('div');
    this.container.id = 'dev-tools-widget';
    
    // Core styling for the widget
    Object.assign(this.container.style, {
      position: 'fixed',
      bottom: '20px',
      right: '20px',
      width: '300px',
      backgroundColor: '#1e1e2d',
      color: '#fff',
      borderRadius: '8px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
      overflow: 'hidden',
      zIndex: '9999',
      fontFamily: 'monospace, sans-serif',
      fontSize: '12px'
    });

    const header = document.createElement('div');
    Object.assign(header.style, {
      padding: '10px',
      backgroundColor: '#2d2d44',
      cursor: 'pointer',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      fontWeight: 'bold',
      borderBottom: '1px solid #444'
    });
    header.innerHTML = `
      <span>🛠 Dev Scenarios</span>
      <span id="dev-tools-toggle">▼</span>
    `;

    this.body = document.createElement('div');
    Object.assign(this.body.style, {
      padding: '10px',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      maxHeight: '300px',
      overflowY: 'auto'
    });

    // --- Scenario Definitions ---
    const scenarios = [
      { id: '1', name: '1: Wipe DB (Clean State)' },
      { id: '2', name: '2: Plaid Re-link Ready (Manual Txns)' },
      { id: '3', name: '3: Mock Plaid Sync (3 Accounts)' },
      { id: '4', name: '4: Reconciliation Demo (Re-link Merge)' }
    ];

    scenarios.forEach(sc => {
      const btn = document.createElement('button');
      btn.innerText = sc.name;
      Object.assign(btn.style, {
        padding: '8px',
        backgroundColor: '#4c4c6d',
        color: '#fff',
        border: 'none',
        borderRadius: '4px',
        cursor: 'pointer',
        textAlign: 'left'
      });
      
      btn.onmouseover = () => btn.style.backgroundColor = '#64648c';
      btn.onmouseout = () => btn.style.backgroundColor = '#4c4c6d';
      
      btn.onclick = () => this.triggerScenario(sc.id, btn);
      this.body.appendChild(btn);
    });

    const metricsButton = document.createElement('button');
    metricsButton.innerText = '📊 Show Top 10 Modules';
    Object.assign(metricsButton.style, {
      padding: '8px',
      backgroundColor: '#3f6f52',
      color: '#fff',
      border: 'none',
      borderRadius: '4px',
      cursor: 'pointer',
      textAlign: 'left'
    });
    metricsButton.onclick = () => this.showMetrics();
    this.body.appendChild(metricsButton);

    const resetMetricsButton = document.createElement('button');
    resetMetricsButton.innerText = '♻️ Reset Network Metrics';
    Object.assign(resetMetricsButton.style, {
      padding: '8px',
      backgroundColor: '#6a4a4a',
      color: '#fff',
      border: 'none',
      borderRadius: '4px',
      cursor: 'pointer',
      textAlign: 'left'
    });
    resetMetricsButton.onclick = () => this.resetMetrics();
    this.body.appendChild(resetMetricsButton);

    this.metricsTables = document.createElement('div');
    Object.assign(this.metricsTables.style, {
      marginTop: '6px',
      display: 'none',
      flexDirection: 'column',
      gap: '8px',
    });
    this.body.appendChild(this.metricsTables);

    this.logs = document.createElement('div');
    Object.assign(this.logs.style, {
      marginTop: '10px',
      padding: '5px',
      backgroundColor: '#000',
      color: '#0f0',
      minHeight: '40px',
      borderRadius: '4px'
    });
    this.logs.innerText = 'Ready.';

    this.body.appendChild(this.logs);
    this.container.appendChild(header);
    this.container.appendChild(this.body);

    document.body.appendChild(this.container);

    this.isOpen = true;
    header.onclick = () => this.toggleBody();
  }

  toggleBody() {
    this.isOpen = !this.isOpen;
    this.body.style.display = this.isOpen ? 'flex' : 'none';
    document.getElementById('dev-tools-toggle').innerText = this.isOpen ? '▼' : '▲';
  }

  async triggerScenario(id, btnElement) {
    const originalText = btnElement.innerText;
    btnElement.innerText = 'Loading...';
    btnElement.disabled = true;
    this.log(`Triggering scenario ${id}...`);

    try {
      if (!window.BACKEND_URL) {
        throw new Error('BACKEND_URL not ready');
      }

      const res = await fetch(`${window.BACKEND_URL}/api/dev/seed-scenario/${id}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('authToken')}` // Just in case, though local bypass ignores it
        }
      });
      
      const data = await res.json();

      if (res.ok) {
        this.log(`Success: ${data.message}`);
        setTimeout(() => window.location.reload(), 1500);
      } else {
        this.log(`Error: ${data.error}`);
      }
    } catch (e) {
      this.log(`Fail: ${e.message}`);
    } finally {
      btnElement.innerText = originalText;
      btnElement.disabled = false;
    }
  }

  log(msg) {
    this.logs.innerText = msg;
    console.log(`[DevTools] ${msg}`);
  }

  showMetrics() {
    if (!window.PFDevMetrics) {
      this.log('Metrics tracker not available.');
      return;
    }

    const summary = window.PFDevMetrics.printSummary(10);
    this.renderMetricsTables(summary);
    const topModule = summary.top_modules[0];
    const topLabel = topModule
      ? `${topModule.module} (${topModule.hits})`
      : 'none';

    this.log(
      `Network ${summary.total_network_hits} | FullTx ${summary.full_history_calls.transactions_full_history} | FullLedger ${summary.full_history_calls.account_balance_history} | top: ${topLabel}`
    );
  }

  resetMetrics() {
    if (!window.PFDevMetrics) {
      this.log('Metrics tracker not available.');
      return;
    }

    window.PFDevMetrics.reset();
    this.metricsTables.style.display = 'none';
    this.metricsTables.innerHTML = '';
    this.log('Network metrics reset.');
  }

  renderMetricsTables(summary) {
    if (!this.metricsTables) return;

    this.metricsTables.innerHTML = '';

    const moduleCard = this._buildMetricsTableCard(
      'Top Modules',
      summary.top_modules || [],
      'module'
    );
    const routeCard = this._buildMetricsTableCard(
      'Top Route Templates',
      summary.top_route_templates || [],
      'route'
    );

    this.metricsTables.appendChild(moduleCard);
    this.metricsTables.appendChild(routeCard);
    this.metricsTables.style.display = 'flex';
  }

  _buildMetricsTableCard(title, rows, labelKey) {
    const wrapper = document.createElement('div');
    Object.assign(wrapper.style, {
      backgroundColor: '#111',
      border: '1px solid #333',
      borderRadius: '4px',
      overflow: 'hidden',
    });

    const heading = document.createElement('div');
    heading.textContent = title;
    Object.assign(heading.style, {
      padding: '6px 8px',
      backgroundColor: '#1f1f2e',
      borderBottom: '1px solid #333',
      fontWeight: 'bold',
      color: '#ddd',
    });
    wrapper.appendChild(heading);

    const table = document.createElement('table');
    Object.assign(table.style, {
      width: '100%',
      borderCollapse: 'collapse',
      tableLayout: 'fixed',
      fontSize: '11px',
    });

    const colgroup = document.createElement('colgroup');
    const rankCol = document.createElement('col');
    rankCol.style.width = '44px';
    const hitsCol = document.createElement('col');
    hitsCol.style.width = '56px';
    const labelCol = document.createElement('col');
    labelCol.style.width = 'auto';
    colgroup.appendChild(rankCol);
    colgroup.appendChild(hitsCol);
    colgroup.appendChild(labelCol);
    table.appendChild(colgroup);

    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    ['#', 'Hits', labelKey === 'route' ? 'Route' : 'Module'].forEach((headerText) => {
      const th = document.createElement('th');
      th.textContent = headerText;
      Object.assign(th.style, {
        textAlign: 'left',
        padding: '4px 6px',
        borderBottom: '1px solid #333',
        color: '#bbb',
        fontWeight: 'bold',
      });
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    const safeRows = rows.length > 0 ? rows : [{ rank: '-', hits: 0, [labelKey]: 'No data yet' }];
    safeRows.forEach((row, index) => {
      const tr = document.createElement('tr');
      tr.style.backgroundColor = index % 2 === 0 ? '#121212' : '#171717';

      const rankCell = document.createElement('td');
      rankCell.textContent = String(row.rank);
      rankCell.style.padding = '4px 6px';

      const hitsCell = document.createElement('td');
      hitsCell.textContent = String(row.hits);
      hitsCell.style.padding = '4px 6px';

      const labelCell = document.createElement('td');
      labelCell.textContent = String(row[labelKey] || '');
      Object.assign(labelCell.style, {
        padding: '4px 6px',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        color: '#eee',
      });

      tr.appendChild(rankCell);
      tr.appendChild(hitsCell);
      tr.appendChild(labelCell);
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    wrapper.appendChild(table);
    return wrapper;
  }
}

// Injected via index.html or config.js when appropriate
window.initDevTools = function() {
  if (!document.getElementById('dev-tools-widget')) {
    new DevToolsWidget();
  }
};
