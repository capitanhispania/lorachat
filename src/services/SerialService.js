/*
 * ==========================================================================
 * ARCHIVO: src/services/SerialService.js
 * QUÉ ES: La capa que habla por USB con el ESP32 (singleton).
 * --------------------------------------------------------------------------
 * RESPONSABILIDAD:
 *   - Abrir / cerrar la conexión USB con el ESP32.
 *   - Enviar líneas de texto ("1|..." o "2|...") al ESP32.
 *   - Recibir bytes, reconstruir LÍNEAS completas (cortando por '\n') y
 *     entregárselas a quien esté suscrito (el ChatManager).
 *   - Registrar en el Logger todo lo que entra y sale.
 * --------------------------------------------------------------------------
 * BUFFER DE LÍNEAS: el USB es un FLUJO continuo; un evento puede traer media
 * línea, una, o varias. Acumulamos en 'buffer' y emitimos al ver cada '\n'.
 *
 * DOBLE HEX: la librería USB envía/recibe en HEX; nuestras líneas son ASCII.
 *   Enviar:  ASCII -> hex -> lib.send(hex)
 *   Recibir: lib da hex -> ASCII -> buffer de líneas
 * --------------------------------------------------------------------------
 * DEPENDE DE: react-native-usb-serialport-for-android, Logger.
 * LO USA: ChatManager (onLine + sendLine) y ChatsListScreen (connect/estado).
 * ==========================================================================
 */

import { UsbSerialManager, Parity } from 'react-native-usb-serialport-for-android';
import Logger from './Logger';

// asciiToHex(): string ASCII -> hex (byte a byte).
function asciiToHex(str) {
  let hex = '';
  for (let i = 0; i < str.length; i++) {
    hex += str.charCodeAt(i).toString(16).padStart(2, '0');
  }
  return hex;
}

// hexToAscii(): hex -> string ASCII.
function hexToAscii(hex) {
  let str = '';
  for (let i = 0; i < hex.length; i += 2) {
    str += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
  }
  return str;
}

const SerialService = {
  usbSerial: null,     // puerto abierto (o null)
  subscription: null,  // suscripción al onReceived de la librería
  buffer: '',          // acumulador para reconstruir líneas
  lineListeners: [],   // callbacks para cada línea completa recibida
  statusListeners: [], // callbacks para cambios de conexión
  connected: false,    // ¿hay conexión abierta?

  // listDevices(): lista de dispositivos USB detectados.
  async listDevices() {
    return await UsbSerialManager.list();
  },

  // connect(): abre el PRIMER dispositivo USB a 115200. Devuelve true/false.
  async connect() {
    try {
      // 1) Listamos dispositivos.
      const devices = await UsbSerialManager.list();
      if (!devices || devices.length === 0) {
        Logger.log('no se encontró ningún dispositivo USB');
        return false;
      }

      // 2) Cogemos el primero (asumimos un único ESP32).
      const deviceId = devices[0].deviceId;

      // 3) Pedimos permiso al usuario (popup de Android).
      const granted = await UsbSerialManager.tryRequestPermission(deviceId);
      if (!granted) {
        Logger.log('permiso USB denegado por el usuario');
        return false;
      }

      // 4) Abrimos el puerto con los MISMOS parámetros que el ESP32.
      this.usbSerial = await UsbSerialManager.open(deviceId, {
        baudRate: 115200,
        parity: Parity.None,
        dataBits: 8,
        stopBits: 1,
      });

      // 5) Nos suscribimos a los datos entrantes ('event.data' viene en hex).
      this.subscription = this.usbSerial.onReceived((event) => {
        try {
          this._onHexReceived(event.data);
        } catch (e) {
          Logger.error('SerialService.onReceived', e);
        }
      });

      // 6) Conectado.
      this.connected = true;
      this._emitStatus();
      Logger.log('conectado con esp32 correcto.');
      return true;
    } catch (e) {
      // Cualquier fallo al conectar queda registrado como error.
      Logger.error('SerialService.connect', e);
      this.connected = false;
      this._emitStatus();
      return false;
    }
  },

  // disconnect(): cierra el puerto y limpia el estado.
  async disconnect() {
    if (this.subscription) {
      this.subscription.remove();
      this.subscription = null;
    }
    if (this.usbSerial) {
      try {
        await this.usbSerial.close();
      } catch (e) {
        Logger.error('SerialService.disconnect', e);
      }
      this.usbSerial = null;
    }
    this.buffer = '';
    this.connected = false;
    this._emitStatus();
    Logger.log('desconectado del esp32');
  },

  isConnected() {
    return this.connected;
  },

  // sendLine(): envía una línea completa al ESP32 (añade '\n').
  sendLine(line) {
    if (!this.usbSerial) {
      // Intento de envío sin conexión: lo registramos para saberlo.
      Logger.log('no se pudo enviar (sin conexión): ' + line);
      return;
    }
    try {
      const full = line + '\n';
      this.usbSerial.send(asciiToHex(full));
      // Registramos lo enviado (línea legible, sin el hex del transporte).
      Logger.log('enviado mensaje a esp32: ' + line);
    } catch (e) {
      Logger.error('SerialService.sendLine', e);
    }
  },

  // onLine(): registra un listener de líneas recibidas.
  onLine(cb) {
    this.lineListeners.push(cb);
    return () => {
      this.lineListeners = this.lineListeners.filter((f) => f !== cb);
    };
  },

  // onStatus(): registra un listener de cambios de conexión.
  onStatus(cb) {
    this.statusListeners.push(cb);
    return () => {
      this.statusListeners = this.statusListeners.filter((f) => f !== cb);
    };
  },

  // _onHexReceived(): PRIVADO. Procesa un trozo entrante en hex.
  _onHexReceived(hexChunk) {
    // Acumulamos lo recibido (convertido a texto) en el buffer.
    this.buffer += hexToAscii(hexChunk);

    // Extraemos todas las líneas completas que haya (hasta cada '\n').
    let idx;
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      let line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      line = line.replace(/\r$/, ''); // quitamos '\r' si viene '\r\n'
      if (line.length > 0) {
        // Registramos TODO lo recibido, incluso los "OK|..." informativos.
        Logger.log('recibido mensaje de esp32: ' + line);
        // Y lo entregamos a los suscriptores (el ChatManager).
        this.lineListeners.forEach((cb) => cb(line));
      }
    }
  },

  // _emitStatus(): PRIVADO. Avisa del estado de conexión.
  _emitStatus() {
    this.statusListeners.forEach((cb) => cb(this.connected));
  },
};

export default SerialService;
