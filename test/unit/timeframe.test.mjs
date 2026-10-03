// setThemeTimeFrame (flat's time slider) and the YouTube click-to-play
// tooltip placeholder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ENGINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'ixmaps-gl.js');
const win = { console: { info() {}, warn() {}, log() {}, error() {} }, location: { search: '' },
  document: { styleSheets: [], createElement: () => ({}), head: { appendChild() {} } } };
win.window = win; win.globalThis = win;
vm.runInNewContext(fs.readFileSync(ENGINE, 'utf8'), win, { filename: 'ixmaps-gl.js' });
const G = win.__ixmapsGlInternals;
const P = G.LayerRuntime.prototype;

const feats = ['2021-01-06T10:00:00', '2021-01-06T11:30:00', '2021-01-06T13:00:00', 'junk']
  .map((t, i) => ({ type: 'Feature', properties: { id: i, t } }));
const mk = () => ({
  features: feats, binding: { time: 't' }, facetFilters: new Map(), _runtimeFilterExpr: '', _timeFrame: null,
  flags: new Set(), _usesAggregationIndex: () => false,
  setTimeFrame: P.setTimeFrame, _timePredicate: P._timePredicate, _rebuildActiveFeatures: P._rebuildActiveFeatures,
});
const ms = s => new Date(s).getTime();
const ids = rt => (rt._activeFeatures || rt.features).map(f => f.properties.id);

test('setTimeFrame: keeps the records with timefield in [min, max)', () => {
  const rt = mk();
  rt.setTimeFrame(ms('2021-01-06T11:00:00'), ms('2021-01-06T13:00:00'));
  assert.deepEqual(ids(rt), [1], 'max is exclusive; an unparsable time is dropped');
  rt.setTimeFrame(ms('2021-01-06T11:00:00'), null);
  assert.deepEqual(ids(rt), [1, 2], 'open-ended max');
});

test('setTimeFrame: a frame starting at/before the earliest record shows every item (flat, slider at start)', () => {
  const rt = mk();
  rt.setTimeFrame(ms('2021-01-06T10:00:00'), ms('2021-01-06T10:30:00'));
  assert.equal(rt._timeFrame, null);
  assert.equal(rt._activeFeatures, null, 'no filter: all features');
  rt.setTimeFrame(ms('2021-01-06T10:00:01'), ms('2021-01-06T10:30:00'));
  assert.deepEqual(ids(rt), [], 'just after the start: the filter applies');
});

test('setTimeFrame(null, null) clears the frame; a runtime without timefield is not filtered', () => {
  const rt = mk();
  rt.setTimeFrame(ms('2021-01-06T12:00:00'), ms('2021-01-06T14:00:00'));
  assert.deepEqual(ids(rt), [2]);
  rt.setTimeFrame(null, null);
  assert.equal(rt._activeFeatures, null);
  const none = mk(); none.binding = {};
  none.setTimeFrame(1, 2);
  assert.equal(none._activeFeatures, null, 'no time binding: nothing filtered');
});

test('youtubeClickToPlay: a YouTube embed iframe becomes a thumbnail placeholder; other HTML is untouched', () => {
  const html = '<div><iframe width="240" height="180" frameborder="0" src="https://www.youtube.com/embed/S8WK2TgruMo?rel=0&amp;showinfo=0"></iframe></div>';
  const out = G.youtubeClickToPlay(html);
  assert.ok(!/<iframe/i.test(out), 'no iframe is loaded until the click');
  assert.match(out, /data-yt="S8WK2TgruMo" data-w="240" data-h="180"/);
  assert.match(out, /i\.ytimg\.com\/vi\/S8WK2TgruMo\/hqdefault\.jpg/);
  const other = '<iframe src="https://example.com/x"></iframe> youtube';
  assert.equal(G.youtubeClickToPlay(other), other);
  assert.equal(G.youtubeClickToPlay(null), null);
});
