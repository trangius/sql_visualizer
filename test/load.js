'use strict';

// The app's scripts in a vm context, as the tests need them: the browser bits stubbed,
// the sample data of every language already loaded. `extra` goes into the context too.
const fs = require('fs'), path = require('path'), vm = require('vm');
module.exports = function load(extra = {}) {
  const js = f => fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf8');
  const ctx = { console, document: { querySelector: () => null }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    onSampleData() {}, state: { sampleLang: null }, ...extra };
  vm.createContext(ctx);
  vm.runInContext(['model', 'dialects', 'sql', 'examples', 'sample/kinds', 'sample/en', 'sample/sv', 'sample'].map(js).join('\n') +
    '\nloadScript = async () => {}; // the sample files are already loaded', ctx);
  return ctx;
};
