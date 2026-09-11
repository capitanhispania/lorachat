/*
 * ==========================================================================
 * ARCHIVO: src/services/Gps.js
 * QUÉ ES: Mantiene MI última posición GPS (la del móvil) y calcula distancias.
 * --------------------------------------------------------------------------
 * IDEA:
 *   - Al arrancar pedimos permiso de ubicación y dejamos el GPS "vigilando"
 *     (watchPosition). Cada vez que llega una posición la guardamos.
 *   - Al enviar un mensaje NO esperamos al GPS: usamos la última posición
 *     guardada. Si todavía no hay ninguna, el mensaje va sin coordenadas.
 *   - REGLA DE ORO: si algo del GPS falla (permiso, librería, señal...), se
 *     anota en el log y la app sigue funcionando igual, solo que sin
 *     coordenadas. Nada de este archivo puede romper el envío/recepción.
 * --------------------------------------------------------------------------
 * DEPENDE DE: Logger y la librería @react-native-community/geolocation.
 * LO USA: ChatManager.
 *
 * MÉTODOS:
 *   start()          -> pide permiso y arranca la vigilancia del GPS.
 *   getMyPos()       -> { lat, lon } con mi última posición, o null.
 *   distanceKm(a, b) -> distancia en km entre dos posiciones { lat, lon }.
 * ==========================================================================
 */

import { PermissionsAndroid } from 'react-native';
import Logger from './Logger';

const Gps = {
  lastPos: null,   // mi última posición { lat, lon }, o null si aún no hay
  lastError: '',   // último error anotado (para no repetirlo en el log)

  // start(): pide el permiso de ubicación y arranca el GPS en segundo plano.
  // Todo va dentro de try/catch: si falla, solo queda el error en el log.
  async start() {
    try {
      // 1) Permiso. En Android 12+ hay que pedir los dos (precisa y aproximada).
      const res = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
      ]);
      if (res[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION] !== PermissionsAndroid.RESULTS.GRANTED) {
        Logger.log('error: [Gps.start] permiso de ubicación precisa denegado, los mensajes irán sin coordenadas');
        return;
      }

      // 2) Cargamos la librería aquí dentro (y no arriba con los import) para
      // que, si falla al cargarse, el error lo capture este try/catch.
      const Geolocation = require('@react-native-community/geolocation').default;

      // 3) Vigilancia continua: cada nueva posición se guarda en lastPos.
      Geolocation.watchPosition(
        (pos) => {
          if (!this.lastPos) Logger.log('GPS: primera posición obtenida');
          this.lastPos = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        },
        (err) => {
          // El mismo error puede repetirse muchas veces: solo lo anotamos si cambia.
          const msg = err && err.message ? err.message : String(err);
          if (msg !== this.lastError) {
            this.lastError = msg;
            Logger.log('error: [Gps.watchPosition] ' + msg);
          }
        },
        { enableHighAccuracy: true, interval: 5000, distanceFilter: 0 },
      );
      Logger.log('GPS: arrancado, esperando posición');
    } catch (e) {
      Logger.error('Gps.start', e);
    }
  },

  // getMyPos(): mi última posición conocida, o null si no hay ninguna.
  getMyPos() {
    return this.lastPos;
  },

  // distanceKm(): distancia en km entre dos puntos { lat, lon } sobre la
  // superficie de la Tierra (fórmula del haversine).
  distanceKm(a, b) {
    const R = 6371;             // radio medio de la Tierra en km
    const rad = Math.PI / 180;  // para pasar de grados a radianes
    const dLat = (b.lat - a.lat) * rad;
    const dLon = (b.lon - a.lon) * rad;
    const h =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a.lat * rad) * Math.cos(b.lat * rad) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  },
};

export default Gps;
