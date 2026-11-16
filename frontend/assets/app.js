// The hello page has no dynamic content, so the shared language shell is the whole script.
// Everything it does — the data-i18n pass, the title, document.lang, the language buttons, and
// the textContent-only rule — lives in i18n.mjs, which every page uses.

import { init } from './i18n.js';

init();
