'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function inlineJson(name) {
  const marker = 'const ' + name + '=';
  const start = html.indexOf(marker);
  assert.ok(start >= 0, 'missing ' + name);
  const end = html.indexOf(';\n', start + marker.length);
  assert.ok(end > start, 'missing JSON terminator ' + name);
  return JSON.parse(html.slice(start + marker.length, end));
}
function sourceBetween(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, 'missing source markers: ' + startMarker);
  return html.slice(start, end);
}

const lessons = inlineJson('LESSONS');
const extra = inlineJson('EXTRA_QUIZ_BANK');
const clips = inlineJson('LESSON_CLIPS');

test('all 57 lessons across 11 levels have complete teaching and valid quizzes', () => {
  const levels = inlineJson('LEVELS');
  assert.equal(levels.length, 11);
  assert.equal(lessons.length, 57);
  assert.equal(new Set(lessons.map(l => l.id)).size, lessons.length);
  const levelIds = new Set(levels.map(l => l.id));
  for (const l of lessons) {
    assert.ok(levelIds.has(l.level), l.id);
    for (const key of ['id', 'title', 'body', 'formula', 'example', 'bass', 'ear']) {
      assert.ok(typeof l[key] === 'string' && l[key].trim(), l.id + ' ' + key);
    }
    for (const key of ['mistakes', 'practice']) {
      assert.ok(Array.isArray(l[key]) && l[key].length, l.id + ' ' + key);
    }
    const q = l.check;
    assert.ok(q && q.q && q.why, l.id);
    assert.equal(q.opts.length, 4, l.id);
    assert.equal(new Set(q.opts).size, 4, l.id);
    assert.ok(Number.isInteger(q.ans) && q.ans >= 0 && q.ans < 4, l.id);
  }
});

test('107 additional quiz questions have unique, valid answers and known concepts', () => {
  assert.equal(extra.length, 107);
  const concepts = new Set(lessons.map(l => l.id));
  for (const q of extra) {
    assert.ok(concepts.has(q.concept), q.concept);
    assert.ok(q.q && q.why && q.lesson, q.concept);
    assert.equal(q.opts.length, 4, q.q);
    assert.equal(new Set(q.opts).size, 4, q.q);
    assert.ok(Number.isInteger(q.ans) && q.ans >= 0 && q.ans < 4, q.q);
  }
});

test('all 106 lesson audio clips have valid note/chord syntax and nonnegative timing', () => {
  const qualityNames = new Set([
    '', 'add9', 'maj7', 'maj9', 'maj7#11', '6', '69', 'm', 'm7', 'm9', 'm11',
    'm6', 'mmaj7', 'm7b5', 'dim', 'dim7', 'aug', '7', '9', '13', '7b9',
    '7#9', '7b13', '7#11', '7#5', '7b5', '7alt', '7sus4', 'sus4', 'sus2',
    'M', 'maj', 'M7', 'Δ', 'Δ7', '^7', '-', 'min', '-7', 'min7', '-9',
    '-6', 'm(maj7)', 'mM7', 'ø', 'ø7', '-7b5', 'm7(b5)', 'o',
    '°', 'o7', '°7', '+', '7(b9)', '7(#9)', '7(b13)', '7(#11)',
    '7(#5)', '+7', '7+', '7(b5)', 'alt', 'sus', '7sus', 'minor', 'major',
  ]);
  const ids = new Set(lessons.map(l => l.id));
  let total = 0;
  for (const [id, entries] of Object.entries(clips)) {
    assert.ok(ids.has(id), 'orphan clip: ' + id);
    for (const entry of entries) {
      assert.ok(entry[0] && entry[1], id);
      total++;
      for (const token of entry[1].trim().split(/\s+/)) {
        const m = /^(.*?)(?::([\d.]+)(?:\/([\d.]+))?)?$/.exec(token);
        assert.ok(m, id + ' ' + token);
        if (m[2] !== undefined) assert.ok(Number(m[2]) >= 0, token);
        if (m[3] !== undefined) assert.ok(Number(m[3]) > 0, token);
        let body = m[1];
        if (body === '-') continue;
        if (body.startsWith('@')) {
          const chord = /^([A-G](?:#|b)?)([^/]*)(?:\/([A-G](?:#|b)?))?$/.exec(body.slice(1));
          assert.ok(chord, id + ': ' + token);
          assert.ok(qualityNames.has(chord[2]), id + ': unknown chord ' + token);
        } else {
          if (body.startsWith('b:')) body = body.slice(2);
          body.split('+').forEach(note =>
            assert.match(note, /^([A-G])(#|b)?(-?\d)$/, id + ': ' + token));
        }
      }
    }
  }
  assert.equal(total, 106);
});

test('13 generated drill categories always create four distinct answers and one valid key', () => {
  const code = sourceBetween('const LETTERS=', 'function openDrill(');
  const context = vm.createContext({
    LESSONS: lessons,
    PC_FLAT: ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'],
    shuffle: x => [...x].reverse(),
    Math,
  });
  vm.runInContext(code, context, {filename: 'JAZ-generator.js'});
  const types = vm.runInContext('Object.keys(DRILL_TYPES)', context);
  assert.equal(types.length, 13);
  for (const type of types) {
    for (let i = 0; i < 100; i++) {
      const q = vm.runInContext('makeDrillQuestion(' + JSON.stringify(type) + ')', context);
      assert.equal(q.dtype, type, type);
      assert.equal(q.opts.length, 4, type);
      assert.equal(new Set(q.opts).size, 4, type);
      assert.ok(q.ans >= 0 && q.ans < 4, type);
      assert.ok(q.q && q.why, type);
    }
  }
});

test('invalid or unrelated backup JSON cannot be accepted as empty progress', () => {
  const code = sourceBetween('function validatedBackupState(text)', 'function backupPayload()');
  const context = vm.createContext({
    normalizeState: x => ({...x, practicedSongs: x.practicedSongs || []}),
    SONGS: [{id: 'cantaloupe'}],
    JSON, Object,
  });
  vm.runInContext(code, context);
  for (const bad of ['{}', '[]', '{"hello":"world"}',
      '{"app":"OtherApp","state":{"completed":[]}}',
      '{"app":"Chordinary","state":{}}',
      '{"completed":"all"}']) {
    assert.throws(() => context.validatedBackupState(bad), undefined, bad);
  }
  const good = context.validatedBackupState(JSON.stringify({
    app: 'Chordinary', version: 'v35',
    state: {completed: ['note_names'], practicedSongs: ['cantaloupe','gone']},
  }));
  assert.equal(good.completed[0], 'note_names');
  assert.deepEqual(Array.from(good.practicedSongs), ['cantaloupe']);
});

test('backup overwrite is confirmed and persistent storage is written before activating restored state', () => {
  const code = sourceBetween("document.getElementById('importDataBtn').onclick=", "document.getElementById('resetAllBtn').onclick=");
  assert.match(code, /if\(!confirm\(/);
  assert.match(code, /if\(!storageSet\(STORE_KEY,JSON\.stringify\(restored\)\)\)/);
  assert.ok(code.indexOf('storageSet(STORE_KEY') < code.indexOf('STATE=restored'));
});

test('answered inline quiz stays locked when UI is repainted and cannot double-score', () => {
  const code = sourceBetween('function paintInlineAnswer(l,i)', 'function toggleLessonDone(id)');
  const buttons = [0,1,2,3].map(i => ({
    dataset:{i:String(i)}, disabled:false, markers:[],
    classList:{add(){}},
  }));
  let totalSaves=0, totalActivities=0;
  const ctx = vm.createContext({
    LESSONS: lessons,
    selectedLessonId: lessons[0].id,
    inlineAnswered:false, inlineAnswerIndex:null,
    STATE:{quizCorrect:0,quizTotal:0},
    document:{
      querySelectorAll: () => buttons,
      getElementById: () => ({set innerHTML(value){},get innerHTML(){return ''}}),
    },
    recordQuizResult:()=>{},
    logActivity:()=>{totalActivities++},
    saveState:()=>{totalSaves++},
  });
  vm.runInContext(code,ctx);
  ctx.answerInline(0);
  ctx.answerInline(1);
  ctx.paintInlineAnswer(lessons[0], 0);
  assert.equal(ctx.STATE.quizTotal,1);
  assert.equal(totalSaves,1);
  assert.equal(totalActivities,1);
  assert.ok(buttons.every(b=>b.disabled));
  assert.match(html, /if\(inlineAnswered&&inlineAnswerIndex!==null\)paintInlineAnswer/);
});

test('corrupt browser state is not overwritten automatically on startup', () => {
  assert.match(html, /if\(!STORAGE_LOAD_CORRUPTED\)storageSet\(STORE_KEY,JSON\.stringify\(STATE\)\)/);
  assert.match(html, /const STORE_KEY='chordinary_state'/);
});


test('imported wrong-answer question text is HTML-escaped without discarding historic wording', () => {
  const functionSource = html.match(/function escapeHtml\(value\)\{[\s\S]*?\n\}/)[0];
  const context = vm.createContext({});
  vm.runInContext(functionSource, context);
  assert.equal(
    context.escapeHtml('<img src=x onerror="alert(1)">'),
    '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'
  );
  assert.equal(context.escapeHtml("It's C# & Db"), "It&#39;s C# &amp; Db");
  assert.match(html, /\$\{escapeHtml\(x\.q\)\}/);
});
