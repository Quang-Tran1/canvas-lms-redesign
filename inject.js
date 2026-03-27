const link = document.createElement('link');
link.href = chrome.runtime.getURL('styles.css');
link.type = 'text/css';
link.rel = 'stylesheet';

document.documentElement.appendChild(link);