const repo = 'sirhans/Essentia-Duluth-CRNA-Scheduling-Tools';
const latestReleaseUrl = `https://github.com/${repo}/releases/latest`;
const apiUrl = `https://api.github.com/repos/${repo}/releases/latest`;

const macLink = document.getElementById('mac-download');
const windowsLink = document.getElementById('windows-download');
const releaseNote = document.getElementById('release-note');
const osMessage = document.getElementById('os-message');
const macBadge = macLink.querySelector('.rec-badge');
const windowsBadge = windowsLink.querySelector('.rec-badge');

const OS_NAMES = {
  mac: 'macOS',
  windows: 'Windows',
  ios: 'iOS',
  android: 'Android',
  linux: 'Linux',
  unknown: 'your device',
};

function detectOS(ua = navigator.userAgent || '', touchPoints = navigator.maxTouchPoints || 0) {
  if (/iPhone|iPod|iPad/i.test(ua)) return 'ios';
  if (/Macintosh/i.test(ua) && touchPoints > 1) return 'ios'; // iPadOS in desktop mode
  if (/Android/i.test(ua)) return 'android';
  if (/Windows/i.test(ua)) return 'windows';
  if (/Mac/i.test(ua)) return 'mac';
  if (/Linux|X11|CrOS/i.test(ua)) return 'linux';
  return 'unknown';
}

// Recommend the right installer for the detected OS; for unsupported devices,
// warn that only Mac and Windows are supported but still show both downloads.
function applyOsRecommendation(os = detectOS()) {
  macLink.classList.remove('recommended');
  windowsLink.classList.remove('recommended');
  macBadge.hidden = true;
  windowsBadge.hidden = true;
  osMessage.classList.remove('warning');

  if (os === 'mac' || os === 'windows') {
    const link = os === 'mac' ? macLink : windowsLink;
    const badge = os === 'mac' ? macBadge : windowsBadge;
    const file = os === 'mac' ? 'DMG installer' : 'EXE installer';
    link.classList.add('recommended');
    badge.hidden = false;
    osMessage.textContent = `We detected ${OS_NAMES[os]} — the ${file} below is recommended for your computer.`;
  } else {
    osMessage.classList.add('warning');
    osMessage.textContent =
      `This tool runs only on Mac and Windows — there isn't a build for ${OS_NAMES[os]}. ` +
      'You can still download either installer below to install on a Mac or Windows computer.';
  }
  osMessage.hidden = false;
}

applyOsRecommendation();

function assetFor(release, extension) {
  return release.assets.find((asset) =>
    asset.name.toLowerCase().endsWith(extension)
  );
}

fetch(apiUrl, { headers: { Accept: 'application/vnd.github+json' } })
  .then((response) => {
    if (!response.ok) throw new Error('No release available');
    return response.json();
  })
  .then((release) => {
    const macAsset = assetFor(release, '.dmg');
    const windowsAsset = assetFor(release, '.exe');

    if (macAsset) macLink.href = macAsset.browser_download_url;
    if (windowsAsset) windowsLink.href = windowsAsset.browser_download_url;

    releaseNote.textContent = `Latest release: ${release.tag_name}`;
  })
  .catch(() => {
    macLink.href = latestReleaseUrl;
    windowsLink.href = latestReleaseUrl;
    releaseNote.textContent = 'Release downloads will appear after the first published release.';
  });
