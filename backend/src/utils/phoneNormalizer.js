// Карты отдают телефон в местном формате: «+90 555 123 45 67», «0555 123 45 67»,
// «+7 (912) 345-67-89». Приводим к E.164, чтобы по номеру можно было звонить
// и писать в мессенджеры без ручной доработки.

// Код страны -> длина национального номера без кода и без ведущего нуля.
const REGIONS = {
  RU: { code: '7', nationalLength: 10, trunk: '8' },
  TR: { code: '90', nationalLength: 10, trunk: '0' },
};

export const DEFAULT_REGION = 'RU';

export function getRegion(region) {
  return REGIONS[String(region || '').toUpperCase()] || REGIONS[DEFAULT_REGION];
}

export function listRegions() {
  return Object.keys(REGIONS);
}

// Номер в международной записи сам сообщает страну, и она важнее выбранной
// в интерфейсе: турецкая выдача отдаёт +90 даже когда регион остался RU.
function matchByCountryCode(digits) {
  for (const [name, region] of Object.entries(REGIONS)) {
    if (digits.startsWith(region.code) && digits.length === region.code.length + region.nationalLength) {
      return name;
    }
  }
  return null;
}

// Возвращает номер в формате +<код страны><национальный номер> либо null,
// если из строки не собирается корректный номер.
export function normalizePhone(raw, region = DEFAULT_REGION) {
  let digits = String(raw || '').replace(/[^0-9]/g, '');
  if (!digits) return null;

  const explicit = String(raw || '').trim().startsWith('+') ? matchByCountryCode(digits) : null;
  const { code, nationalLength, trunk } = getRegion(explicit || region);

  if (digits.startsWith(code) && digits.length === code.length + nationalLength) {
    digits = digits.slice(code.length);
  } else if (trunk && digits.startsWith(trunk) && digits.length === trunk.length + nationalLength) {
    // Междугородний префикс внутри страны: 8 в России, 0 в Турции.
    digits = digits.slice(trunk.length);
  }

  if (digits.length !== nationalLength) return null;
  return `+${code}${digits}`;
}
