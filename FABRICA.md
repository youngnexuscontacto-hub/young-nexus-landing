# Fábrica de landings — Young Nexus

Sistema para producir la landing de un cliente en minutos, no en días.
Una plantilla + un JSON por cliente + un script sin dependencias.

## Cómo se usa

```bash
cp clients/_plantilla.json clients/kiosco-perez.json   # 1. copiar el esqueleto
$EDITOR clients/kiosco-perez.json                      # 2. completar los datos
npm run build kiosco-perez                             # 3. generar
npm run preview kiosco-perez                           # 4. ver en localhost:8080
```

Salida en `dist/kiosco-perez/`:

| Archivo | Para qué |
|---|---|
| `index.html` | La landing completa, un solo archivo, CSS embebido |
| `sitemap.xml` | Para Google Search Console |
| `robots.txt` | Apunta al sitemap |
| `CNAME` | Dominio propio del cliente en GitHub Pages |
| `favicon.png`, `apple-touch-icon.png` | Íconos (reemplazables por cliente) |

Generar todos los clientes de una: `npm run build:all`.

## Publicar

1. Crear un repo nuevo en la cuenta del cliente (o en la nuestra si todavía no tiene).
2. Copiar el contenido de `dist/<slug>/` a la raíz del repo y pushear a `main`.
3. Settings → Pages → Deploy from branch → `main` / `root`.
4. En el DNS del dominio del cliente: `CNAME www → <usuario>.github.io`.
   El apex (`sinwww.com.ar`) va con los 4 registros `A` de GitHub Pages.
5. Esperar el certificado y tildar **Enforce HTTPS**.

**Regla comercial: el dominio siempre lo paga y lo registra el cliente a su nombre.**
Nosotros configuramos el DNS, no somos titulares.

## Assets por cliente

Poné los archivos propios del cliente en `clients/<slug>.assets/`
(por ejemplo `og.jpg`, `favicon.png`, `apple-touch-icon.png`).
Se copian encima de los de `template/assets/`, así que sólo reemplazás lo que cambia.
El `og.jpg` es obligatorio si querés preview lindo en WhatsApp: 1200×630 px.

## SEO incluido de fábrica

Cada landing sale con:

- `<link rel="canonical">` y `robots` con `max-image-preview:large`
- Open Graph + Twitter Card completos
- **JSON-LD** con `@graph`: la ficha del negocio (tipo configurable: `Dentist`,
  `Plumber`, `Accounting`, `Store`, `LocalBusiness`…), `WebSite` y `FAQPage`
- `hasOfferCatalog` armado automáticamente desde la lista de servicios
- `areaServed` con los barrios que atiende → esto es lo que empuja el posicionamiento local
- `geo.region` / `geo.placename`
- `sitemap.xml` + `robots.txt`
- iframe de Cal.com con `loading="lazy"` e imágenes con dimensiones explícitas (no rompe el CLS)

Validar antes de entregar: [Rich Results Test](https://search.google.com/test/rich-results).

## Estructura del JSON

Todas las secciones son opcionales salvo `business`, `site`, `seo`, `hero` y `cta`.
Si omitís `plans`, la sección de precios no se renderiza. Lo mismo con
`problems`, `services`, `steps`, `area`, `faq` y `legal`.

La numeración de servicios (`01`, `02`…), pasos y puntos de zona es automática:
no la escribas a mano salvo que quieras forzarla con `num` / `idx` / `mark`.

En `hero.title`, `hero.promo`, `copy.pricingNote` y `legal.text` se acepta HTML
(usá `<em>` para el resaltado celeste del título y `<strong>` para negritas).
El resto de los campos se escapa solo.

## Guarda de paleta

`index.html` es producción y se queda **autocontenido**: tiene su CSS inline y no
consume `template/styles.css`. El precio de esa independencia es que hay dos copias
de la paleta, así que el build las compara antes de generar nada.

Compara los tokens de color (cualquier `--nombre: #hex`) del `:root` de cada archivo.
Si un valor difiere, o si un token existe en uno y no en el otro, el build **corta con
exit 1** y lista exactamente cuáles. No genera ninguna landing.

```
La paleta del sitio y la de la plantilla divergieron:

  --electric  index.html #2BA8DC  !=  template/styles.css #00D4FF

1 token(s) fuera de sincronia. Emparejalos y volve a correr el build.
El sitio manda: index.html es produccion, template/styles.css se ajusta a el.
```

Cuando cambies colores, tocá `index.html` y después emparejá `template/styles.css`.
Tokens que no son colores (`--radius`) se ignoran.

## Sectores sensibles

Si el cliente es de **salud** (historia clínica, turnos médicos, datos de obra social)
o maneja datos de menores, la sección `legal` no es opcional: la Ley 25.326 trata
esos datos como **sensibles** y la responsabilidad por un formulario que los recolecte
sin aviso de privacidad cae sobre el titular del sitio — y, por cadena contractual,
puede alcanzarnos a nosotros. Usá el bloque `legal` del demo como base y que el
contrato de servicio incluya la cláusula de exención por herramientas de terceros
(Google, GitHub, Cal.com).

## Archivos

```
template/base.html      plantilla con {{variables}}, {{#if}} y {{#each}}
template/styles.css     sistema de diseño (extraído del sitio propio)
template/assets/        íconos por defecto
clients/<slug>.json     datos de cada cliente
clients/<slug>.assets/  imágenes propias del cliente (opcional)
scripts/build.js        generador, sin dependencias
scripts/seo-inject.js   aplica la capa SEO al index.html de Young Nexus
```
