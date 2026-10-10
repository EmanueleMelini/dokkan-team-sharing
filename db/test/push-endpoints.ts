// I casi degli endpoint push, buoni e cattivi: li provano sia push.test.mts
// (push_endpoint_ok e il CHECK di 0031) sia il test di lib/notify/endpoint.ts,
// cosi' la regola di Postgres e quella di TypeScript non possono divergere.
// Solo dati, niente database.
export const ENDPOINT_BUONI = [
  'https://fcm.googleapis.com/fcm/send/abc:APA91b-xyz_',
  'https://fcm.googleapis.com:443/wp/abc',
  'https://updates.push.services.mozilla.com/wpush/v2/gAAAAABl',
  'https://push.services.mozilla.com/wpush/v1/gAAAA',
  'https://web.push.apple.com/QGuQyavXutnMH3OPRyR',
  'https://wns2-par02p.notify.windows.com/w/?token=BQYAAA%2b%3d',
  'https://db5.notify.windows.com/w/?token=x',
]
export const ENDPOINT_CATTIVI = [
  'http://fcm.googleapis.com/fcm/send/x', 'https://fcm.googleapis.com', 'https://FCM.googleapis.com/x',
  'https://fcm.googleapis.com:8443/x', 'https://fcm.googleapis.com:80/x', 'https://fcm.googleapis.com.evil.com/x',
  'https://fcm.googleapis.com@evil.com/x', 'https://user:pw@fcm.googleapis.com/x', 'https://evil.com/fcm.googleapis.com/x',
  'https://notify.windows.com/w/', 'https://evil.com/.notify.windows.com/', 'https://a..notify.windows.com/x',
  'https://-a.notify.windows.com/x', 'https://evilnotify.windows.com/x', 'https://push.apple.com/x',
  'https://api.push.apple.com/x', 'https://127.0.0.1/x', 'https://[::1]/x', 'https://10.0.0.1:443/x',
  'https://fcm.googleapis.com/x#frag', 'https://fcm.googleapis.com/x y', 'https://fcm.googleapis.com/x\ny',
  'https://fcm.googleapis.com/café', `https://fcm.googleapis.com/${'a'.repeat(1000)}`, '',
]
