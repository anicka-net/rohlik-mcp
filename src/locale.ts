const BASE_URL = process.env.ROHLIK_BASE_URL || 'https://www.rohlik.cz';

const LOCALE_MAP: Record<string, string> = {
  'rohlik.cz': 'cs-CZ,cs;q=0.9,en;q=0.8',
  'knuspr.de': 'de-DE,de;q=0.9,en;q=0.8',
  'gurkerl.at': 'de-AT,de;q=0.9,en;q=0.8',
  'kifli.hu': 'hu-HU,hu;q=0.9,en;q=0.8',
  'sezamo.ro': 'ro-RO,ro;q=0.9,en;q=0.8'
};

const CURRENCY_MAP: Record<string, string> = {
  'rohlik.cz': 'CZK',
  'knuspr.de': 'EUR',
  'gurkerl.at': 'EUR',
  'kifli.hu': 'HUF',
  'sezamo.ro': 'RON'
};

function getDomain(): string | undefined {
  return Object.keys(LOCALE_MAP).find(d => BASE_URL.includes(d));
}

export function getAcceptLanguage(): string {
  const domain = getDomain();
  return domain ? LOCALE_MAP[domain] : 'en;q=0.9';
}

export function getCurrency(): string {
  const domain = getDomain();
  return domain ? CURRENCY_MAP[domain] : 'CZK';
}
