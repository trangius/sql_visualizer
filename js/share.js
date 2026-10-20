'use strict';

// ─── Share links ─────────────────────────────────────────────────────────────
// The diagram (name and schema) is compressed into the URL's #hash, so nothing is
// stored on a server. Opening such a link adds it as a new tab, laid out automatically
// for the viewer's screen (box positions are not in the link).

// Base64url, in chunks: spreading a big array into fromCharCode exceeds the argument limit
function b64url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const unb64url = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const squeeze = (bytes, how) => new Response(new Blob([bytes]).stream().pipeThrough(how)).arrayBuffer().then(b => new Uint8Array(b));

// The schema always goes as Simple syntax: SQL is several times longer (a 14 KB script
// with comments became a 650 character link instead of 5800). SQL comments are left out.
function shareText() {
  if (state.mode === 'text') return state.text;
  return sqlToText(state.sql, false, state.dialect);
}

async function shareLink() {
  const d = { n: activeDoc().name, m: 'text', s: shareText(), ...(state.dialect !== 'mariadb' && { dl: state.dialect }) };
  const z = await squeeze(new TextEncoder().encode(JSON.stringify(d)), new CompressionStream('deflate-raw'));
  return location.href.split('#')[0] + '#d=' + b64url(z);
}

async function copyShareLink() {
  closeMenus();
  try {
    await navigator.clipboard.writeText(await shareLink());
    toast('Link copied. Anyone with it can open a copy of this diagram.');
  } catch {
    toast('Could not copy the link.');
  }
}
$('#shareBtn').onclick = copyShareLink;

async function openShared() {
  const m = location.hash.match(/^#d=([\w-]+)$/);
  if (!m) return;
  history.replaceState(null, '', location.pathname + location.search); // a reload shouldn't add it again
  try {
    const raw = await squeeze(unb64url(m[1]), new DecompressionStream('deflate-raw'));
    const d = JSON.parse(new TextDecoder().decode(raw));
    if (typeof d?.s !== 'string') throw new Error('no schema in the link');
    const dialect = DIALECTS[d.dl] ? { dialect: d.dl } : {};
    newDoc(typeof d.n === 'string' && d.n || 'Shared', d.s, { ...docFields(d.s, d.m === 'sql'), ...dialect }); // no positions: auto layout, then fit
  } catch {
    toast('That link is broken or incomplete.');
  }
}
window.addEventListener('hashchange', openShared);
openShared();
