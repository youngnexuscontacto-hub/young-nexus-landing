#!/usr/bin/env node
/**
 * Inyecta la capa SEO (canonical, datos estructurados, sitemap, robots)
 * en el index.html propio de Young Nexus. Idempotente: se puede correr N veces.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const FILE = path.join(ROOT, 'index.html');
const URL = 'https://www.youngnexus.com.ar/';

let html = fs.readFileSync(FILE, 'utf8');
const strip = s => s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

// FAQ: <summary>pregunta</summary> ... <p>respuesta</p>
const faq = [...html.matchAll(/<summary>([\s\S]*?)<\/summary>\s*<p>([\s\S]*?)<\/p>/g)]
  .map(m => ({ q: strip(m[1]), a: strip(m[2]) }));

// Servicios: solo las tarjetas .service-card del bloque #servicios -> <h3>nombre</h3><p>descripcion</p>.
// Entre #servicios y #precios hay otras secciones con <h3>/<p> (proceso, lanzamiento, por qué
// elegirnos) que no son servicios y no deben entrar al OfferCatalog. Las tarjetas .later son
// servicios "próximamente": se muestran en la web pero todavía no se ofrecen, así que tampoco entran.
const secc = (html.split('id="servicios"')[1] || '').split('id="precios"')[0];
const servicios = [...secc.matchAll(/<div class="(service-card[^"]*)"[^>]*>[\s\S]*?<h3>([\s\S]*?)<\/h3>\s*<p>([\s\S]*?)<\/p>/g)]
  .filter(m => !/\blater\b/.test(m[1]))
  .map(m => ({ name: strip(m[2]), description: strip(m[3]) }));

const graph = [
  {
    '@type': 'ProfessionalService',
    '@id': URL + '#business',
    name: 'Young Nexus',
    alternateName: 'Young Nexus — Transformación digital',
    description: 'Agencia de transformación digital: presencia en Google, turnos online, landing pages y automatización para comercios, profesionales y PyMES.',
    url: URL,
    image: URL + 'young-nexus-og.jpg',
    logo: URL + 'apple-touch-icon.png',
    email: 'youngnexus.contacto@gmail.com',
    priceRange: '$$',
    currenciesAccepted: 'ARS, USD',
    address: {
      '@type': 'PostalAddress',
      addressRegion: 'Ciudad Autónoma de Buenos Aires',
      addressCountry: 'AR'
    },
    areaServed: [
      { '@type': 'Country', name: 'Argentina' },
      { '@type': 'Place', name: 'Ciudad Autónoma de Buenos Aires' }
    ],
    knowsLanguage: ['es-AR', 'en'],
    hasOfferCatalog: {
      '@type': 'OfferCatalog',
      name: 'Servicios de transformación digital',
      itemListElement: servicios.map(s => ({
        '@type': 'Offer',
        itemOffered: { '@type': 'Service', name: s.name, description: s.description, provider: { '@id': URL + '#business' } }
      }))
    },
    potentialAction: {
      '@type': 'ReserveAction',
      name: 'Reservar diagnóstico digital',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: 'https://cal.com/young-nexus-7gtppu/diagnostico-digital',
        actionPlatform: ['http://schema.org/DesktopWebPlatform', 'http://schema.org/MobileWebPlatform']
      }
    }
  },
  {
    '@type': 'WebSite',
    '@id': URL + '#website',
    url: URL,
    name: 'Young Nexus',
    inLanguage: 'es-AR',
    publisher: { '@id': URL + '#business' }
  }
];

if (faq.length) {
  graph.push({
    '@type': 'FAQPage',
    '@id': URL + '#faq',
    mainEntity: faq.map(f => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a }
    }))
  });
}

const block = `<link rel="canonical" href="${URL}">
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">
<meta name="author" content="Young Nexus">
<meta name="geo.region" content="AR">
<meta name="geo.placename" content="Argentina">
<meta name="twitter:title" content="Young Nexus — Transformación digital para comercios, profesionales y PyMEs">
<meta name="twitter:description" content="Resolvemos los problemas digitales que te frenan: presencia en Google, turnos que se reservan solos, web que convierte y automatización.">
<meta name="twitter:image" content="${URL}young-nexus-og.jpg">
<script type="application/ld+json">
${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }, null, 2)}
</script>`;

const MARK_A = '<!-- seo:start -->';
const MARK_B = '<!-- seo:end -->';
const payload = `${MARK_A}\n${block}\n${MARK_B}`;

html = html.includes(MARK_A)
  ? html.replace(new RegExp(`${MARK_A}[\\s\\S]*?${MARK_B}`), payload)
  : html.replace('</head>', `${payload}\n</head>`);

// imagenes: dimensiones explicitas (evita CLS) y carga diferida fuera del nav
html = html.replace(/<img src="\/apple-touch-icon\.png" alt="Young Nexus" class="logo-img">/,
  '<img src="/apple-touch-icon.png" alt="Young Nexus" class="logo-img" width="28" height="28" decoding="async">');

fs.writeFileSync(FILE, html);

const today = new Date().toISOString().slice(0, 10);
fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${URL}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
`);
fs.writeFileSync(path.join(ROOT, 'robots.txt'), `User-agent: *
Allow: /

Sitemap: ${URL}sitemap.xml
`);

console.log(`SEO inyectado: ${servicios.length} servicios, ${faq.length} preguntas, sitemap.xml y robots.txt actualizados.`);
