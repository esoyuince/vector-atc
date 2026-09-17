import test from 'node:test';
import assert from 'node:assert/strict';
import {translator,eventText} from '../src/i18n.mjs';
test('both languages render budget notices and translate stored events without changing identifiers',()=>{
 const title='Bugünkü AI kullanım sınırına ulaşıldı';
 assert.equal(translator('tr')(title),title);assert.equal(translator('en')(title),'Today’s AI usage limit has been reached');
 assert.equal(eventText('TypeSafe filo komutları · 100 uçak · 403 karar','en'),'TypeSafe fleet commands · 100 aircraft · 403 decisions');
 assert.equal(eventText('AJT151 yeniden doğdu · İniş kuyruğu','en'),'AJT151 respawned · Arrival queue');
 assert.equal(eventText('INITIAL_D01 · 3000 ft · 140 kt','en'),'INITIAL_D01 · 3000 ft · 140 kt');
});
