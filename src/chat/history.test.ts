import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HistoryStore } from './history.js';

describe('HistoryStore', () => {
  it('starts empty for a channel it has never seen', () => {
    assert.deepEqual(new HistoryStore(5).get('new-channel'), []);
  });

  it('keeps only the most recent messages once over the limit', () => {
    const history = new HistoryStore(3);
    for (const content of ['1', '2', '3', '4']) history.push('channel', { role: 'user', content });
    assert.deepEqual(
      history.get('channel').map((m) => m.content),
      ['2', '3', '4'],
    );
  });

  it('keeps each channel separate, and clear() only forgets one', () => {
    const history = new HistoryStore(5);
    history.push('a', { role: 'user', content: 'in a' });
    history.push('b', { role: 'user', content: 'in b' });
    history.clear('a');
    assert.deepEqual(history.get('a'), []);
    assert.deepEqual(history.get('b'), [{ role: 'user', content: 'in b' }]);
  });
});
