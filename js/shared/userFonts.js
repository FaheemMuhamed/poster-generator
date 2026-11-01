// Fonts people upload themselves. They're added to the page with FontFace and kept in
// IndexedDB on this browser only: like uploaded images, they never leave the device.
// A shared poster that uses one falls back to the default font for anyone without it.

const DB = 'morva-fonts', STORE = 'fonts';
export const userFonts = [];
const listeners = new Set();
export const onUserFonts = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const changed = () => listeners.forEach((fn) => fn());

function openDb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'name' });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
const request = (req) => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });

async function register(name, data) {
  const face = new FontFace(name, data);
  await face.load();
  document.fonts.add(face);
  if (!userFonts.includes(name)) userFonts.push(name);
  changed();
}

// Re-adds the fonts saved on this browser. Never throws (private windows may block storage).
export async function loadUserFonts() {
  try {
    const db = await openDb();
    const all = await request(db.transaction(STORE).objectStore(STORE).getAll());
    for (const f of all) await register(f.name, f.data).catch(() => {});
  } catch { /* no storage: uploads still work for this visit */ }
}

export async function addUserFont(file) {
  if (!/\.(ttf|otf|woff2?)$/i.test(file.name) || file.size > 10e6) throw new Error('Use a .ttf, .otf, .woff or .woff2 file under 10 MB');
  const data = await file.arrayBuffer();
  const name = file.name.replace(/\.[^.]+$/, '').replace(/[^\w \-]/g, '').trim().slice(0, 60) || 'My font';
  try { await register(name, data); } catch { throw new Error("That file couldn't be read as a font"); }
  try {
    const db = await openDb();
    await request(db.transaction(STORE, 'readwrite').objectStore(STORE).put({ name, data }));
  } catch { /* kept for this visit only */ }
  return name;
}

export async function removeUserFont(name) {
  const i = userFonts.indexOf(name);
  if (i >= 0) userFonts.splice(i, 1);
  changed();
  try {
    const db = await openDb();
    await request(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(name));
  } catch { /* nothing saved */ }
}
