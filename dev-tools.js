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

/**
 * Console-level helpers for manually verifying surgical balance history patches.
 *
 * Usage pattern:
 *   pfBalancePatchTest.arm()           // before performing an action in the UI
 *   // ... do the action (create/edit/delete txn, mark-paid, etc.) ...
 *   pfBalancePatchTest.check()         // PASS = no full-ledger fetch fired
 *   pfBalancePatchTest.inspectCache()  // dump the localStorage balance cache
 *   pfBalancePatchTest.clearCache()    // wipe balance history cache to force fresh state
 */
window.pfBalancePatchTest = (function() {
  let _baseline = undefined;

  return {
    arm() {
      const metrics = window.PFDevMetrics ? window.PFDevMetrics.getSummary() : null;
      _baseline = metrics ? metrics.full_history_calls.account_balance_history : 0;
      const lookupSize = typeof balanceHistoryLookup !== 'undefined'
        ? Object.keys(balanceHistoryLookup).length : '?';
      console.log(
        `[PatchTest] Armed.\n  Baseline full-ledger fetches: ${_baseline}\n  Current lookup entries: ${lookupSize}`
      );
    },

    check() {
      if (_baseline === undefined) {
        console.warn('[PatchTest] Call arm() first, then perform your action.');
        return;
      }
      const metrics = window.PFDevMetrics ? window.PFDevMetrics.getSummary() : null;
      const nowCount = metrics ? metrics.full_history_calls.account_balance_history : 0;
      const delta = nowCount - _baseline;
      const lookupSize = typeof balanceHistoryLookup !== 'undefined'
        ? Object.keys(balanceHistoryLookup).length : '?';
      const result = delta === 0 ? 'PASS ✅' : `FAIL ❌ (${delta} full fetch(es) triggered)`;
      console.log(
        `[PatchTest] ${result}\n  Full-ledger fetches: ${_baseline} → ${nowCount}\n  In-memory lookup entries: ${lookupSize}`
      );
      _baseline = undefined;
      return delta === 0;
    },

    inspectCache(accountId) {
      const targetId = accountId
        || (typeof selectedAccountId !== 'undefined' ? selectedAccountId : null);
      try {
        const raw = localStorage.getItem('pf_balance_history_by_account');
        const cache = raw ? JSON.parse(raw) : {};
        if (targetId && cache[targetId]) {
          const entry = cache[targetId];
          const ageMs = Date.now() - Number(entry.cached_at || 0);
          console.log('[PatchTest] Balance cache for', targetId, {
            entries: Object.keys(entry.lookup || {}).length,
            age_seconds: Math.round(ageMs / 1000),
            signature: entry.signature || '(none)',
            sample: Object.entries(entry.lookup || {}).slice(0, 10),
          });
        } else {
          console.log('[PatchTest] Full cache (all accounts):', cache);
        }
        if (typeof balanceHistoryLookup !== 'undefined') {
          console.log('[PatchTest] In-memory lookup entries:', Object.keys(balanceHistoryLookup).length);
        }
      } catch (err) {
        console.error('[PatchTest] inspectCache error:', err);
      }
    },

    clearCache() {
      localStorage.removeItem('pf_balance_history_by_account');
      if (typeof balanceHistoryLookup !== 'undefined') {
        Object.keys(balanceHistoryLookup).forEach(k => delete balanceHistoryLookup[k]);
      }
      console.log('[PatchTest] Balance history cache cleared. Next action will force a full fetch.');
    },
  };
})();

class DevToolsWidget {
  constructor() {
    this.createWidget();
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
      <span id="dev-tools-toggle">▲</span>
    `;

    this.body = document.createElement('div');
    Object.assign(this.body.style, {
      padding: '10px',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      maxHeight: '500px',
      overflowY: 'auto'
    });

    // --- Scenario Definitions ---
    const scenarios = [
      { id: '1', name: '1: Wipe DB (Clean State)' },
      { id: '2', name: '2: Plaid Re-link Ready (Manual Txns)' },
      { id: '3', name: '3: Mock Plaid Sync (3 Accounts)' },
      { id: '4', name: '4: Reconciliation Demo (Re-link Merge)' },
      { id: '6', name: '6: Bill Resolution (BILL_MISSING + Ledger)' },
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

    // --- Scenario 5: Populate manual txns with account picker ---
    this._buildScenario5Section();

    // --- Webhook Simulator ---
    this._buildWebhookSection();

    // --- Balance Patch Tests ---
    this._buildBalancePatchTestSection();

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

    this.isOpen = false;
    this.body.style.display = 'none';
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

  _buildScenario5Section() {
    const wrapper = document.createElement('div');
    Object.assign(wrapper.style, {
      display: 'flex',
      flexDirection: 'column',
      gap: '4px',
      borderTop: '1px solid #444',
      paddingTop: '8px',
      marginTop: '4px',
    });

    const label = document.createElement('span');
    label.textContent = '5: Populate Manual Txns';
    Object.assign(label.style, {
      fontWeight: 'bold',
      fontSize: '11px',
      color: '#ccc',
    });
    wrapper.appendChild(label);

    this.scenario5Select = document.createElement('select');
    Object.assign(this.scenario5Select.style, {
      padding: '6px',
      backgroundColor: '#2a2a3d',
      color: '#fff',
      border: '1px solid #555',
      borderRadius: '4px',
      fontSize: '11px',
    });

    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = '(Create new account)';
    this.scenario5Select.appendChild(defaultOption);

    const loadingOption = document.createElement('option');
    loadingOption.value = '__loading__';
    loadingOption.textContent = 'Loading accounts...';
    loadingOption.disabled = true;
    this.scenario5Select.appendChild(loadingOption);

    wrapper.appendChild(this.scenario5Select);

    const goButton = document.createElement('button');
    goButton.innerText = '5: Add 12 Sample Txns';
    Object.assign(goButton.style, {
      padding: '8px',
      backgroundColor: '#4a6a4c',
      color: '#fff',
      border: 'none',
      borderRadius: '4px',
      cursor: 'pointer',
      textAlign: 'left',
    });
    goButton.onmouseover = () => goButton.style.backgroundColor = '#5c8c5e';
    goButton.onmouseout = () => goButton.style.backgroundColor = '#4a6a4c';
    goButton.onclick = () => this._triggerScenario5(goButton);
    wrapper.appendChild(goButton);

    this.body.appendChild(wrapper);

    this._loadAccountsForScenario5();
  }

  async _loadAccountsForScenario5() {
    try {
      if (!window.BACKEND_URL) return;

      const response = await fetch(`${window.BACKEND_URL}/api/dev/accounts`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('authToken')}`,
        },
      });

      if (!response.ok) return;

      const accounts = await response.json();

      // Remove the "Loading accounts..." placeholder
      const loadingPlaceholder = this.scenario5Select.querySelector('option[value="__loading__"]');
      if (loadingPlaceholder) loadingPlaceholder.remove();

      accounts.forEach(account => {
        const option = document.createElement('option');
        option.value = account.account_id;
        option.textContent = account.label;
        this.scenario5Select.appendChild(option);
      });
    } catch (fetchError) {
      console.debug('[DevTools] Failed to load accounts for S5:', fetchError);
    }
  }

  async _triggerScenario5(btnElement) {
    const originalText = btnElement.innerText;
    btnElement.innerText = 'Loading...';
    btnElement.disabled = true;

    const selectedAccountId = this.scenario5Select.value;
    const queryString = selectedAccountId
      ? `?target_account_id=${encodeURIComponent(selectedAccountId)}`
      : '';

    this.log('Populating transactions...');

    try {
      if (!window.BACKEND_URL) {
        throw new Error('BACKEND_URL not ready');
      }

      const response = await fetch(
        `${window.BACKEND_URL}/api/dev/seed-scenario/5${queryString}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('authToken')}`,
          },
        }
      );

      const data = await response.json();

      if (response.ok) {
        this.log(`Success: ${data.message}`);
        setTimeout(() => window.location.reload(), 1500);
      } else {
        this.log(`Error: ${data.error}`);
      }
    } catch (triggerError) {
      this.log(`Fail: ${triggerError.message}`);
    } finally {
      btnElement.innerText = originalText;
      btnElement.disabled = false;
    }
  }

  _buildWebhookSection() {
    const wrapper = document.createElement('div');
    Object.assign(wrapper.style, {
      display: 'flex',
      flexDirection: 'column',
      gap: '4px',
      borderTop: '1px solid #444',
      paddingTop: '8px',
      marginTop: '4px',
    });

    const label = document.createElement('span');
    label.textContent = '⚡ Webhook Simulator';
    Object.assign(label.style, {
      fontWeight: 'bold',
      fontSize: '11px',
      color: '#ccc',
    });
    wrapper.appendChild(label);

    this.webhookItemSelect = document.createElement('select');
    Object.assign(this.webhookItemSelect.style, {
      padding: '6px',
      backgroundColor: '#2a2a3d',
      color: '#fff',
      border: '1px solid #555',
      borderRadius: '4px',
      fontSize: '11px',
    });

    const placeholderOption = document.createElement('option');
    placeholderOption.value = '';
    placeholderOption.textContent = 'Select a Plaid item...';
    placeholderOption.disabled = true;
    placeholderOption.selected = true;
    this.webhookItemSelect.appendChild(placeholderOption);

    const loadingOption = document.createElement('option');
    loadingOption.value = '__loading__';
    loadingOption.textContent = 'Loading items...';
    loadingOption.disabled = true;
    this.webhookItemSelect.appendChild(loadingOption);

    wrapper.appendChild(this.webhookItemSelect);

    const webhookButtons = [
      {
        label: 'Txn Sync (SYNC_UPDATES_AVAILABLE)',
        color: '#4a6a4c',
        hoverColor: '#5c8c5e',
        payload: (itemId) => ({
          webhook_type: 'TRANSACTIONS',
          webhook_code: 'SYNC_UPDATES_AVAILABLE',
          item_id: itemId,
          historical_update_complete: true,
        }),
      },
      {
        label: 'Holdings Sync (DEFAULT_UPDATE)',
        color: '#4a5a6a',
        hoverColor: '#5c7a8e',
        payload: (itemId) => ({
          webhook_type: 'INVESTMENTS',
          webhook_code: 'DEFAULT_UPDATE',
          item_id: itemId,
        }),
      },
      {
        label: 'Item Error (LOGIN_REQUIRED)',
        color: '#6a4a4a',
        hoverColor: '#8c5c5c',
        payload: (itemId) => ({
          webhook_type: 'ITEM',
          webhook_code: 'ERROR',
          item_id: itemId,
          error: {
            error_code: 'ITEM_LOGIN_REQUIRED',
            error_message: 'the login details have changed',
          },
        }),
      },
    ];

    webhookButtons.forEach(({ label: buttonLabel, color, hoverColor, payload }) => {
      const btn = document.createElement('button');
      btn.innerText = buttonLabel;
      Object.assign(btn.style, {
        padding: '8px',
        backgroundColor: color,
        color: '#fff',
        border: 'none',
        borderRadius: '4px',
        cursor: 'pointer',
        textAlign: 'left',
        fontSize: '11px',
      });
      btn.onmouseover = () => btn.style.backgroundColor = hoverColor;
      btn.onmouseout = () => btn.style.backgroundColor = color;
      btn.onclick = () => this._fireWebhook(btn, payload);
      wrapper.appendChild(btn);
    });

    this.body.appendChild(wrapper);
    this._loadPlaidItems();
  }

  async _loadPlaidItems() {
    try {
      if (!window.BACKEND_URL) {
        console.log('[DevTools] BACKEND_URL not set');
        return;
      }

      const response = await fetch(`${window.BACKEND_URL}/api/connections/items`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('authToken')}`,
        },
      });

      if (!response.ok) return;

      let items = await response.json();

      // Normalize common API response shapes to an array so `.forEach` is safe.
      if (!Array.isArray(items)) {
        if (items && Array.isArray(items.items)) {
          items = items.items;
        } else if (items && Array.isArray(items.data)) {
          items = items.data;
        } else {
          console.debug('[DevTools] Unexpected items response shape:', items);
          items = [];
        }
      }

      const loadingPlaceholder = this.webhookItemSelect.querySelector('option[value="__loading__"]');
      if (loadingPlaceholder) loadingPlaceholder.remove();

      items.forEach(item => {
        const option = document.createElement('option');
        option.value = item.plaid_item_id;
        option.textContent = `${item.institution_name || 'Unknown'} (${item.status || '?'})`;
        this.webhookItemSelect.appendChild(option);
      });

      if (items.length === 0) {
        const emptyOption = document.createElement('option');
        emptyOption.value = '';
        emptyOption.textContent = 'No Plaid items found';
        emptyOption.disabled = true;
        this.webhookItemSelect.appendChild(emptyOption);
      }
    } catch (fetchError) {
      console.debug('[DevTools] Failed to load Plaid items:', fetchError);
    }
  }

  async _fireWebhook(btnElement, buildPayload) {
    const selectedItemId = this.webhookItemSelect.value;
    if (!selectedItemId || selectedItemId === '__loading__') {
      this.log('Pick a Plaid item first.');
      return;
    }

    const originalText = btnElement.innerText;
    btnElement.innerText = 'Firing...';
    btnElement.disabled = true;

    const payload = buildPayload(selectedItemId);
    this.log(`Firing ${payload.webhook_type}/${payload.webhook_code}...`);

    try {
      if (!window.BACKEND_URL) {
        throw new Error('BACKEND_URL not ready');
      }

      const response = await fetch(`${window.BACKEND_URL}/api/connections/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (response.ok) {
        this.log(`${payload.webhook_code}: ${data.message || data.status}`);
      } else {
        this.log(`Error ${response.status}: ${data.error || 'unknown'}`);
      }
    } catch (fireError) {
      this.log(`Fail: ${fireError.message}`);
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

  // ─── Balance Patch Test Section ───────────────────────────────────────
  // Arm before performing a ledger-mutating action (create/edit/delete manual
  // txn, mark-paid on BILL_MISSING, dismiss BILL_MISSING).  Then "Check Result"
  // to confirm that no full account-balance-history fetch was triggered —
  // meaning the surgical _patchBalanceHistoryCache() path fired correctly.
  _buildBalancePatchTestSection() {
    const wrapper = document.createElement('div');
    Object.assign(wrapper.style, {
      display: 'flex',
      flexDirection: 'column',
      gap: '4px',
      borderTop: '1px solid #444',
      paddingTop: '8px',
      marginTop: '4px',
    });

    const label = document.createElement('span');
    label.textContent = '🧪 Ledger Patch Monitor';
    Object.assign(label.style, {
      fontWeight: 'bold',
      fontSize: '11px',
      color: '#ccc',
    });
    wrapper.appendChild(label);

    const hint = document.createElement('span');
    hint.textContent = 'Arm → perform action in UI → Check';
    Object.assign(hint.style, { fontSize: '10px', color: '#888' });
    wrapper.appendChild(hint);

    // Status display
    this._patchTestStatus = document.createElement('div');
    this._patchTestStatus.textContent = '⬜ Not armed';
    Object.assign(this._patchTestStatus.style, {
      padding: '4px 6px',
      backgroundColor: '#111',
      borderRadius: '3px',
      fontSize: '11px',
      color: '#888',
      minHeight: '18px',
    });
    wrapper.appendChild(this._patchTestStatus);

    const btnRow = document.createElement('div');
    Object.assign(btnRow.style, { display: 'flex', gap: '4px' });

    const armBtn = document.createElement('button');
    armBtn.textContent = '🎯 Arm';
    const checkBtn = document.createElement('button');
    checkBtn.textContent = '✅ Check Result';
    const inspectBtn = document.createElement('button');
    inspectBtn.textContent = '🔍 Inspect Cache';

    [armBtn, checkBtn, inspectBtn].forEach(btn => {
      Object.assign(btn.style, {
        flex: '1',
        padding: '6px 4px',
        backgroundColor: '#3a3a55',
        color: '#fff',
        border: 'none',
        borderRadius: '4px',
        cursor: 'pointer',
        fontSize: '10px',
      });
      btn.onmouseover = () => btn.style.backgroundColor = '#50508a';
      btn.onmouseout = () => btn.style.backgroundColor = '#3a3a55';
    });

    armBtn.onclick = () => this._armPatchTest();
    checkBtn.onclick = () => this._checkPatchTest();
    inspectBtn.onclick = () => this._inspectBalanceCache();

    btnRow.appendChild(armBtn);
    btnRow.appendChild(checkBtn);
    btnRow.appendChild(inspectBtn);
    wrapper.appendChild(btnRow);

    this.body.appendChild(wrapper);
  }

  _armPatchTest() {
    const metrics = window.PFDevMetrics ? window.PFDevMetrics.getSummary() : null;
    const baseCount = metrics ? metrics.full_history_calls.account_balance_history : 0;
    const lookupSize = (typeof balanceHistoryLookup !== 'undefined')
      ? Object.keys(balanceHistoryLookup).length
      : '?';
    this._patchTestBaseline = baseCount;
    this._patchTestStatus.textContent = `🎯 Armed — full-ledger fetches: ${baseCount} | lookup entries: ${lookupSize}`;
    Object.assign(this._patchTestStatus.style, { color: '#f5c842' });
    this.log(`Patch test armed. Baseline full-ledger fetches: ${baseCount}`);
  }

  _checkPatchTest() {
    if (this._patchTestBaseline === undefined) {
      this._patchTestStatus.textContent = '⚠️ Arm first, then perform your action';
      Object.assign(this._patchTestStatus.style, { color: '#f5a623' });
      return;
    }
    const metrics = window.PFDevMetrics ? window.PFDevMetrics.getSummary() : null;
    const nowCount = metrics ? metrics.full_history_calls.account_balance_history : 0;
    const delta = nowCount - this._patchTestBaseline;
    const lookupSize = (typeof balanceHistoryLookup !== 'undefined')
      ? Object.keys(balanceHistoryLookup).length
      : '?';

    if (delta === 0) {
      this._patchTestStatus.textContent = `✅ PASS — no full-ledger fetch triggered | lookup entries: ${lookupSize}`;
      Object.assign(this._patchTestStatus.style, { color: '#4caf50' });
      this.log('Patch test PASS — surgical update fired correctly.');
    } else {
      this._patchTestStatus.textContent = `❌ FAIL — ${delta} full-ledger fetch(es) triggered | lookup: ${lookupSize}`;
      Object.assign(this._patchTestStatus.style, { color: '#f44336' });
      this.log(`Patch test FAIL: ${delta} full fetch(es) after action (expected 0).`);
    }
    this._patchTestBaseline = undefined;
  }

  _inspectBalanceCache() {
    const accountId = (typeof selectedAccountId !== 'undefined') ? selectedAccountId : null;
    try {
      const raw = localStorage.getItem('pf_balance_history_by_account');
      const cache = raw ? JSON.parse(raw) : {};

      if (accountId && cache[accountId]) {
        const entry = cache[accountId];
        const entryCount = Object.keys(entry.lookup || {}).length;
        const ageMs = Date.now() - Number(entry.cached_at || 0);
        const ageSec = Math.round(ageMs / 1000);
        this._patchTestStatus.textContent = `🔍 acct: ${entryCount} entries, ${ageSec}s old`;
        console.log('[DevTools] Balance cache for', accountId, {
          entries: entryCount,
          age_seconds: ageSec,
          signature: entry.signature || '(none)',
          sample: Object.entries(entry.lookup || {}).slice(0, 5),
        });
      } else {
        const accountCount = Object.keys(cache).length;
        this._patchTestStatus.textContent = `🔍 ${accountCount} account(s) in cache — no active acct`;
        console.log('[DevTools] Full balance history cache:', cache);
      }

      const lookupSize = (typeof balanceHistoryLookup !== 'undefined')
        ? Object.keys(balanceHistoryLookup).length : 0;
      this.log(`Cache inspected — in-memory lookup: ${lookupSize} entries. See console.`);
    } catch (err) {
      this.log(`Inspect failed: ${err.message}`);
    }
  }
}

// Injected via index.html or config.js when appropriate
window.initDevTools = function() {
  if (!document.getElementById('dev-tools-widget')) {
    new DevToolsWidget();
  }
};
