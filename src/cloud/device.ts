/** Le genre d'appareil, en un mot (« iPhone », « Windows »…), pour dire d'où vient une sauvegarde du compte. */
export function deviceName(userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent): string {
  const ua = userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'téléphone Android' : 'tablette Android';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Macintosh|Mac OS X/.test(ua)) return 'Mac';
  if (/CrOS/.test(ua)) return 'Chromebook';
  if (/Linux/.test(ua)) return 'Linux';
  return 'un appareil';
}
