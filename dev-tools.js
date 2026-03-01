/**
 * Development Tools Panel
 * Injects a floating widget into the bottom-right corner of the screen
 * allowing developers to trigger backend seeding scenarios.
 * Only injected if window.LOCAL_AUTO_LOGIN_ENABLED is true.
 */

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
      { id: '3', name: '3: Mock Plaid Sync (3 Accounts)' }
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
}

// Injected via index.html or config.js when appropriate
window.initDevTools = function() {
  if (!document.getElementById('dev-tools-widget')) {
    new DevToolsWidget();
  }
};
