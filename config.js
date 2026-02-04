// Auto-detect backend URL based on current hostname and available backend

// Define global variable
var BACKEND_URL;

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
    const ports = [8000, 3000];
    let checked = 0;
    return new Promise((resolve) => {
      function tryNext() {
        if (checked >= ports.length) {
          // Fallback to production if none work (silent)
          resolve('https://pythonplaidbackend-iayfinancialprod.up.railway.app');
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
  } else if (hostname.includes('ngrok')) {
    // If running on ngrok (likely demo mode), check if current origin serves the API
    const origin = window.location.origin;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    
    return fetch(`${origin}/api/auth/health`, { signal: controller.signal, cache: 'no-cache' })
      .then(r => {
        clearTimeout(timeoutId);
        if (r.ok) return origin;
        // Fallback or likely misconfigured if ngrok is used without backend
        return 'https://pythonplaidbackend-iayfinancialprod.up.railway.app';
      })
      .catch(() => 'https://pythonplaidbackend-iayfinancialprod.up.railway.app');
  } else {
    // Production
    return Promise.resolve('https://pythonplaidbackend-iayfinancialprod.up.railway.app');
  }
}

// Usage: All scripts should wait for this promise to resolve before making API calls
window.BACKEND_URL_PROMISE = detectBackendUrl().then(url => {
  BACKEND_URL = url;
  window.BACKEND_URL = url;
  return url;
});
