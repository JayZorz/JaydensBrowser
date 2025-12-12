const { ipcRenderer } = require('electron');

const tabsContainer = document.getElementById('tabs-container');
const content = document.getElementById('content');
const address = document.getElementById('address');

let tabs = [];
let activeTab = null;

function safeGetURL(webview) {
  try { return webview.getURL(); } catch (e) { return ''; }
}

function createTab(startURL) {
  // DOM elements
  const tabEl = document.createElement('div');
  tabEl.className = 'tab';

  const titleSpan = document.createElement('span');
  titleSpan.className = 'title';
  titleSpan.textContent = 'New Tab';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'close';
  closeBtn.textContent = 'x';

  tabEl.appendChild(titleSpan);
  tabEl.appendChild(closeBtn);

  // webview
  const web = document.createElement('webview');
  web.setAttribute('partition', 'persist:main');
  web.src = startURL || 'homepage.html';
  web.style.display = 'none';

  // events: update title when page updates
  web.addEventListener('page-title-updated', (e) => {
    if (e && e.title) titleSpan.textContent = e.title;
  });

  // Update title based on file:// URLs (extract filename without extension)
  web.addEventListener('did-navigate', (e) => {
    if (activeTab && activeTab.web === web && e && e.url) {
      address.value = e.url;
      // If it's a file URL, extract filename without extension
      if (e.url.startsWith('file://')) {
        const fileMatch = e.url.match(/\/([^\/]+)$/);
        if (fileMatch) {
          const filename = fileMatch[1];
          const nameWithoutExt = filename.replace(/\.[^.]+$/, '');
          titleSpan.textContent = nameWithoutExt;
        }
      }
    }
  });
  web.addEventListener('did-navigate-in-page', (e) => {
    if (activeTab && activeTab.web === web && e && e.url) {
      address.value = e.url;
      // If it's a file URL, extract filename without extension
      if (e.url.startsWith('file://')) {
        const fileMatch = e.url.match(/\/([^\/]+)$/);
        if (fileMatch) {
          const filename = fileMatch[1];
          const nameWithoutExt = filename.replace(/\.[^.]+$/, '');
          titleSpan.textContent = nameWithoutExt;
        }
      }
    }
  });

  // dom-ready: ensure webview methods are available
  web.addEventListener('dom-ready', () => {
    // optional: enable devtools open if needed
    // web.openDevTools();
    // if this tab is active then show current URL
    if (activeTab && activeTab.web === web) {
      address.value = safeGetURL(web) || '';
    }
  });

  // append to DOM
  content.appendChild(web);
  tabsContainer.appendChild(tabEl);

  // tab object
  const tabObj = { tabEl, web, titleSpan };
  tabs.push(tabObj);

  // click to activate
  tabEl.addEventListener('click', () => activateTab(tabObj));

  // close button
  closeBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    closeTab(tabObj);
  });

  // immediately activate the new tab
  activateTab(tabObj);
  return tabObj;
}

function activateTab(tabObj) {
  // remove active class
  tabs.forEach(t => t.tabEl.classList.remove('active'));
  tabObj.tabEl.classList.add('active');

  // hide other webviews
  tabs.forEach(t => { t.web.style.display = 'none'; });

  // show the selected webview
  tabObj.web.style.display = 'flex';
  activeTab = tabObj;

  // update address bar safely
  try {
    address.value = safeGetURL(tabObj.web) || '';
  } catch (e) {
    address.value = '';
  }
}

function closeTab(tabObj) {
  try { tabObj.web.remove(); } catch (e) {}
  try { tabObj.tabEl.remove(); } catch (e) {}
  tabs = tabs.filter(t => t !== tabObj);
  if (tabs.length) activateTab(tabs[0]);
  else ipcRenderer.send('window-close'); // no tabs left, close app
}

/* Toolbar button wiring (defensive) */
const btnNew = document.getElementById('new-tab');
if (btnNew) btnNew.addEventListener('click', () => createTab('homepage.html'));

const btnBack = document.getElementById('back');
if (btnBack) btnBack.addEventListener('click', () => {
  if (activeTab && activeTab.web && typeof activeTab.web.canGoBack === 'function') {
    try { if (activeTab.web.canGoBack()) activeTab.web.goBack(); } catch (e) {}
  } else if (activeTab && activeTab.web) {
    try { activeTab.web.goBack(); } catch (e) {}
  }
});

const btnForward = document.getElementById('forward');
if (btnForward) btnForward.addEventListener('click', () => {
  if (activeTab && activeTab.web && typeof activeTab.web.canGoForward === 'function') {
    try { if (activeTab.web.canGoForward()) activeTab.web.goForward(); } catch (e) {}
  } else if (activeTab && activeTab.web) {
    try { activeTab.web.goForward(); } catch (e) {}
  }
});

const btnReload = document.getElementById('reload');
if (btnReload) btnReload.addEventListener('click', () => {
  if (activeTab && activeTab.web) {
    try { activeTab.web.reload(); } catch (e) {}
  }
});

/* Address bar enter -> loadURL */
if (address) {
  // Helper: determine whether a string resembles a URL and normalize it
  function isLikelyURL(input) {
    if (!input) return false;
    const s = String(input).trim();
    if (!s) return false;
    if (/\s/.test(s)) return false; // contains spaces -> search

    const schemeMatch = s.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
    if (schemeMatch) {
      const scheme = schemeMatch[1].toLowerCase();
      return ['http', 'https', 'ftp'].includes(scheme);
    }

    if (s.startsWith('//')) return true;

    const ipLike = /^(\d{1,3}\.){3}\d{1,3}(:\d+)?(\/.*)?$/;
    if (ipLike.test(s)) return true;

    const domainLike = /^([a-z0-9-]+\.)+[a-z]{2,24}(\/.*)?$/i;
    if (domainLike.test(s)) return true;

    return false;
  }

  function normalizeToUrl(input) {
    const s = String(input || '').trim();
    if (!s) return null;

    const schemeMatch = s.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
    if (schemeMatch) {
      const scheme = schemeMatch[1].toLowerCase();
      if (!['http', 'https', 'ftp', 'file'].includes(scheme)) return null;
      return s; // already a safe absolute URL (including file://)
    }

    // Detect local file paths (Windows: C:\path or Unix: /path)
    const isWindowsPath = /^[a-zA-Z]:[\\\/]/.test(s);
    const isUnixPath = s.startsWith('/');
    
    if (isWindowsPath || isUnixPath) {
      // Convert Windows backslashes to forward slashes for file:// URL
      const normalizedPath = s.replace(/\\/g, '/');
      // Ensure proper file:// URL format
      const fileUrl = isWindowsPath ? 'file:///' + normalizedPath : 'file://' + normalizedPath;
      return fileUrl;
    }

    if (s.startsWith('//')) return 'https:' + s;

    if (isLikelyURL(s)) return 'https://' + s;

    return null;
  }

  address.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !activeTab || !activeTab.web) return;
    e.preventDefault();

    let input = address.value.trim();
    if (!input) return;

    const maybe = normalizeToUrl(input);
    const destination = maybe || ('https://www.google.com/search?q=' + encodeURIComponent(input));

    try {
      // loadURL is supported on the webview element
      activeTab.web.loadURL(destination);
    } catch (err) {
      console.warn('loadURL failed', err, 'destination=', destination);
      try { activeTab.web.src = destination; } catch (e) { console.error('fallback src assignment failed', e); }
    }
  });
}

/* Titlebar buttons - safe wiring */
const elRes = document.getElementById('restart');
if (elRes) {
  elRes.addEventListener('click', () => {
    // Always request the main process to reload the BrowserWindow (reloads index.html)
    ipcRenderer.send('window-restart');
  });
}
const elMin = document.getElementById('minimize');
if (elMin) elMin.addEventListener('click', () => ipcRenderer.send('window-minimize'));
const elMax = document.getElementById('maximize');
if (elMax) elMax.addEventListener('click', () => ipcRenderer.send('window-maximize'));
const elClose = document.getElementById('close');
if (elClose) elClose.addEventListener('click', () => ipcRenderer.send('window-close'));

/* navigation from main (preload bridge) */
if (window.electronAPI && window.electronAPI.onNavigate) {
  window.electronAPI.onNavigate((url) => {
    if (activeTab && activeTab.web) {
      try { activeTab.web.loadURL(url); } catch (e) {}
    }
  });
}

/* Handle navigate-to-url from main process */
ipcRenderer.on('navigate-to-url', (e, url) => {
  if (activeTab && activeTab.web) {
    try { activeTab.web.loadURL(url); } catch (e) {}
  }
});

/* Create initial tab, defensive */
try {
  createTab('file:///C:/JaydensBrowser/homepage.html');
  url = "";
} catch (e) {
  console.error('Failed to create initial tab', e);
}