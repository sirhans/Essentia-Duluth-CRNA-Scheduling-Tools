/* global XLSX */
'use strict';

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
const tableWrap = document.getElementById('table-wrap');
const thead = document.getElementById('thead');
const tbody = document.getElementById('tbody');
const errorBox = document.getElementById('error');
const fileMeta = document.getElementById('file-meta');
const statusEl = document.getElementById('status');
const resetBtn = document.getElementById('reset-btn');
const checkUpdatesBtn = document.getElementById('check-updates');
const reduceBtn = document.getElementById('reduce-hours');
const exportBtn = document.getElementById('export-xlsx');

const VALID_EXT = /\.(xlsx|xls|csv)$/i;
const NO_FILE_LABEL = 'No file loaded.';

// Day columns per spec: spreadsheet columns B–H and J–P
// (0-based array indices 1..7 and 9..15). Column I (8) is skipped.
const DAY_COLS = [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15];
const START_HOURS = 80;

// Fixed canonical layout: Mondays are columns B & J, Fridays are F & N.
const MONDAY_COLS = [1, 9];
const FRIDAY_COLS = [5, 13];
const WEEKEND_COLS = [6, 7, 14, 15];
// Expected day-of-week label (lowercased) for each day column, used to validate
// that an imported file matches the canonical layout.
const EXPECTED_DAYS = {
  1: 'mon', 2: 'tues', 3: 'wed', 4: 'thur', 5: 'fri', 6: 'sat', 7: 'sun',
  9: 'mon', 10: 'tues', 11: 'wed', 12: 'thur', 13: 'fri', 14: 'sat', 15: 'sun',
};

// originalRows: the data as loaded (never mutated). rows: working copy that the
// reduction operates on. changed: Set of "r:c" keys for cells to show in red.
const state = {
  originalRows: null,
  rows: null,
  sheetName: '',
  fileName: '',
  changed: new Set(),
  shortRows: new Set(), // schedule rows that could not reach target
  layoutValid: true,
  headerRow: -1,
};

function key(r, c) {
  return r + ':' + c;
}

function cloneRows(rows) {
  return rows.map((r) => r.slice());
}

function rowHasContent(row) {
  return row.some((cell) => String(cell == null ? '' : cell).trim() !== '');
}

// Parse a cell to a number, or NaN if it isn't purely numeric.
function numericValue(v) {
  if (v === null || v === undefined || v === '') return NaN;
  return Number(String(v).trim());
}

// Hours actually worked in a cell. Empty cells, "x", and 0 all count as not
// worked (0 hours); only a positive number counts.
function workedHours(v) {
  const n = numericValue(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function norm(v) {
  return String(v == null ? '' : v).trim().toLowerCase();
}

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Find the row whose day columns (B–H, J–P) exactly match the canonical
// Mon–Sun labels for both weeks. Returns its index, or -1 if none.
function findHeaderRow(rows) {
  for (let r = 0; r < rows.length; r++) {
    if (DAY_COLS.every((c) => norm(rows[r][c]) === EXPECTED_DAYS[c])) return r;
  }
  return -1;
}

// Build a human-readable explanation of why a file's layout isn't recognized,
// pointing at the most header-like row and listing the mismatched columns.
function layoutMismatchMessage(rows) {
  let best = -1;
  let bestScore = -1;
  for (let r = 0; r < rows.length; r++) {
    let score = 0;
    for (const c of DAY_COLS) if (norm(rows[r][c]) === EXPECTED_DAYS[c]) score++;
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  if (best < 0 || bestScore === 0) {
    return (
      'Unrecognized layout: could not find the expected day header ' +
      '(Mon, Tues, Wed, Thur, Fri, Sat, Sun across columns B–H and J–P). ' +
      'This file does not match the canonical schedule format.'
    );
  }
  const diffs = DAY_COLS.filter((c) => norm(rows[best][c]) !== EXPECTED_DAYS[c])
    .slice(0, 6)
    .map((c) => `${colLabel(c)} should be "${cap(EXPECTED_DAYS[c])}" but is "${rows[best][c] || ''}"`);
  return `Unrecognized layout in the day header (row ${best + 1}): ${diffs.join('; ')}.`;
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.style.display = 'block';
}

function clearError() {
  errorBox.textContent = '';
  errorBox.style.display = 'none';
}

function resetView() {
  clearError();
  thead.innerHTML = '';
  tbody.innerHTML = '';
  tableWrap.style.display = 'none';
  resetBtn.style.display = 'none';
  dropzone.classList.remove('hidden');
  fileMeta.textContent = NO_FILE_LABEL;
  statusEl.textContent = 'Ready';
  state.originalRows = null;
  state.rows = null;
  state.changed.clear();
  state.shortRows.clear();
  state.layoutValid = true;
  state.headerRow = -1;
  reduceBtn.disabled = true;
  exportBtn.disabled = true;
}

// Convert a column index (0-based) to a spreadsheet column label (A, B, ... AA).
function colLabel(index) {
  let label = '';
  let n = index;
  while (n >= 0) {
    label = String.fromCharCode((n % 26) + 65) + label;
    n = Math.floor(n / 26) - 1;
  }
  return label;
}

// Render state.rows as a table. The first row is the header; ragged rows are
// padded to the widest row. Cells in state.changed are marked as reduced (red).
function renderTable() {
  const rows = state.rows || [];
  thead.innerHTML = '';
  tbody.innerHTML = '';

  const colCount = rows.reduce((max, r) => Math.max(max, r.length), 0);

  // Header row: the spreadsheet's first row, plus a leading row-number column.
  const headerRow = document.createElement('tr');
  const corner = document.createElement('th');
  corner.className = 'rownum';
  headerRow.appendChild(corner);

  const firstRow = rows[0] || [];
  for (let c = 0; c < colCount; c++) {
    const th = document.createElement('th');
    const value = firstRow[c];
    th.textContent = value === undefined || value === null ? colLabel(c) : String(value);
    if (state.changed.has(key(0, c))) th.classList.add('reduced');
    th.title = th.textContent;
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);

  // Body rows (everything after the header row).
  const frag = document.createDocumentFragment();
  for (let r = 1; r < rows.length; r++) {
    const tr = document.createElement('tr');
    if (state.shortRows.has(r)) tr.classList.add('short-row');
    const rn = document.createElement('td');
    rn.className = 'rownum';
    rn.textContent = String(r + 1); // 1-based, matching the spreadsheet
    tr.appendChild(rn);

    const row = rows[r] || [];
    for (let c = 0; c < colCount; c++) {
      const td = document.createElement('td');
      const value = row[c];
      td.textContent = value === undefined || value === null ? '' : String(value);
      if (state.changed.has(key(r, c))) td.classList.add('reduced');
      td.title = td.textContent;
      tr.appendChild(td);
    }
    frag.appendChild(tr);
  }
  tbody.appendChild(frag);

  return { rowCount: rows.length, colCount };
}

// Parse an ArrayBuffer of an Excel/CSV file and render its first sheet.
function renderWorkbookFromArrayBuffer(arrayBuffer, fileName) {
  clearError();
  const data = new Uint8Array(arrayBuffer);
  const workbook = XLSX.read(data, { type: 'array' });

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    showError('That file has no sheets to display.');
    return;
  }
  const sheet = workbook.Sheets[sheetName];

  const parsedRows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
    blankrows: true,
    raw: false, // use formatted text (dates/numbers as shown in Excel)
  });
  const rows = parsedRows.filter(rowHasContent);

  if (!rows.length) {
    showError('That sheet is empty.');
    return;
  }

  state.originalRows = rows;
  state.rows = cloneRows(rows);
  state.sheetName = sheetName;
  state.fileName = fileName || '';
  state.changed.clear();
  state.shortRows.clear();

  // Validate the canonical column layout on import.
  state.headerRow = findHeaderRow(rows);
  state.layoutValid = state.headerRow !== -1;

  const { rowCount, colCount } = renderTable();

  dropzone.classList.add('hidden');
  tableWrap.style.display = 'block';
  resetBtn.style.display = 'inline-block';
  reduceBtn.disabled = false;
  exportBtn.disabled = false;
  if (fileName) fileMeta.textContent = `${fileName} · ${sheetName}`;
  statusEl.textContent = `${rowCount} row${rowCount === 1 ? '' : 's'} × ${colCount} column${colCount === 1 ? '' : 's'}`;

  // The file still displays for viewing, but a bad layout is reported and will
  // block reduction.
  if (!state.layoutValid) {
    showError(layoutMismatchMessage(rows));
  }
}

// Expose for automated verification (harmless in production).
window.__loadArrayBuffer = renderWorkbookFromArrayBuffer;

function readFile(file) {
  if (!file) return;
  if (!VALID_EXT.test(file.name)) {
    showError(`"${file.name}" is not a supported file. Use .xlsx, .xls, or .csv.`);
    return;
  }
  statusEl.textContent = `Reading ${file.name}…`;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      renderWorkbookFromArrayBuffer(reader.result, file.name);
    } catch (err) {
      showError(`Could not read "${file.name}": ${err && err.message ? err.message : err}`);
      statusEl.textContent = 'Ready';
    }
  };
  reader.onerror = () => {
    showError(`Failed to load "${file.name}".`);
    statusEl.textContent = 'Ready';
  };
  reader.readAsArrayBuffer(file);
}

// --- Hour reduction ------------------------------------------------------

// Sum the numeric day cells (B–H, J–P) of a row. hasNum is true if the row has
// at least one numeric day cell, i.e. it looks like a schedule row (as opposed
// to a header/label/blank row).
function rowDaySum(row) {
  let sum = 0;
  let hasWork = false;
  for (const c of DAY_COLS) {
    const h = workedHours(row[c]); // empty, "x", and 0 all count as 0 (not worked)
    if (h > 0) {
      sum += h;
      hasWork = true;
    }
  }
  return { sum, hasNum: hasWork };
}

// Every schedule row's day cells must total START_HOURS (80) before reduction.
// Returns a list of { row (1-based), sum } for rows that violate this.
function findStartingHourErrors(rows) {
  const errors = [];
  for (let r = 0; r < rows.length; r++) {
    const { sum, hasNum } = rowDaySum(rows[r]);
    if (hasNum && sum !== START_HOURS) {
      errors.push({ row: r + 1, sum });
    }
  }
  return errors;
}

// Apply one preference (reduce X -> Y) to a single row, repeatedly picking a
// random day cell equal to X and replacing it with Y, subtracting (X - Y) from
// the running counter. Stops at target, when no cells match, or when the next
// reduction would drop below target (no overshoot). Returns the new counter.
// Reads a percentage dropdown as a fraction in [0, 1] (defaults to 1 = 100%).
function chanceFromDropdown(id) {
  const el = document.getElementById(id);
  let pct = Number(el ? el.value : 100);
  if (!Number.isFinite(pct)) pct = 100;
  return Math.max(0, Math.min(100, pct)) / 100;
}
// Per-cell selection-weight multipliers (1 = no reduction; lower = less likely).
function monFriChance() {
  return chanceFromDropdown('monfri-chance');
}
function midClusterChance() {
  return chanceFromDropdown('cluster-chance');
}
function preserveWeekends() {
  return document.getElementById('preserve-weekends')?.checked === true;
}

function isMonOrFri(c) {
  return MONDAY_COLS.includes(c) || FRIDAY_COLS.includes(c);
}
function isWeekend(c) {
  return WEEKEND_COLS.includes(c);
}

// Pick which matching cell to reduce, using per-cell selection weights.
//
// Each candidate starts at weight 1. If "preserve weekends" is checked,
// Saturdays/Sundays get weight 0 and cannot be picked. Mondays/Fridays are
// multiplied by the Mon/Fri chance; days sitting between two worked days
// ("mid-cluster") are multiplied by the mid-cluster chance — but only when
// reducing to 0 (Y === 0), since reducing to a non-zero value keeps the day
// worked and can't break a cluster. A day that is both Mon/Fri AND mid-cluster
// gets both multipliers (e.g. 0.5 × 0.5 = 0.25). Selection is a weighted
// roulette wheel.
//
// Fallback: if every candidate ends up at weight 0 (e.g. both chances are 0 and
// every matching day is a Mon/Fri or mid-cluster), the mid-cluster factor is
// dropped (treated as 100%) so the row can still be reduced. Mon/Fri exclusion
// at 0% stays hard — if dropping the cluster factor still leaves everything at 0
// (all matching days are Mon/Fri or protected weekends), the row is left short
// (return null).
function weightedPick(cols, rowIndex, Y) {
  const mf = monFriChance();
  const cl = midClusterChance();
  const clusterApplies = Y === 0;
  const weekendsProtected = preserveWeekends();

  function roulette(useCluster) {
    const weights = cols.map((c) => {
      if (weekendsProtected && isWeekend(c)) return 0;
      let w = 1;
      if (isMonOrFri(c)) w *= mf;
      if (useCluster && clusterApplies && isInCluster(rowIndex, c)) w *= cl;
      return w;
    });
    const total = weights.reduce((a, b) => a + b, 0);
    if (total <= 0) return null;
    let r = Math.random() * total;
    for (let i = 0; i < cols.length; i++) {
      r -= weights[i];
      if (r < 0) return cols[i];
    }
    return cols[cols.length - 1];
  }

  const withCluster = roulette(true);
  return withCluster !== null ? withCluster : roulette(false);
}

// Calendar adjacency for the canonical two-week-per-row layout. The schedule is
// one continuous calendar laid out as two-week rows, so a row's week-2 Sunday (P)
// is followed by the next row's week-1 Monday (B), and a row's week-1 Sunday (H)
// is followed by the same row's week-2 Monday (J).
function prevNeighbor(r, c) {
  if (c === 1) return [r - 1, 15]; // B (wk1 Mon) <- previous row's P (wk2 Sun)
  if (c === 9) return [r, 7];      // J (wk2 Mon) <- same row's H (wk1 Sun)
  return [r, c - 1];
}
function nextNeighbor(r, c) {
  if (c === 7) return [r, 9];      // H (wk1 Sun) -> same row's J (wk2 Mon)
  if (c === 15) return [r + 1, 1]; // P (wk2 Sun) -> next row's B (wk1 Mon)
  return [r, c + 1];
}
function cellNonZero(r, c) {
  const row = state.rows[r];
  if (!row) return false;
  return workedHours(row[c]) > 0;
}
// A day is "in a cluster" when the day before AND the day after are both worked
// (non-zero) — i.e. cutting it would punch a hole in a run of worked days.
// Boundaries: off the top of the grid (before the first row) the previous day is
// assumed 0; off the bottom (after the last row) the schedule is assumed to
// continue, so the next day is treated as worked.
function isInCluster(r, c) {
  const [pr, pc] = prevNeighbor(r, c);
  const [nr, nc] = nextNeighbor(r, c);
  const prevWorked = cellNonZero(pr, pc); // off-grid prev -> false (day before is 0)
  const nextWorked = nr >= state.rows.length ? true : cellNonZero(nr, nc);
  return prevWorked && nextWorked;
}

function applyPreference(rowIndex, current, target, X, Y) {
  const amount = X - Y;
  if (amount <= 0) return current; // nothing to gain; avoids infinite loops

  while (current > target) {
    if (current - amount < target) break; // would overshoot below target
    const matches = DAY_COLS.filter((c) => numericValue(state.rows[rowIndex][c]) === X);
    if (matches.length === 0) break;
    const c = weightedPick(matches, rowIndex, Y);
    if (c === null) break; // nothing selectable (Mon/Fri at 0% with only Mon/Fri) — leave short
    state.rows[rowIndex][c] = String(Y);
    state.changed.add(key(rowIndex, c));
    current -= amount;
  }
  return current;
}

// Reduce one row from START_HOURS down toward target using first then second
// preference. Returns { hadDays, finalHours }.
function reduceRow(rowIndex, target, prefs) {
  const row = state.rows[rowIndex] || [];
  const hadDays = DAY_COLS.some((c) => workedHours(row[c]) > 0);

  let current = START_HOURS;
  for (const [X, Y] of prefs) {
    if (current <= target) break;
    current = applyPreference(rowIndex, current, target, X, Y);
  }
  return { hadDays, finalHours: current };
}

function reduceHours() {
  if (!state.originalRows) {
    showError('Load a file first.');
    return;
  }
  clearError();

  // Nothing to reduce when the target is the full starting amount.
  if (Number(document.getElementById('working-hours').value) >= START_HOURS) {
    showWorkingHoursModal();
    return;
  }

  // Precondition: the file must match the canonical column layout.
  if (!state.layoutValid) {
    showError(layoutMismatchMessage(state.originalRows));
    statusEl.textContent = 'Blocked: unrecognized layout';
    return;
  }

  // Precondition: every schedule row must actually total 80 working hours.
  const startErrors = findStartingHourErrors(state.originalRows);
  if (startErrors.length > 0) {
    const shown = startErrors.slice(0, 10).map((e) => `row ${e.row} = ${e.sum}`).join(', ');
    const more = startErrors.length > 10 ? `, and ${startErrors.length - 10} more` : '';
    const n = startErrors.length;
    const noun = n === 1 ? 'row' : 'rows';
    const verb = n === 1 ? 'does' : 'do';
    showError(
      `Spreadsheet error: every schedule row must total ${START_HOURS} working hours, ` +
        `but ${n} ${noun} ${verb} not — ${shown}${more}. ` +
        `Fix the file and try again.`
    );
    statusEl.textContent = `Blocked: ${n} ${noun} ${verb} not total ${START_HOURS}`;
    return;
  }

  const target = Number(document.getElementById('working-hours').value);
  const prefs = [
    [Number(document.getElementById('pref1-reduce').value), Number(document.getElementById('pref1-to').value)],
  ];
  // Second preference applies only when both of its boxes hold a number; if
  // either is "none", we stop after first preference.
  if (secondPreferenceActive()) {
    prefs.push([
      Number(document.getElementById('pref2-reduce').value),
      Number(document.getElementById('pref2-to').value),
    ]);
  }

  // Always recompute from the originally loaded data so repeated clicks /
  // changed dropdowns don't compound.
  state.rows = cloneRows(state.originalRows);
  state.changed.clear();
  state.shortRows.clear();

  let scheduleRows = 0;
  let rowsChanged = 0;
  let rowsShort = 0;
  for (let r = 0; r < state.rows.length; r++) {
    const changedBefore = state.changed.size;
    const { hadDays, finalHours } = reduceRow(r, target, prefs);
    if (hadDays) {
      scheduleRows++;
      if (finalHours > target) {
        rowsShort++;
        state.shortRows.add(r);
      }
    }
    if (state.changed.size > changedBefore) rowsChanged++;
  }

  renderTable();

  let msg = `Reduced to ${target} h — ${state.changed.size} cell${state.changed.size === 1 ? '' : 's'} changed across ${rowsChanged} of ${scheduleRows} schedule row${scheduleRows === 1 ? '' : 's'}`;
  if (rowsShort > 0) {
    msg += ` · ${rowsShort} row${rowsShort === 1 ? '' : 's'} could not reach ${target} with these preferences`;
  }
  statusEl.textContent = msg;
}

reduceBtn.addEventListener('click', reduceHours);

// --- Working-hours warning modal -----------------------------------------

const modalBackdrop = document.getElementById('modal-backdrop');
const modalTitle = document.getElementById('modal-title');
const modalBody = modalBackdrop.querySelector('.modal-body');
const modalOkBtn = document.getElementById('modal-ok');
const modalCancelBtn = document.getElementById('modal-cancel');
const modalProgress = document.getElementById('modal-progress');
const progressTrack = modalProgress.querySelector('.progress-track');
const progressFill = document.getElementById('progress-fill');
const progressLabel = document.getElementById('progress-label');
let modalOkHandler = null;
let removeUpdateProgressListener = null;

function setModalButtonContent(button, text, { spinner = false } = {}) {
  button.textContent = '';
  const content = document.createElement('span');
  content.className = 'modal-button-content';
  if (spinner) {
    const spinnerEl = document.createElement('span');
    spinnerEl.className = 'spinner';
    spinnerEl.setAttribute('aria-hidden', 'true');
    content.appendChild(spinnerEl);
  }
  const label = document.createElement('span');
  label.textContent = text;
  content.appendChild(label);
  button.appendChild(content);
}

function setProgress(percent) {
  const normalized = Math.max(0, Math.min(100, Number(percent) || 0));
  const rounded = Math.round(normalized);
  progressFill.style.width = `${normalized}%`;
  progressLabel.textContent = `${rounded}%`;
  progressTrack.setAttribute('aria-valuenow', String(rounded));
}

function showProgressBar() {
  setProgress(0);
  modalProgress.hidden = false;
}

function hideProgressBar() {
  modalProgress.hidden = true;
  setProgress(0);
}

function stopListeningForUpdateProgress() {
  if (removeUpdateProgressListener) {
    removeUpdateProgressListener();
    removeUpdateProgressListener = null;
  }
}

function showModal({ title, body, okText = 'OK', cancelText = '', onOk = null }) {
  stopListeningForUpdateProgress();
  hideProgressBar();
  modalTitle.textContent = title;
  modalBody.textContent = body;
  setModalButtonContent(modalOkBtn, okText);
  modalCancelBtn.textContent = cancelText;
  modalCancelBtn.hidden = !cancelText;
  modalOkBtn.disabled = false;
  modalCancelBtn.disabled = false;
  modalOkHandler = onOk;
  modalBackdrop.hidden = false;
}

function showWorkingHoursModal() {
  showModal({
    title: 'Lower the working hours',
    body:
      "Working hours is set to 80 — that's the starting amount, so there's nothing to " +
      'reduce. Set it to a smaller value (72, 64, 56, or 48) and try again.',
    okText: 'OK',
  });
}

function hideModal() {
  if (modalOkBtn.disabled) return;
  stopListeningForUpdateProgress();
  hideProgressBar();
  modalBackdrop.hidden = true;
  modalOkHandler = null;
}

modalOkBtn.addEventListener('click', () => {
  const handler = modalOkHandler;
  if (!handler) {
    hideModal();
    return;
  }
  handler();
});
modalCancelBtn.addEventListener('click', hideModal);
modalBackdrop.addEventListener('click', (e) => {
  if (e.target === modalBackdrop) hideModal(); // click outside the dialog
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !modalBackdrop.hidden) hideModal();
});

async function installUpdate(currentVersion, latestVersion) {
  if (!(window.app && window.app.updates && window.app.updates.install)) {
    showModal({
      title: 'Update unavailable',
      body: 'Updates are only available in the desktop app.',
      okText: 'OK',
    });
    return;
  }
  modalOkBtn.disabled = true;
  modalCancelBtn.disabled = true;
  setModalButtonContent(modalOkBtn, 'Updating...', { spinner: true });
  showProgressBar();
  modalBody.textContent = `Downloading version ${latestVersion}. The app will restart when the update is ready.`;
  statusEl.textContent = `Downloading update ${latestVersion}…`;
  if (window.app.updates.onDownloadProgress) {
    removeUpdateProgressListener = window.app.updates.onDownloadProgress((progress) => {
      setProgress(progress && progress.percent);
    });
  }
  try {
    const result = await window.app.updates.install();
    if (result && result.started === false) {
      showModal({
        title: 'Up to date',
        body: 'You are running the latest version.',
        okText: 'OK',
      });
      statusEl.textContent = 'Current version is up to date';
    }
  } catch (err) {
    showModal({
      title: 'Update failed',
      body: `Could not update from version ${currentVersion} to ${latestVersion}: ${
        err && err.message ? err.message : err
      }`,
      okText: 'OK',
    });
    statusEl.textContent = 'Update failed';
  }
}

function showUpdateAvailableModal(result) {
  showModal({
    title: 'Update available',
    body: `You are running version ${result.currentVersion}. The latest version is ${result.latestVersion}. Do you want to update?`,
    okText: 'Update',
    cancelText: 'Cancel',
    onOk: () => installUpdate(result.currentVersion, result.latestVersion),
  });
}

async function checkForUpdates({ manual = false } = {}) {
  if (!(window.app && window.app.updates && window.app.updates.check)) {
    if (!manual) return;
    showModal({
      title: 'Update unavailable',
      body: 'Updates are only available in the desktop app.',
      okText: 'OK',
    });
    return;
  }

  const originalText = checkUpdatesBtn.textContent;
  if (manual) {
    checkUpdatesBtn.disabled = true;
    checkUpdatesBtn.textContent = 'checking…';
    statusEl.textContent = 'Checking for updates…';
  }
  try {
    const result = await window.app.updates.check();
    if (manual) statusEl.textContent = `Current version ${result.currentVersion}`;
    if (!result.updateAvailable) {
      if (!manual) return;
      showModal({
        title: 'Up to date',
        body: 'You are running the latest version.',
        okText: 'OK',
      });
      return;
    }
    showUpdateAvailableModal(result);
  } catch (err) {
    if (!manual) return;
    showModal({
      title: 'Update check failed',
      body: `Could not check for updates: ${err && err.message ? err.message : err}`,
      okText: 'OK',
    });
    statusEl.textContent = 'Update check failed';
  } finally {
    if (manual) {
      checkUpdatesBtn.disabled = false;
      checkUpdatesBtn.textContent = originalText;
    }
  }
}

// Second preference is active only when neither of its boxes is "none".
function secondPreferenceActive() {
  return (
    document.getElementById('pref2-reduce').value !== 'none' &&
    document.getElementById('pref2-to').value !== 'none'
  );
}

// Dim the second-preference row when it is disabled (either box on "none").
function updateSecondPrefState() {
  document.getElementById('second-pref-row').classList.toggle('disabled', !secondPreferenceActive());
}

document.getElementById('pref2-reduce').addEventListener('change', updateSecondPrefState);
document.getElementById('pref2-to').addEventListener('change', updateSecondPrefState);

// --- Export --------------------------------------------------------------

// Build .xlsx bytes from the current (possibly reduced) rows. Numeric-looking
// cells are written as numbers; everything else stays text.
function buildXlsxBytes() {
  const aoa = (state.rows || []).map((row) =>
    row.map((cell) => {
      if (typeof cell === 'string' && cell.trim() !== '' && Number.isFinite(Number(cell))) {
        return Number(cell);
      }
      return cell;
    })
  );
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, state.sheetName || 'Sheet1');
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return out instanceof Uint8Array ? out : new Uint8Array(out);
}

// Expose for automated verification (harmless in production).
window.__buildXlsxBytes = buildXlsxBytes;

function defaultExportName() {
  const base = state.fileName ? state.fileName.replace(/\.(xlsx|xls|csv)$/i, '') : 'schedule';
  return `${base}-reduced.xlsx`;
}

async function exportXlsx() {
  if (!state.rows) {
    showError('Load a file first.');
    return;
  }
  if (!(window.app && window.app.exportXlsx)) {
    showError('Export is only available in the desktop app.');
    return;
  }
  clearError();
  try {
    const bytes = buildXlsxBytes();
    const result = await window.app.exportXlsx(bytes, defaultExportName());
    if (!result || result.canceled) {
      statusEl.textContent = 'Export canceled';
      return;
    }
    statusEl.textContent = `Exported to ${result.filePath}`;
  } catch (err) {
    showError(`Export failed: ${err && err.message ? err.message : err}`);
  }
}

exportBtn.addEventListener('click', exportXlsx);

// --- Drag & drop ---------------------------------------------------------

// Prevent the window from navigating to a dropped file (default browser behavior).
['dragover', 'drop'].forEach((evt) => {
  window.addEventListener(evt, (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
});

dropzone.addEventListener('dragenter', () => dropzone.classList.add('dragover'));
dropzone.addEventListener('dragover', () => dropzone.classList.add('dragover'));
dropzone.addEventListener('dragleave', (e) => {
  if (e.target === dropzone) dropzone.classList.remove('dragover');
});
dropzone.addEventListener('drop', (e) => {
  dropzone.classList.remove('dragover');
  const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  readFile(file);
});

// --- Click to browse -----------------------------------------------------

dropzone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  readFile(fileInput.files && fileInput.files[0]);
  fileInput.value = '';
});

resetBtn.addEventListener('click', resetView);
checkUpdatesBtn.addEventListener('click', () => checkForUpdates({ manual: true }));

// --- Initial state -------------------------------------------------------

reduceBtn.disabled = true;
exportBtn.disabled = true;
fileMeta.textContent = NO_FILE_LABEL;
updateSecondPrefState();
checkForUpdates();
