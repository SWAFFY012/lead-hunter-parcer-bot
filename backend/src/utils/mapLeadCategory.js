// Карты подмешивают в выдачу соседей по местности и смежные рубрики: по запросу
// «detailing» приходят прачечные, барберы и ковровые лавки. Отсеиваем их по
// рубрике карточки и по названию компании.

function toHaystack(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/i̇/g, 'i')
    .replace(/[İIı]/g, 'i')
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g')
    .replace(/ç/g, 'c')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u');
}

function normalizeList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  return String(value || '')
    .split(/[,\n;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function normalizeMapLeadCategoryFilter(filters = {}) {
  return {
    include: normalizeList(filters.includeKeywords),
    exclude: normalizeList(filters.excludeKeywords),
  };
}

export function hasActiveMapLeadCategoryFilter(filters) {
  const { include, exclude } = normalizeMapLeadCategoryFilter(filters);
  return include.length > 0 || exclude.length > 0;
}

// Ищем слово целиком, а не подстроку: иначе стоп-слово «бар» отсекает
// «Barracuda Detailing», а «мойка» не находится в «автомойке». Поэтому
// разрешающие слова ищем подстрокой, а стоп-слова — по границе слова.
function containsWord(haystack, needle) {
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) return false;
    const before = at === 0 ? '' : haystack[at - 1];
    const after = haystack[at + needle.length] || '';
    const isLetter = (ch) => ch !== '' && /[0-9a-zA-Zа-яё]/.test(ch);
    if (!isLetter(before) && !isLetter(after)) return true;
    from = at + 1;
  }
}

// Возвращает причину отказа или null, если карточка проходит.
// Стоп-слова сильнее разрешающих: «Oto Yıkama & Kuaför» — это парикмахерская
// с мойкой, а не детейлинг-студия.
export function checkMapLeadCategory(lead, filters) {
  const { include, exclude } = normalizeMapLeadCategoryFilter(filters);
  if (!include.length && !exclude.length) return null;

  const category = toHaystack(lead.title);
  const name = toHaystack(lead.name);
  const haystack = `${category} ${name}`;

  for (const word of exclude) {
    const needle = toHaystack(word);
    if (needle && containsWord(haystack, needle)) return `стоп-слово «${word}»`;
  }

  if (!include.length) return null;

  const hit = include.some((word) => {
    const needle = toHaystack(word);
    return needle && haystack.includes(needle);
  });
  if (hit) return null;

  return category
    ? `рубрика «${lead.title}» не в списке целевых`
    : 'нет совпадения с целевыми словами';
}

export function matchesMapLeadCategory(lead, filters) {
  return checkMapLeadCategory(lead, filters) === null;
}
