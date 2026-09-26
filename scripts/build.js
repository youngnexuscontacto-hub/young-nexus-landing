#!/usr/bin/env node
/**
 * Fabrica de landings Young Nexus.
 * Uso:  node scripts/build.js [slug|--all]
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

const truthy = v => !(v == null || v === false || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.length));

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

/* ---------- defaults ---------- */

const THEME = {
  ink: '#0A0A0F', surface: '#111119', surface2: '#191A26', line: '#2A2A3D',
  text: '#FFFFFF', textDim: '#A0A0B0', accent: '#2BA8DC', accentSoft: '#54BEE6', accent2: '#7C3E9C', accentDeep: '#401A67'
};

/*
 * Un item "vacio" es el que quedo tal cual vino de _plantilla.json: todos sus textos en "".
 * Los booleanos (featured, external...) no cuentan como contenido. Se podan antes de
 * renderizar para que {{#if}} oculte la seccion entera en vez de dibujar tarjetas vacias.
 */
function blank(v) {
  if (v == null || typeof v === 'boolean') return true;
  if (typeof v === 'string') return !v.trim();
  if (Array.isArray(v)) return v.every(blank);
  if (typeof v === 'object') return Object.values(v).every(blank);
  return false;
}
const prune = a => (Array.isArray(a) ? a.filter(x => !blank(x)) : a);

function normalize(c) {
  for (const k of ['problems', 'services', 'steps', 'plans', 'faq', 'nav', 'footerLinks']) c[k] = prune(c[k]);
  (c.plans || []).forEach(p => { p.features = prune(p.features); p.excluded = prune(p.excluded); });
  if (c.area) c.area.points = prune(c.area.points);
  if (c.contact) c.contact.channels = prune(c.contact.channels);
  if (c.business) for (const k of ['openingHours', 'areaServed', 'sameAs']) {
    c.business[k] = prune(c.business[k]);
    if (Array.isArray(c.business[k]) && !c.business[k].length) delete c.business[k];
  }
  c.lang = c.lang || 'es-AR';
  c.theme = Object.assign({}, THEME, c.theme || {});
  c.copy = c.copy || {};
  c.seo = c.seo || {};
  c.seo.ogImage = c.seo.ogImage || '/og.jpg';
  c.seo.ogLocale = c.seo.ogLocale || 'es_AR';
  c.seo.ogDescription = c.seo.ogDescription || c.seo.description;
  c.business.logo = c.business.logo || '/apple-touch-icon.png';
  c.business.geoRegion = c.business.geoRegion || 'AR';
  // numeracion automatica de servicios y pasos
  (c.services || []).forEach((s, i) => { if (!s.num) s.num = String(i + 1).padStart(2, '0'); });
  (c.steps || []).forEach((s, i) => { if (!s.idx) s.idx = String(i + 1).padStart(2, '0'); });
  (c.area && c.area.points || []).forEach((p, i) => { if (!p.mark) p.mark = String(i + 1).padStart(2, '0'); });
  return c;
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

function build(slug) {
  const cfgPath = path.join(CLIENTS, slug + '.json');
  const c = normalize(JSON.parse(fs.readFileSync(cfgPath, 'utf8')));
  required(c, slug);

  c.styles = fs.readFileSync(path.join(TPL, 'styles.css'), 'utf8');
  c.jsonld = buildJsonLd(c);

  const html = render(fs.readFileSync(path.join(TPL, 'base.html'), 'utf8'), c, null);
  const out = path.join(DIST, slug);
  fs.mkdirSync(out, { recursive: true });

  const assets = copyDir(path.join(TPL, 'assets'), out) + copyDir(path.join(CLIENTS, slug + '.assets'), out);

  fs.writeFileSync(path.join(out, 'index.html'), html);
  fs.writeFileSync(path.join(out, 'sitemap.xml'), sitemap(c));
  fs.writeFileSync(path.join(out, 'robots.txt'), robots(c));
  if (c.site.domain) fs.writeFileSync(path.join(out, 'CNAME'), c.site.domain + '\n');
  if (c.site.spa404) fs.copyFileSync(path.join(out, 'index.html'), path.join(out, '404.html'));

  const leftover = html.match(/\{\{[^}]+\}\}/g);
  console.log(`  ${slug}  ->  dist/${slug}/  (${(html.length / 1024).toFixed(1)} KB, ${assets} assets)`);
  if (leftover) console.warn(`  aviso: variables sin resolver -> ${[...new Set(leftover)].join(' ')}`);
  return out;
}

const arg = process.argv[2];
if (!arg) {
  console.error('Uso: node scripts/build.js <slug> | --all');
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
  try { build(s); } catch (e) { fail++; console.error(`  ${s}  ERROR: ${e.message}`); }
}
process.exit(fail ? 1 : 0);
