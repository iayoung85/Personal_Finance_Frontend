// Auto-detect backend URL based on current hostname and available backend

// Define global variable
var BACKEND_URL;
window.LOCAL_AUTO_LOGIN_ENABLED = false;

const DEV_SERVER_PORT = 5501;

function isLocalDevBackend(url) {
  try {
    const parsed = new URL(url);
    const isLoopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    return isLoopback && parseInt(parsed.port, 10) === DEV_SERVER_PORT;
  } catch (_ignored) {
    return false;
  }
}

function ensureLocalDevSession() {
  if (!window.LOCAL_AUTO_LOGIN_ENABLED) {
    return false;
  }

  const existingUser = localStorage.getItem('currentUser');
  if (!existingUser) {
    const devUser = {
      id: 1,
      user_id: 'user_1',
      email: 'iayoung8505@gmail.com',
      first_name: 'Isaac',
      last_name: 'Young'
    };
    localStorage.setItem('currentUser', JSON.stringify(devUser));
  }

  if (!localStorage.getItem('authToken')) {
    localStorage.setItem('authToken', 'local-dev');
  }
  if (!localStorage.getItem('refreshToken')) {
    localStorage.setItem('refreshToken', 'local-dev');
  }

  return true;
}

window.ensureLocalDevSession = ensureLocalDevSession;

function detectBackendUrl() {
  // Check for backend URL in query params (for ngrok demos)
  const urlParams = new URLSearchParams(window.location.search);
  const backendParam = urlParams.get('backend');
  if (backendParam) {
     return Promise.resolve(backendParam);
  }

  const hostname = window.location.hostname;
  // Try local ports if on localhost
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    const ports = [5501, 8000];
    let checked = 0;
    return new Promise((resolve) => {
      function tryNext() {
        if (checked >= ports.length) {
          // Fallback to production if none work (silent)
          resolve('https://lenient-present-terrapin.ngrok-free.app');
          return;
        }
        const url = `http://${hostname}:${ports[checked]}`;
        
        // Add timeout to prevent hanging (3 seconds)
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);
        
        fetch(`${url}/api/auth/health`, { signal: controller.signal, cache: 'no-cache' }).then(r => {
          clearTimeout(timeoutId);
          if (r.ok) {
            resolve(url);
          } else {
            checked++;
            tryNext();
          }
        }).catch((e) => {
          clearTimeout(timeoutId);
          checked++;
          tryNext();
        });
      }
      tryNext();
    });
  } else {
    // Production — backend is proxied through the permanent ngrok tunnel
    return Promise.resolve('https://lenient-present-terrapin.ngrok-free.app');
  }
}

// Usage: All scripts should wait for this promise to resolve before making API calls
window.BACKEND_URL_PROMISE = detectBackendUrl().then(url => {
  BACKEND_URL = url;
  window.BACKEND_URL = url;
  window.LOCAL_AUTO_LOGIN_ENABLED = isLocalDevBackend(url);
  window.ensureLocalDevSession();
  console.log('[Backend Detection] Using backend URL:', url);
  console.log('[Backend Detection] Local auto-login enabled:', window.LOCAL_AUTO_LOGIN_ENABLED);
  
  if (window.LOCAL_AUTO_LOGIN_ENABLED) {
    const s = document.createElement('script');
    s.src = 'dev-tools.js';
    s.onload = () => window.initDevTools && window.initDevTools();
    document.body.appendChild(s);
  }

  return url;
});

// ----------------------
// item_info client cache
// ----------------------
const ITEM_INFO_CACHE_KEY = 'itemInfoCache';
const ITEM_INFO_CACHE_TTL = 10; // seconds — kept ultra-short during development to avoid stale-data confusion

function _readItemInfoCache() {
  try {
    return JSON.parse(localStorage.getItem(ITEM_INFO_CACHE_KEY) || '{}');
  } catch (e) {
    return {};
  }
}

function _writeItemInfoCache(cache) {
  try {
    localStorage.setItem(ITEM_INFO_CACHE_KEY, JSON.stringify(cache));
  } catch (e) {
    console.warn('Failed to write itemInfoCache', e);
  }
}

async function fetchItemInfo(itemId, force = false) {
  if (!itemId) return null;
  const cache = _readItemInfoCache();
  const entry = cache[itemId];
  if (!force && entry && entry.cached_at) {
    const age = (Date.now() - entry.cached_at) / 1000;
    if (age < ITEM_INFO_CACHE_TTL) {
      return entry.data;
    }
  }

  // Not cached or expired — fetch from backend
  const resp = await fetch(`${BACKEND_URL}/api/connections/item_info`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ item_id: itemId })
  });

  if (!resp.ok) {
    // If server denies (cooldown) and we have a cached entry, return cached entry
    const errData = await resp.json().catch(() => ({}));
    if (entry && entry.data) return entry.data;
    throw new Error(errData.error || 'Failed to fetch item info');
  }

  const data = await resp.json();
  cache[itemId] = { data, cached_at: Date.now() };
  _writeItemInfoCache(cache);
  return data;
}

function invalidateItemInfoCache(itemId) {
  const cache = _readItemInfoCache();
  if (itemId) {
    delete cache[itemId];
  } else {
    // clear all
    for (const k in cache) delete cache[k];
  }
  _writeItemInfoCache(cache);
}

// Expose helpers globally
window.fetchItemInfo = fetchItemInfo;
window.invalidateItemInfoCache = invalidateItemInfoCache;
