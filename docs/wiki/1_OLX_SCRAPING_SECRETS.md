# OLX Scraping Secrets: Bypassing Anti-Bot Systems

Парсинг таких площадок как OLX требует продвинутого подхода из-за наличия защиты от ботов (Cloudflare, Datadome, кастомные капчи). Обычный Headless-браузер будет заблокирован после первых 5-10 запросов.

## 1. Настройка Playwright Stealth
Использование `puppeteer-extra-plugin-stealth` (адаптированного под Playwright) критически важно.
- **Удаление флагов автоматизации:** Скрытие `navigator.webdriver`.
- **Подмена User-Agent:** Использование актуального UA обычного браузера.

## 2. Обход Cloudflare и Fingerprinting

Anti-bot системы анализируют отпечаток браузера (Fingerprint). Чтобы казаться уникальным человеком, нужно "отравлять" отпечатки:

### Canvas и WebGL Spoofing
Необходимо встраивать скрипт перед загрузкой страницы (через `page.addInitScript`), который слегка искажает рендеринг Canvas и WebGL. Это делает отпечаток уникальным для каждой сессии.
```javascript
// Псевдокод спуфинга WebGL
const getParameter = WebGLRenderingContext.prototype.getParameter;
WebGLRenderingContext.prototype.getParameter = function(parameter) {
  if (parameter === 37445) return 'Intel Inc.'; // Подмена Vendor
  if (parameter === 37446) return 'Intel Iris OpenGL Engine'; // Подмена Renderer
  return getParameter(parameter);
};
```

### Шрифты (Fonts)
Боты часто имеют стандартный набор шрифтов сервера (Ubuntu/Debian). Нужно эмулировать шрифты Windows или macOS, подменяя ответы на запросы к `fontList`.

## 3. Тайминги и Поведение (Human Behavior)

- **Динамические таймауты:** Никаких `waitForTimeout(2000)`. Используйте рандом: `Math.random() * (4000 - 1500) + 1500`.
- **Движение мыши (Mouse Jitter):** Перед кликом на "Показать номер" (на OLX), мышь должна двигаться по кривой Безье, а не телепортироваться к кнопке.
- **Скроллинг:** Имитируйте чтение описания объявления плавным скроллингом вниз-вверх перед нажатием кнопки показа номера.

## 4. IP и Сессии
- **Residential Proxies:** Парсить OLX нужно строго через резидентские прокси той страны, чей OLX парсится.
- **Сохранение сессии (`storageState`):** После ручного прохождения капчи и авторизации, сохраняйте cookies и localStorage. При повторных запусках с тем же IP и `storageState` капча появляться не будет.
- **Headed Mode:** При сильных блокировках Cloudflare, запускайте браузер не в `headless: true`, а в видимом режиме на виртуальном дисплее (Xvfb в Linux).
