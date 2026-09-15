import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import MergeEvents, { MergeSummary, mergePreview } from '../app/calendar/merge-events.tsx';
import type { CalendarEvent } from '../app/calendar/types.ts';

const keep: CalendarEvent = { id: 'keep', title: 'Dinner', date: '2026-09-18', kind: 'food', location: '', detail: 'My note', attendance: 'invited', source: 'WhatsApp', revision: 1 };
const other: CalendarEvent = { ...keep, id: 'other', title: 'Restaurant booking', time: '19:00', location: 'Luca', detail: 'Other note', attendance: 'confirmed', source: 'Gmail', reference: 'REF' };

test('preview retains chosen identity and attendance and clearly shows the descriptive fields that fill blanks', () => {
  const preview = mergePreview(keep, other);
  assert.equal(preview.time, undefined); assert.equal(preview.attendance, 'invited'); assert.equal(preview.id, keep.id);
  assert.equal(preview.location, 'Luca'); assert.equal(preview.detail, 'My note'); assert.equal(preview.reference, 'REF');
  const markup = renderToStaticMarkup(createElement(MergeSummary, { event: preview, label: 'After merging — one event' }));
  assert.match(markup, /INVITATION: Dinner/); assert.match(markup, /18 Sept 2026/); assert.match(markup, /Luca/); assert.match(markup, /My note/);
  assert.doesNotMatch(markup, /Other note/); assert.equal(keep.location, '');
});

test('merge requires an explicit selection and includes hidden invitations and dates outside current month', () => {
  const markup = renderToStaticMarkup(createElement(MergeEvents, { active: keep, events: [keep, other, { ...other, id: 'future', date: '2027-01-01' }], busy: false, onMerge: async () => {}, onBack: () => {} }));
  assert.match(markup, /Choose the other copy/); assert.match(markup, /value="other"/); assert.match(markup, /value="future"/);
  assert.doesNotMatch(markup, /value="keep"/); assert.match(markup, /disabled[^>]*>Merge into one event/);
});
