// Готовые наборы слов под ниши, которые уже парсим. Пользователь выбирает
// набор в интерфейсе, а не вспоминает турецкие названия рубрик.

export const MAP_LEAD_CATEGORY_PRESETS = {
  detailing: {
    label: 'Детейлинг и автомойки',
    // Рубрики, которые Карты реально отдают турецким студиям: «Oto Cam
    // Filmcisi», «Araç Kaplama Hizmeti», «Detaylı Araç Temizlik Hizmeti».
    includeKeywords: [
      'detailing', 'detail', 'detayli arac', 'oto yikama', 'arac yikama',
      'oto kuafor', 'car wash', 'carwash', 'car care', 'oto bakim',
      'arac bakim', 'auto spa', 'seramik kaplama', 'ceramic coating',
      'arac kaplama', 'oto cam filmcisi', 'cam filmi', 'ppf', 'pasta cila',
      'oto temizlik', 'arac temizlik',
      'детейлинг', 'автомойка', 'мойка', 'полировка кузова', 'оклейка',
      'бронирование кузова', 'химчистка авто',
    ],
    // «temizlik» без «arac» — это клининг помещений, а «kuafor» без «oto» —
    // парикмахерская, поэтому стоп-слова держим узкими.
    excludeKeywords: [
      'laundry', 'camasir', 'kuru temizleme', 'hali yikama', 'kilim', 'rug',
      'carpet', 'berber', 'barber', 'guzellik', 'tattoo', 'piercing', 'pub',
      'bar', 'shisha', 'nargile', 'restoran', 'restaurant', 'cafe', 'kafe',
      'otel', 'hotel', 'market', 'eczane', 'emlak', 'lokanta', 'firin',
      'прачечная', 'ковров', 'барбершоп', 'парикмахер', 'клининг',
      'ресторан', 'кафе', 'салон красоты', 'тату',
    ],
  },
};

export function getMapLeadCategoryPreset(name) {
  return MAP_LEAD_CATEGORY_PRESETS[String(name || '').trim().toLowerCase()] || null;
}

export function listMapLeadCategoryPresets() {
  return Object.entries(MAP_LEAD_CATEGORY_PRESETS).map(([value, preset]) => ({
    value,
    label: preset.label,
    includeKeywords: preset.includeKeywords,
    excludeKeywords: preset.excludeKeywords,
  }));
}
