// -----------------------------------------------------------------------------
// The texts of the connection status and of the test button. Every text is a
// { en, fr } object (setConnectionStatus refuses a plain string). Never a raw
// answer, never a credential.
// -----------------------------------------------------------------------------

import { MAX_STATUS_LENGTH } from './constants.js';

/** 1760983200000 -> "18:00 UTC" (the container has no time zone of the user). */
export const utcTime = (ms) =>
  Number.isFinite(ms) ? `${new Date(ms).toISOString().slice(11, 16)} UTC` : '?';

const cut = (s) => (s.length > MAX_STATUS_LENGTH ? `${s.slice(0, MAX_STATUS_LENGTH - 1)}…` : s);
const both = (make) => ({ en: cut(make('en')), fr: cut(make('fr')) });

/** 12.54 -> "12.5", "12,5" in French. */
export const numberText = (value, lang) => {
  const text = String(Math.round(value * 10) / 10);
  return lang === 'fr' ? text.replace('.', ',') : text;
};

const CONFIG_ERRORS = {
  address_missing: {
    en: 'Enter the address (IP) of your Meteobridge, its user name and its password',
    fr: "Saisissez l'adresse (IP) de votre Meteobridge, son nom d'utilisateur et son mot de passe",
  },
  address_invalid: {
    en: 'Address not understood: an IPv4 address or a host name, with an optional port (192.168.1.50 or meteobridge.lan:8080)',
    fr: 'Adresse non comprise : une adresse IPv4 ou un nom d’hôte, avec un port facultatif (192.168.1.50 ou meteobridge.lan:8080)',
  },
  username_missing: {
    en: 'Enter the user name of the Meteobridge web interface (a password is never sent alone)',
    fr: "Saisissez le nom d'utilisateur de l'interface web du Meteobridge (un mot de passe n'est jamais envoyé seul)",
  },
  password_missing: {
    en: 'Enter the password of the Meteobridge web interface',
    fr: "Saisissez le mot de passe de l'interface web du Meteobridge",
  },
  username_invalid: {
    en: 'The user name holds a forbidden character (":", a control or non-ASCII character) or is too long',
    fr: "Le nom d'utilisateur contient un caractère interdit (« : », un caractère de contrôle ou non ASCII) ou est trop long",
  },
  password_invalid: {
    en: 'The password holds a control character or is too long (128 bytes at most)',
    fr: 'Le mot de passe contient un caractère de contrôle ou est trop long (128 octets au plus)',
  },
};

/** Why the gateway gave no value. */
export const REASONS = {
  denied: {
    en: 'access forbidden (HTTP 403): not a refusal of the password; is something between Gladys and the gateway?',
    fr: "accès interdit (HTTP 403) : ce n'est pas un refus du mot de passe ; quelque chose s'interpose-t-il entre Gladys et la passerelle ?",
  },
  busy: { en: 'gateway busy (pause)', fr: 'passerelle occupée (pause)' },
  invalid: {
    en: 'the answer is not that of a Meteobridge (template page missing, or no MAC address)',
    fr: "la réponse n'est pas celle d'un Meteobridge (page de gabarit absente, ou pas d'adresse MAC)",
  },
  failed: { en: 'no answer', fr: 'pas de réponse' },
};

const reason = (kind, lang) => (REASONS[kind] ?? REASONS.failed)[lang];

export const T = {
  configError: (code) =>
    both((lang) => (CONFIG_ERRORS[code] ?? CONFIG_ERRORS.address_missing)[lang]),
  configUnreadable: both((lang) =>
    lang === 'fr'
      ? 'Configuration non lue (Gladys ne répond pas) : nouvel essai bientôt'
      : 'Configuration not read (Gladys does not answer): trying again soon',
  ),
  dataUnreadable: both((lang) =>
    lang === 'fr'
      ? 'Le dossier /data est illisible : nouvel essai toutes les 10 s, aucune lecture en attendant'
      : 'The /data folder cannot be read: trying again every 10 s, no read meanwhile',
  ),
  dataUnwritable: both((lang) =>
    lang === 'fr'
      ? "Le dossier /data n'accepte pas l'écriture : la lecture attend (nouvel essai dans 10 s)"
      : 'The /data folder cannot be written: the read waits (trying again in 10 s)',
  ),
  refused: both((lang) =>
    lang === 'fr'
      ? "Le Meteobridge refuse le nom d'utilisateur ou le mot de passe (ceux de son interface web). Corrigez-les et enregistrez : aucun nouvel essai tout seul tant qu'ils ne changent pas, ou jusqu'à un clic sur Tester."
      : 'The Meteobridge refuses the user name or the password (those of its web interface). Correct them and save: no new try by itself until they change, or until a click on Test.',
  ),
  failed: (kind, next) =>
    both((lang) =>
      lang === 'fr'
        ? `Meteobridge sans valeur : ${reason(kind, lang)}. Prochaine lecture possible à ${utcTime(next)}.`
        : `Meteobridge without value: ${reason(kind, lang)}. Next read possible at ${utcTime(next)}.`,
    ),
  noValue: (next) =>
    both((lang) =>
      lang === 'fr'
        ? `Le Meteobridge répond mais ne donne aucune valeur récente (capteurs non entendus). Prochaine lecture possible à ${utcTime(next)}.`
        : `The Meteobridge answers but gives no recent value (sensors not heard). Next read possible at ${utcTime(next)}.`,
    ),
  waiting: (next) =>
    both((lang) =>
      lang === 'fr'
        ? `En attente de la première lecture (possible à ${utcTime(next)}).`
        : `Waiting for the first read (possible at ${utcTime(next)}).`,
    ),
  ok: ({ name, count, minutes }) =>
    both((lang) =>
      lang === 'fr'
        ? `${name} : ${count} valeur(s) récente(s), lues toutes les ${minutes} min.`
        : `${name}: ${count} recent value(s), read every ${minutes} min.`,
    ),
  tooSoon: (next) =>
    both((lang) =>
      lang === 'fr'
        ? `Rien n'est lu plus tôt que l'intervalle, pas même par ce bouton : prochaine lecture possible à ${utcTime(next)}.`
        : `Nothing reads sooner than the interval, not even this button: next read possible at ${utcTime(next)}.`,
    ),
  paused: (until) =>
    both((lang) =>
      lang === 'fr'
        ? `Passerelle occupée (HTTP 429 ou 5xx) : en pause jusqu'à ${utcTime(until)}.`
        : `Gateway busy (HTTP 429 or 5xx): paused until ${utcTime(until)}.`,
    ),
};

/** The last values for the test button: "temperature 12.3 °C, ..." per language. */
export function valuesLine(values, ageMinutes, lang) {
  const parts = [];
  const add = (key, en, fr, unit) => {
    if (typeof values?.[key] === 'number') {
      parts.push(`${lang === 'fr' ? fr : en} ${numberText(values[key], lang)}${unit}`);
    }
  };
  add('temperature', 'temperature', 'température', ' °C');
  add('humidity', 'humidity', 'humidité', ' %');
  add('pressure', 'pressure', 'pression', ' hPa');
  add('wind_speed', 'wind', 'vent', ' km/h');
  add('rain_today', 'rain today', "pluie aujourd'hui", ' mm');
  add('indoor_temperature', 'indoor', 'intérieur', ' °C');
  if (parts.length === 0) {
    return '';
  }
  parts.push(lang === 'fr' ? `mesure d'il y a ${ageMinutes} min` : `read ${ageMinutes} min ago`);
  return parts.join(', ');
}

/** The test button answer: the status text, then the last values when any. */
export const report = (status, values) =>
  values
    ? { en: cut(`${status.en}\n${values.en}`), fr: cut(`${status.fr}\n${values.fr}`) }
    : status;
