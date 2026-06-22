const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const XLSX = require('xlsx');

const repoRoot = path.resolve(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
const rendererSource = fs.readFileSync(path.join(repoRoot, 'renderer.js'), 'utf8');

const DAY_COLS = [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15];
const EXPECTED_DAYS = {
  1: 'Mon',
  2: 'Tues',
  3: 'Wed',
  4: 'Thur',
  5: 'Fri',
  6: 'Sat',
  7: 'Sun',
  9: 'Mon',
  10: 'Tues',
  11: 'Wed',
  12: 'Thur',
  13: 'Fri',
  14: 'Sat',
  15: 'Sun',
};

class MockClassList {
  constructor() {
    this.values = new Set();
  }

  add(...names) {
    names.forEach((name) => this.values.add(name));
  }

  remove(...names) {
    names.forEach((name) => this.values.delete(name));
  }

  toggle(name, force) {
    const shouldHave = force === undefined ? !this.values.has(name) : Boolean(force);
    if (shouldHave) this.values.add(name);
    else this.values.delete(name);
    return shouldHave;
  }

  contains(name) {
    return this.values.has(name);
  }

  setFromString(value) {
    this.values = new Set(String(value).split(/\s+/).filter(Boolean));
  }

  toString() {
    return Array.from(this.values).join(' ');
  }
}

class MockElement {
  constructor(document, tagName = 'div', id = '') {
    this.ownerDocument = document;
    this.tagName = tagName;
    this.id = id;
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this.classList = new MockClassList();
    this.listeners = new Map();
    this.attributes = new Map();
    this.disabled = false;
    this.hidden = false;
    this.value = '';
    this.checked = false;
    this.title = '';
    this._className = '';
    this._innerHTML = '';
    this._textContent = '';
  }

  get className() {
    return this._className;
  }

  set className(value) {
    this._className = String(value);
    this.classList.setFromString(this._className);
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
    if (value === '') this.children = [];
  }

  get textContent() {
    return this._textContent;
  }

  set textContent(value) {
    this._textContent = String(value);
  }

  appendChild(child) {
    if (child.tagName === '#fragment') {
      for (const grandchild of child.children) {
        this.appendChild(grandchild);
      }
      child.children = [];
      return child;
    }
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) || null;
  }

  addEventListener(type, callback) {
    const callbacks = this.listeners.get(type) || [];
    callbacks.push(callback);
    this.listeners.set(type, callbacks);
  }

  dispatchEvent(event) {
    const e = event || {};
    if (!e.type) throw new Error('Mock events require a type.');
    if (!e.target) e.target = this;
    for (const callback of this.listeners.get(e.type) || []) {
      callback(e);
    }
  }

  click() {
    this.dispatchEvent({ type: 'click', target: this });
  }

  querySelector(selector) {
    if (selector === '.modal-body') return this.ownerDocument.getElementById('modal-body');
    if (selector === '.progress-track') return this.ownerDocument.getElementById('progress-track');
    return null;
  }
}

class MockDocument {
  constructor() {
    this.elements = new Map();
    this.listeners = new Map();
  }

  createElement(tagName) {
    return new MockElement(this, tagName);
  }

  createDocumentFragment() {
    return new MockElement(this, '#fragment');
  }

  getElementById(id) {
    if (!this.elements.has(id)) {
      this.elements.set(id, new MockElement(this, 'div', id));
    }
    return this.elements.get(id);
  }

  addEventListener(type, callback) {
    const callbacks = this.listeners.get(type) || [];
    callbacks.push(callback);
    this.listeners.set(type, callbacks);
  }
}

function copyMathWithRandom(random) {
  const testMath = {};
  for (const name of Object.getOwnPropertyNames(Math)) {
    Object.defineProperty(testMath, name, Object.getOwnPropertyDescriptor(Math, name));
  }
  Object.defineProperty(testMath, 'random', {
    value: random,
    writable: true,
    configurable: true,
  });
  return testMath;
}

function createHarness({ random = () => 0 } = {}) {
  const document = new MockDocument();
  const windowListeners = new Map();
  const window = {
    addEventListener(type, callback) {
      const callbacks = windowListeners.get(type) || [];
      callbacks.push(callback);
      windowListeners.set(type, callbacks);
    },
  };

  [
    'dropzone',
    'file-input',
    'table-wrap',
    'thead',
    'tbody',
    'error',
    'file-meta',
    'status',
    'reset-btn',
    'check-updates',
    'reduce-hours',
    'export-xlsx',
    'modal-backdrop',
    'modal-title',
    'modal-body',
    'modal-ok',
    'modal-cancel',
    'modal-progress',
    'progress-track',
    'progress-fill',
    'progress-label',
    'working-hours',
    'pref1-reduce',
    'pref1-to',
    'pref2-reduce',
    'pref2-to',
    'second-pref-row',
    'monfri-chance',
    'cluster-chance',
    'preserve-weekends',
  ].forEach((id) => document.getElementById(id));

  document.getElementById('working-hours').value = '80';
  document.getElementById('pref1-reduce').value = '8';
  document.getElementById('pref1-to').value = '0';
  document.getElementById('pref2-reduce').value = 'none';
  document.getElementById('pref2-to').value = 'none';
  document.getElementById('monfri-chance').value = '100';
  document.getElementById('cluster-chance').value = '100';
  document.getElementById('preserve-weekends').checked = false;
  document.getElementById('check-updates').textContent = 'check for updates';
  document.getElementById('status').textContent = 'Ready';

  const context = {
    console,
    document,
    window,
    XLSX,
    Math: copyMathWithRandom(random),
  };
  vm.createContext(context);
  vm.runInContext(rendererSource, context, { filename: 'renderer.js' });

  return {
    context,
    document,
    window,
    el: (id) => document.getElementById(id),
    clickReduce: () => document.getElementById('reduce-hours').click(),
  };
}

function blankRow() {
  return Array(16).fill('');
}

function headerRow(overrides = {}) {
  const row = blankRow();
  row[0] = 'Name';
  for (const c of DAY_COLS) row[c] = EXPECTED_DAYS[c];
  for (const [index, value] of Object.entries(overrides)) row[Number(index)] = value;
  return row;
}

function scheduleRow(values, name = 'Person') {
  const row = blankRow();
  row[0] = name;
  for (const [index, value] of Object.entries(values)) row[Number(index)] = value;
  return row;
}

function tenEightHourDays() {
  const values = {};
  for (const c of DAY_COLS.slice(0, 10)) values[c] = 8;
  return scheduleRow(values);
}

function workbookBuffer(rows) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Schedule');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function loadRows(harness, rows, fileName = 'schedule.xlsx') {
  harness.window.__loadArrayBuffer(workbookBuffer(rows), fileName);
}

function exportedRows(harness) {
  const bytes = harness.window.__buildXlsxBytes();
  const wb = XLSX.read(bytes, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
}

function setReductionControls(harness, {
  target = '72',
  pref1Reduce = '8',
  pref1To = '0',
  pref2Reduce = 'none',
  pref2To = 'none',
  monFriChance = '100',
  clusterChance = '100',
  preserveWeekends = false,
} = {}) {
  harness.el('working-hours').value = target;
  harness.el('pref1-reduce').value = pref1Reduce;
  harness.el('pref1-to').value = pref1To;
  harness.el('pref2-reduce').value = pref2Reduce;
  harness.el('pref2-to').value = pref2To;
  harness.el('monfri-chance').value = monFriChance;
  harness.el('cluster-chance').value = clusterChance;
  harness.el('preserve-weekends').checked = preserveWeekends;
}

function dayValues(row) {
  return DAY_COLS.map((c) => row[c]);
}

test('modal primary buttons and progress fill use the main action color', () => {
  assert.match(
    indexHtml,
    /\.modal-button\.primary\s*\{[^}]*background:\s*var\(--action\);/s,
  );
  assert.match(
    indexHtml,
    /\.progress-fill\s*\{[^}]*background:\s*var\(--action\);/s,
  );
  assert.doesNotMatch(
    indexHtml,
    /\.modal-button\.primary\s*\{[^}]*background:\s*hsl\(198,\s*47%,\s*60%\)/s,
  );
});

test('initial state disables actions until a file is loaded', () => {
  const h = createHarness();

  assert.equal(h.el('file-meta').textContent, 'No file loaded.');
  assert.equal(h.el('status').textContent, 'Ready');
  assert.equal(h.el('reduce-hours').disabled, true);
  assert.equal(h.el('export-xlsx').disabled, true);
});

test('valid workbook import renders and enables reduce/export controls', () => {
  const h = createHarness();

  loadRows(h, [headerRow(), tenEightHourDays()], 'valid.xlsx');

  assert.equal(h.el('error').textContent, '');
  assert.equal(h.el('file-meta').textContent, 'valid.xlsx · Schedule');
  assert.equal(h.el('status').textContent, '2 rows × 16 columns');
  assert.equal(h.el('reduce-hours').disabled, false);
  assert.equal(h.el('export-xlsx').disabled, false);
  assert.equal(h.el('dropzone').classList.contains('hidden'), true);
});

test('invalid canonical day layout displays but blocks reduction', () => {
  const h = createHarness();
  loadRows(h, [headerRow({ 6: 'Saturday' }), tenEightHourDays()]);
  setReductionControls(h);

  assert.match(h.el('error').textContent, /Unrecognized layout/);

  h.clickReduce();

  assert.match(h.el('error').textContent, /Unrecognized layout/);
  assert.equal(h.el('status').textContent, 'Blocked: unrecognized layout');
});

test('reduction blocks rows that do not start at 80 hours', () => {
  const h = createHarness();
  loadRows(h, [headerRow(), scheduleRow({ 1: 72 })]);
  setReductionControls(h);

  h.clickReduce();

  assert.match(h.el('error').textContent, /must total 80 working hours/);
  assert.match(h.el('status').textContent, /Blocked: 1 row does not total 80/);
});

test('basic first preference reduction changes one exact matching cell without overshooting', () => {
  const h = createHarness({ random: () => 0 });
  loadRows(h, [headerRow(), tenEightHourDays()]);
  setReductionControls(h, { target: '72', pref1Reduce: '8', pref1To: '0' });

  h.clickReduce();

  const rows = exportedRows(h);
  assert.equal(rows[1][1], 0);
  assert.equal(dayValues(rows[1]).reduce((sum, value) => sum + (Number(value) || 0), 0), 72);
  assert.match(h.el('status').textContent, /1 cell changed across 1 of 1 schedule row/);
});

test('reduction does not overshoot below the target', () => {
  const h = createHarness();
  loadRows(h, [headerRow(), scheduleRow({ 1: 12, 2: 68 })]);
  setReductionControls(h, { target: '72', pref1Reduce: '12', pref1To: '0' });

  h.clickReduce();

  const rows = exportedRows(h);
  assert.equal(rows[1][1], 12);
  assert.equal(rows[1][2], 68);
  assert.match(h.el('status').textContent, /0 cells changed/);
  assert.match(h.el('status').textContent, /1 row could not reach 72/);
});

test('second preference runs only after first preference cannot finish the row', () => {
  const h = createHarness();
  loadRows(h, [headerRow(), scheduleRow({ 1: 16, 2: 64 })]);
  setReductionControls(h, {
    target: '72',
    pref1Reduce: '12',
    pref1To: '0',
    pref2Reduce: '16',
    pref2To: '8',
  });

  h.clickReduce();

  const rows = exportedRows(h);
  assert.equal(rows[1][1], 8);
  assert.equal(rows[1][2], 64);
  assert.match(h.el('status').textContent, /1 cell changed/);
});

test('repeated reductions recompute from the original imported rows', () => {
  let randomValue = 0;
  const h = createHarness({ random: () => randomValue });
  loadRows(h, [headerRow(), tenEightHourDays()]);
  setReductionControls(h);

  h.clickReduce();
  randomValue = 0.999999;
  h.clickReduce();

  const rows = exportedRows(h);
  assert.equal(dayValues(rows[1]).filter((value) => value === 0).length, 1);
  assert.equal(dayValues(rows[1]).reduce((sum, value) => sum + (Number(value) || 0), 0), 72);
});

test('Mon/Fri chance at 0% is a hard exclusion', () => {
  const h = createHarness();
  loadRows(h, [headerRow(), scheduleRow({ 1: 8, 9: 8, 2: 64 })]);
  setReductionControls(h, { monFriChance: '0' });

  h.clickReduce();

  const rows = exportedRows(h);
  assert.equal(rows[1][1], 8);
  assert.equal(rows[1][9], 8);
  assert.match(h.el('status').textContent, /0 cells changed/);
  assert.match(h.el('status').textContent, /1 row could not reach 72/);
});

test('mid-cluster chance at 0% avoids punching a cluster when another candidate exists', () => {
  const h = createHarness({ random: () => 0 });
  loadRows(h, [headerRow(), tenEightHourDays()]);
  setReductionControls(h, { clusterChance: '0' });

  h.clickReduce();

  const rows = exportedRows(h);
  assert.equal(rows[1][1], 0);
  assert.equal(rows[1][2], 8);
});

test('mid-cluster fallback still reduces when every matching candidate is clustered', () => {
  const h = createHarness();
  loadRows(h, [headerRow(), scheduleRow({ 1: 36, 2: 8, 3: 36 })]);
  setReductionControls(h, { clusterChance: '0' });

  h.clickReduce();

  const rows = exportedRows(h);
  assert.equal(rows[1][2], 0);
  assert.match(h.el('status').textContent, /1 cell changed/);
});

test('preserve weekends unchecked allows reducing Saturday and Sunday cells', () => {
  const h = createHarness();
  loadRows(h, [headerRow(), scheduleRow({ 1: 72, 6: 8 })]);
  setReductionControls(h, { preserveWeekends: false });

  h.clickReduce();

  const rows = exportedRows(h);
  assert.equal(rows[1][6], 0);
  assert.match(h.el('status').textContent, /1 cell changed/);
});

test('preserve weekends checked prevents reducing Saturday and Sunday cells', () => {
  const h = createHarness();
  loadRows(h, [headerRow(), scheduleRow({ 1: 72, 6: 8 })]);
  setReductionControls(h, { preserveWeekends: true });

  h.clickReduce();

  const rows = exportedRows(h);
  assert.equal(rows[1][6], 8);
  assert.match(h.el('status').textContent, /0 cells changed/);
  assert.match(h.el('status').textContent, /1 row could not reach 72/);
});

test('preserve weekends remains a hard exclusion during mid-cluster fallback', () => {
  const h = createHarness();
  loadRows(h, [headerRow(), scheduleRow({ 5: 36, 6: 8, 7: 36 })]);
  setReductionControls(h, { preserveWeekends: true, clusterChance: '0' });

  h.clickReduce();

  const rows = exportedRows(h);
  assert.equal(rows[1][6], 8);
  assert.match(h.el('status').textContent, /0 cells changed/);
});

test('export serializes numeric-looking cells as numbers while preserving text', () => {
  const h = createHarness();
  loadRows(h, [headerRow(), scheduleRow({ 1: '8', 2: 'x', 3: '72' })]);

  const rows = exportedRows(h);

  assert.equal(rows[1][1], 8);
  assert.equal(rows[1][2], 'x');
  assert.equal(rows[1][3], 72);
});
