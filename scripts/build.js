#!/usr/bin/env node
/**
 * Fabrica de landings Young Nexus.
 * Uso:  node scripts/build.js [slug|--all] [--estilo oscuro|claro|editorial]
 * Entrada:  clients/<slug>.json   Salida:  dist/<slug>/
 * Sin dependencias: solo Node >= 18.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TPL = path.join(ROOT, 'template');
const CLIENTS = path.join(ROOT, 'clients');
const DIST = path.join(ROOT, 'dist');

/* ---------- motor de plantillas (if / each / {{var}} / {{{raw}}}) ---------- */

const esc = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function get(ctx, p, parent) {
  if (p === '.') return ctx && ctx['.'];
  let v = p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), ctx);
  if (v === undefined && parent) v = get(parent, p, null);
  return v;
}

const truthy = v => !(v == null || v === false || v === '' || (Array.isArray(v) && !v.length));

function findBlock(tpl, from) {
  const open = /\{\{#(if|each)\s+([\w.]+)\}\}/g;
  open.lastIndex = from;
  const m = open.exec(tpl);
  if (!m) return null;
  const [type, p] = [m[1], m[2]];
  const scan = new RegExp(`\\{\\{#${type}\\s+[\\w.]+\\}\\}|\\{\\{\\/${type}\\}\\}`, 'g');
  scan.lastIndex = open.lastIndex;
  let depth = 1, s;
  while ((s = scan.exec(tpl))) {
    if (s[0].startsWith('{{/')) {
      if (--depth === 0) return { type, p, start: m.index, bodyStart: open.lastIndex, bodyEnd: s.index, end: scan.lastIndex };
    } else depth++;
  }
  throw new Error(`Bloque {{#${type} ${p}}} sin cierre`);
}

function interpolate(str, ctx, parent) {
  return str
    .replace(/\{\{\{\s*([\w.]+)\s*\}\}\}/g, (_, p) => { const v = get(ctx, p, parent); return v == null ? '' : String(v); })
    .replace(/\{\{\s*([\w.]+|\.)\s*\}\}/g, (_, p) => { const v = get(ctx, p, parent); return v == null ? '' : esc(v); });
}

function render(tpl, ctx, parent) {
  let out = '', i = 0;
  for (;;) {
    const b = findBlock(tpl, i);
    if (!b) { out += interpolate(tpl.slice(i), ctx, parent); break; }
    out += interpolate(tpl.slice(i, b.start), ctx, parent);
    const body = tpl.slice(b.bodyStart, b.bodyEnd);
    const val = get(ctx, b.p, parent);
    if (b.type === 'if') {
      if (truthy(val)) out += render(body, ctx, parent);
    } else if (Array.isArray(val)) {
      for (const item of val) {
        out += render(body, (item && typeof item === 'object') ? item : { '.': item }, ctx);
      }
    }
    i = b.end;
  }
  return out;
}

/* ---------- capa SEO: datos estructurados ---------- */

function buildJsonLd(c) {
  const url = c.site.url.replace(/\/+$/, '') + '/';
  const g = [];

  const biz = {
    '@type': c.business.schemaType || 'LocalBusiness',
    '@id': url + '#business',
    name: c.business.name,
    description: c.seo.description,
    url,
    image: url.replace(/\/$/, '') + c.seo.ogImage,
    priceRange: c.business.priceRange || '$$',
    address: {
      '@type': 'PostalAddress',
      addressLocality: c.business.city,
      addressRegion: c.business.region,
      addressCountry: c.business.country || 'AR'
    }
  };
  if (c.business.street) biz.address.streetAddress = c.business.street;
  if (c.business.postalCode) biz.address.postalCode = c.business.postalCode;
  if (c.business.phone) biz.telephone = c.business.phone;
  if (c.business.email) biz.email = c.business.email;
  if (c.business.areaServed) biz.areaServed = c.business.areaServed.map(n => ({ '@type': 'Place', name: n }));
  if (c.business.openingHours) biz.openingHours = c.business.openingHours;
  if (c.business.sameAs) biz.sameAs = c.business.sameAs;
  if (c.business.geo) biz.geo = { '@type': 'GeoCoordinates', latitude: c.business.geo.lat, longitude: c.business.geo.lng };
  if (c.services && c.services.length) {
    biz.hasOfferCatalog = {
      '@type': 'OfferCatalog',
      name: c.copy.servicesTitle || 'Servicios',
      itemListElement: c.services.map(s => ({
        '@type': 'Offer',
        itemOffered: { '@type': 'Service', name: s.name, description: s.description }
      }))
    };
  }
  g.push(biz);

  g.push({
    '@type': 'WebSite',
    '@id': url + '#website',
    url,
    name: c.business.name,
    inLanguage: c.lang,
    publisher: { '@id': url + '#business' }
  });

  if (c.faq && c.faq.length) {
    g.push({
      '@type': 'FAQPage',
      '@id': url + '#faq',
      mainEntity: c.faq.map(f => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a }
      }))
    });
  }

  return JSON.stringify({ '@context': 'https://schema.org', '@graph': g }, null, 2);
}

const sitemap = c => {
  const url = c.site.url.replace(/\/+$/, '') + '/';
  const today = new Date().toISOString().slice(0, 10);
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${url}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
`;
};

const robots = c => `User-agent: *
Allow: /

Sitemap: ${c.site.url.replace(/\/+$/, '')}/sitemap.xml
`;

/* ---------- guarda de paleta ---------- */
/*
 * index.html es produccion y se queda autocontenido: no consume template/styles.css.
 * El precio de esa independencia es que las dos copias de la paleta pueden divergir,
 * asi que antes de generar nada comparamos los tokens de color de ambos :root.
 * Si difieren, el build corta y dice cuales.
 */

const HEX = /^#[0-9a-fA-F]{3,8}$/;

function paletteOf(file) {
  const src = fs.readFileSync(file, 'utf8');
  const root = src.match(/:root\s*\{([^}]*)\}/);
  if (!root) throw new Error(`no encontre el bloque :root en ${path.relative(ROOT, file)}`);
  const tokens = {};
  for (const m of root[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    const value = m[2].trim();
    if (HEX.test(value)) tokens[m[1]] = value.toUpperCase();
  }
  return tokens;
}

function checkPalette() {
  const SITE = path.join(ROOT, 'index.html');
  const CSS = path.join(TPL, 'styles.css');
  const site = paletteOf(SITE);
  const tpl = paletteOf(CSS);

  const diffs = [];
  for (const token of [...new Set([...Object.keys(site), ...Object.keys(tpl)])].sort()) {
    if (!(token in tpl)) diffs.push(`${token}  index.html ${site[token]}  ->  template/styles.css no lo define`);
    else if (!(token in site)) diffs.push(`${token}  template/styles.css ${tpl[token]}  ->  index.html no lo define`);
    else if (site[token] !== tpl[token]) diffs.push(`${token}  index.html ${site[token]}  !=  template/styles.css ${tpl[token]}`);
  }

  if (diffs.length) {
    console.error('\nLa paleta del sitio y la de la plantilla divergieron:\n');
    for (const d of diffs) console.error(`  ${d}`);
    console.error(`\n${diffs.length} token(s) fuera de sincronia. Emparejalos y volve a correr el build.`);
    console.error('El sitio manda: index.html es produccion, template/styles.css se ajusta a el.\n');
    process.exit(1);
  }
  return Object.keys(site).length;
}

/* ---------- estilos ---------- */
/*
 * Tres puntos de partida que el cliente elige (campo "style" del JSON):
 *   oscuro    -> tecnologico, contraste alto (el de siempre)
 *   claro     -> limpio, fondo blanco, para rubros que venden confianza
 *   editorial -> calido, tipografia serif, para estudios y profesiones
 * Sobre el estilo elegido se aplican los colores propios del cliente ("theme").
 * Las fuentes se sirven desde /fonts del propio sitio: sin pedidos a terceros.
 */

const FONT_FILES = {
  'Space Grotesk':   [{ file: 'space-grotesk-var.woff2', weight: '300 700' }],
  'Inter':           [{ file: 'inter-var.woff2', weight: '100 900' }],
  'IBM Plex Mono':   [{ file: 'ibm-plex-mono-400.woff2', weight: '400' }, { file: 'ibm-plex-mono-500.woff2', weight: '500' }],
  'Instrument Sans': [{ file: 'instrument-sans-var.woff2', weight: '400 700' }],
  'Instrument Serif':[{ file: 'instrument-serif-400.woff2', weight: '400' }, { file: 'instrument-serif-italic.woff2', weight: '400', style: 'italic' }],
  'JetBrains Mono':  [{ file: 'jetbrains-mono-var.woff2', weight: '100 800' }]
};
const FONT_LICENSE = {
  'Space Grotesk': 'LICENSE-space-grotesk.txt', 'Inter': 'LICENSE-inter.txt', 'IBM Plex Mono': 'LICENSE-ibm-plex-mono.txt',
  'Instrument Sans': 'LICENSE-instrument-sans.txt', 'Instrument Serif': 'LICENSE-instrument-serif.txt', 'JetBrains Mono': 'LICENSE-jetbrains-mono.txt'
};

const STYLES = {
  oscuro: {
    label: 'Oscuro',
    theme: {
      ink: '#0A0A0F', surface: '#111119', surface2: '#191A26', line: '#2A2A3D',
      text: '#FFFFFF', textDim: '#A0A0B0', accent: '#2BA8DC', accentSoft: '#54BEE6',
      accent2: '#7C3E9C', accentDeep: '#401A67', accent2Text: '#B07FD0',
      onAccent: '#001217', navBg: 'rgba(10,10,15,0.88)'
    },
    fonts: { head: 'Space Grotesk', body: 'Inter', mono: 'IBM Plex Mono', headWeight: 600, headTrack: '-0.02em', headScale: 1 }
  },
  claro: {
    label: 'Claro',
    theme: {
      ink: '#FFFFFF', surface: '#F5F6FA', surface2: '#ECEEF4', line: '#D8DBE6',
      text: '#0A0A0F', textDim: '#55586A', accent: '#0B6E99', accentSoft: '#0A5F84',
      accent2: '#7C3E9C', accentDeep: '#401A67', accent2Text: '#6B2F8A',
      onAccent: '#FFFFFF', navBg: 'rgba(255,255,255,0.9)'
    },
    fonts: { head: 'Instrument Sans', body: 'Inter', mono: 'JetBrains Mono', headWeight: 650, headTrack: '-0.025em', headScale: 1 }
  },
  editorial: {
    label: 'Editorial',
    theme: {
      ink: '#F6F1E8', surface: '#FFFDF8', surface2: '#EFE8DC', line: '#DDD3C4',
      text: '#1D1A16', textDim: '#5E574D', accent: '#8A3B12', accentSoft: '#9A4A1E',
      accent2: '#2F4A3A', accentDeep: '#1F3328', accent2Text: '#2F4A3A',
      onAccent: '#FFFFFF', navBg: 'rgba(246,241,232,0.92)'
    },
    fonts: { head: 'Instrument Serif', body: 'Instrument Sans', mono: 'IBM Plex Mono', headWeight: 400, headTrack: '-0.01em', headScale: 1.12 }
  }
};

/* ---------- contraste (WCAG 2.1) ---------- */

function lum(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map(x => x + x).join('');
  const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255)
    .map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

// pares texto/fondo que la plantilla usa de verdad; minimo AA 4.5:1
function checkContrast(t, slug) {
  const pairs = [
    ['text', 'ink'], ['text', 'surface'], ['textDim', 'ink'], ['textDim', 'surface'],
    ['accent', 'ink'], ['accent', 'surface'], ['accentSoft', 'surface'], ['accentSoft', 'surface2'],
    ['accent2Text', 'surface'], ['accent2Text', 'surface2'], ['onAccent', 'accent']
  ];
  const bad = pairs.map(([f, b]) => [f, b, ratio(t[f], t[b])]).filter(p => p[2] < 4.5);
  if (bad.length) throw new Error(`contraste insuficiente en ${slug}: ` +
    bad.map(([f, b, r]) => `${f} ${t[f]} sobre ${b} ${t[b]} = ${r.toFixed(2)}:1`).join('; ') + ' (minimo 4.5:1)');
}

function fontFaces(f) {
  return [...new Set([f.head, f.body, f.mono])].flatMap(name =>
    FONT_FILES[name].map(v => `@font-face{font-family:'${name}'; font-style:${v.style || 'normal'}; font-weight:${v.weight}; font-display:swap; src:url(/fonts/${v.file}) format('woff2');}`)
  ).join('\n');
}

function normalize(c, forceStyle) {
  c.lang = c.lang || 'es-AR';
  const style = forceStyle || c.style || 'oscuro';
  if (!STYLES[style]) throw new Error(`estilo "${style}" no existe -> usar: ${Object.keys(STYLES).join(', ')}`);
  const preset = STYLES[style];
  // los colores propios del cliente valen para el estilo que eligio; en una vista previa de otro estilo se usan los del preset
  const own = (!forceStyle || forceStyle === (c.style || 'oscuro')) ? (c.theme || {}) : {};
  c.style = style;
  c.styleLabel = preset.label;
  c.theme = Object.assign({}, preset.theme, own);
  c.fonts = Object.assign({}, preset.fonts);
  c.fontFaces = fontFaces(c.fonts);
  c.copy = c.copy || {};
  c.seo = c.seo || {};
  c.seo.ogImage = c.seo.ogImage || '/og.jpg';
  c.seo.ogLocale = c.seo.ogLocale || 'es_AR';
  c.seo.robots = c.seo.robots || 'index, follow, max-image-preview:large, max-snippet:-1';
  c.seo.ogDescription = c.seo.ogDescription || c.seo.description;
  c.business.logo = c.business.logo || '/apple-touch-icon.png';
  c.business.geoRegion = c.business.geoRegion || 'AR';
  // numeracion automatica de servicios y pasos
  (c.services || []).forEach((s, i) => { if (!s.num) s.num = String(i + 1).padStart(2, '0'); });
  (c.steps || []).forEach((s, i) => { if (!s.idx) s.idx = String(i + 1).padStart(2, '0'); });
  (c.area && c.area.points || []).forEach((p, i) => { if (!p.mark) p.mark = String(i + 1).padStart(2, '0'); });
  return c;
}

function copyFonts(f, out) {
  const dir = path.join(out, 'fonts');
  fs.mkdirSync(dir, { recursive: true });
  let n = 0;
  for (const name of new Set([f.head, f.body, f.mono])) {
    for (const v of FONT_FILES[name]) { fs.copyFileSync(path.join(ROOT, 'fonts', v.file), path.join(dir, v.file)); n++; }
    fs.copyFileSync(path.join(ROOT, 'fonts', FONT_LICENSE[name]), path.join(dir, FONT_LICENSE[name])); n++;
  }
  return n;
}

function required(c, slug) {
  const miss = [];
  if (!c.business || !c.business.name) miss.push('business.name');
  if (!c.business || !c.business.city) miss.push('business.city');
  if (!c.site || !c.site.url) miss.push('site.url');
  if (!c.seo.title) miss.push('seo.title');
  if (!c.seo.description) miss.push('seo.description');
  if (!c.hero || !c.hero.title) miss.push('hero.title');
  if (!c.cta || !c.cta.primaryHref) miss.push('cta.primaryHref');
  if (miss.length) throw new Error(`${slug}.json incompleto -> falta: ${miss.join(', ')}`);
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return 0;
  fs.mkdirSync(dest, { recursive: true });
  let n = 0;
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dest, e.name);
    if (e.isDirectory()) n += copyDir(s, d);
    else { fs.copyFileSync(s, d); n++; }
  }
  return n;
}

/* ---------- build ---------- */

function build(slug, forceStyle) {
  const cfgPath = path.join(CLIENTS, slug + '.json');
  const c = normalize(JSON.parse(fs.readFileSync(cfgPath, 'utf8')), forceStyle);
  required(c, slug);
  checkContrast(c.theme, slug);

  c.styles = fs.readFileSync(path.join(TPL, 'styles.css'), 'utf8');
  c.jsonld = buildJsonLd(c);

  const html = render(fs.readFileSync(path.join(TPL, 'base.html'), 'utf8'), c, null);
  const out = path.join(DIST, forceStyle ? `${slug}--${forceStyle}` : slug);
  fs.mkdirSync(out, { recursive: true });

  const assets = copyDir(path.join(TPL, 'assets'), out) + copyDir(path.join(CLIENTS, slug + '.assets'), out) + copyFonts(c.fonts, out);

  fs.writeFileSync(path.join(out, 'index.html'), html);
  fs.writeFileSync(path.join(out, 'sitemap.xml'), sitemap(c));
  fs.writeFileSync(path.join(out, 'robots.txt'), robots(c));
  if (c.site.domain) fs.writeFileSync(path.join(out, 'CNAME'), c.site.domain + '\n');
  if (c.site.spa404) fs.copyFileSync(path.join(out, 'index.html'), path.join(out, '404.html'));

  const leftover = html.match(/\{\{[^}]+\}\}/g);
  console.log(`  ${slug} [${c.style}]  ->  ${path.relative(ROOT, out)}/  (${(html.length / 1024).toFixed(1)} KB, ${assets} assets)`);
  if (leftover) console.warn(`  aviso: variables sin resolver -> ${[...new Set(leftover)].join(' ')}`);
  return out;
}

const arg = process.argv[2];
const ei = process.argv.indexOf('--estilo');
const forceStyle = ei > -1 ? process.argv[ei + 1] : null;
if (!arg) {
  console.error('Uso: node scripts/build.js <slug> | --all   [--estilo oscuro|claro|editorial]  (vista previa en dist/<slug>--<estilo>/)');
  process.exit(1);
}
const slugs = arg === '--all'
  ? fs.readdirSync(CLIENTS).filter(f => f.endsWith('.json') && !f.startsWith('_')).map(f => f.slice(0, -5))
  : [arg];

const tokens = checkPalette();
console.log(`Paleta sincronizada (${tokens} tokens).`);
console.log('Generando landings:');
let fail = 0;
for (const s of slugs) {
  try { build(s, forceStyle); } catch (e) { fail++; console.error(`  ${s}  ERROR: ${e.message}`); }
}
process.exit(fail ? 1 : 0);
