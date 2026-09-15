/*
 * ==========================================================================
 * ARCHIVO: src/state/ChatManager.js
 * QUÉ ES: El cerebro de la app. Une SerialService + FrameCodec + Storage +
 *         Logger y aplica TODA la lógica de mensajería.
 * --------------------------------------------------------------------------
 * DEPENDE DE: SerialService, FrameCodec, Storage, Logger.
 * LO USA: App.js (init) y las pantallas (métodos + subscribe).
 * --------------------------------------------------------------------------
 * FLUJO AL ENVIAR (yo -> Pepito):
 *   sendMessage(peerId, text) -> pide MESSAGE_ID -> guarda con ack=0 ->
 *   manda "1|<hex>" -> notifica UI.
 *
 * FLUJO AL RECIBIR ("R|<hex>|<rssi>,<snr>,<fei>"):
 *   TIPO_MSG -> asegura contacto (desconocido si nuevo) -> guarda si nuevo ->
 *              SIEMPRE responde ACK -> notifica.
 *   TIPO_ACK -> busca mi mensaje en el chat de quien envía el ACK y lo marca
 *              ack=1; si no está, se ignora.
 *
 * AL ABRIR UN CHAT: resendPending(peerId) reenvía mis mensajes con ack=0.
 * --------------------------------------------------------------------------
 * MEDIDAS DE RADIO (RSSI / SNR / Frequency Error):
 *   Las mide el módulo LoRa del ESP32 AL RECIBIR un paquete; la app no puede
 *   calcularlas por su cuenta. Por eso el firmware las añade al final de la
 *   línea, separadas por '|':   R|<hex>|<rssi>,<snr>,<fei>
 *   Si el firmware es antiguo y no las manda, todo sigue funcionando igual
 *   (simplemente el log dirá que no hay datos de radio).
 *
 *   OJO: en los mensajes ENVIADOS no hay RSSI/SNR/FEI. Una radio no se oye a
 *   sí misma; esas medidas solo existen en el receptor. Lo que sí sabemos al
 *   enviar es con qué parámetros se transmitió (SF/CR/TxPower), y cuando
 *   llega el ACK, sus medidas nos dicen la calidad del enlace de vuelta.
 * --------------------------------------------------------------------------
 * DISTANCIA (GPS):
 *   Cada mensaje normal y cada ACK llevan las coordenadas de quien los envía
 *   (ver FrameCodec). Al recibirlos, se comparan con MI última posición (Gps)
 *   y la distancia se añade al log de "Recibido". Si falta cualquiera de las dos
 *   o algo falla, el log pone "Distance = N/A" y el motivo; el mensaje se
 *   procesa exactamente igual que siempre.
 * ==========================================================================
 */

import SerialService from '../services/SerialService';
import Storage from '../services/Storage';
import Logger from '../services/Logger';
import Gps from '../services/Gps';
import {
  encodeFrame,
  decodeFrame,
  bytesToHex,
  hexToBytes,
  TYPE_MSG,
  TYPE_ACK,
  TYPE_HELLO,
} from '../services/FrameCodec';

const ChatManager = {
  myUserId: null,   // mi ID (se fija en init)
  myUsername: '',   // mi nombre (para la señal "¿Hay alguien ahí?")
  listeners: [],    // callbacks de la UI a avisar cuando cambian los datos

  // init(): guarda mi ID y nombre y engancha el listener del puerto serie.
  init(myUserId, myUsername) {
    this.myUserId = myUserId;
    this.myUsername = myUsername;
    SerialService.onLine((line) => this._onLine(line));
    Logger.log('app iniciada con USER_ID ' + myUserId);
    // Arrancamos el GPS en segundo plano (no esperamos: si falla, solo lo anota).
    Gps.start();
  },

  // subscribe(): la UI se entera de cambios. Devuelve función para quitarlo.
  subscribe(cb) {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((f) => f !== cb);
    };
  },

  _notify() {
    this.listeners.forEach((cb) => cb());
  },

  // --- AYUDAS PARA EL LOG ----------------------------------------------

  // _nombreDe(): PRIVADO. Nombre guardado de un userId, o "Desconocido" si
  // por lo que sea no está en contactos (seguro para que el log nunca falle).
  async _nombreDe(userId) {
    const contacts = await Storage.getContacts();
    const c = contacts[String(userId)];
    return c ? c.name : 'Desconocido(' + userId + ')';
  },

  // _parseRadio(): PRIVADO. Lee el trozo "rssi,snr,fei" que añade el ESP32.
  // Si no viene (firmware antiguo) devuelve null.
  _parseRadio(trozo) {
    if (!trozo) return null;
    const p = trozo.split(',');
    if (p.length < 3) return null;
    return { rssi: p[0], snr: p[1], fei: p[2] };
  },

  // _textoRadio(): PRIVADO. Formatea las medidas de radio para el log.
  _textoRadio(radio) {
    if (!radio) return ', sin datos de radio (el ESP32 no los envía)';
    return (
      ', RSSI = ' + radio.rssi + ' dBm' +
      ', SNR = ' + radio.snr + ' dB' +
      ', Frequency Error = ' + radio.fei + ' Hz'
    );
  },

  // _textoConfig(): PRIVADO. Parámetros con los que se transmite (para envíos).
  async _textoConfig() {
    const cfg = await Storage.getConfig();
    return ' [SF=' + cfg.sf + ', CR=' + cfg.cr + ', TxPower=' + cfg.txPower + ' dBm]';
  },

  // _textoDistancia(): PRIVADO. Distancia entre el emisor y yo, para el log.
  // Si falta algún dato o algo falla, anota el motivo y devuelve "N/A".
  _textoDistancia(frame) {
    try {
      if (frame.lat == null || frame.lon == null) {
        Logger.log('GPS: el mensaje llegó sin coordenadas (el emisor no tenía posición)');
        return ', Distance = N/A';
      }
      if (Math.abs(frame.lat) > 90 || Math.abs(frame.lon) > 180) {
        Logger.log('error: [ChatManager._textoDistancia] coordenadas del emisor inválidas: ' + frame.lat + ', ' + frame.lon);
        return ', Distance = N/A';
      }
      const yo = Gps.getMyPos();
      if (!yo) {
        Logger.log('GPS: todavía no tengo mi propia posición');
        return ', Distance = N/A';
      }
      const km = Gps.distanceKm(yo, { lat: frame.lat, lon: frame.lon });
      // Por debajo de 1 km lo mostramos en metros, que se lee mejor.
      if (km < 1) return ', Distance = ' + Math.round(km * 1000) + ' m';
      return ', Distance = ' + km.toFixed(2) + ' km';
    } catch (e) {
      Logger.error('ChatManager._textoDistancia', e);
      return ', Distance = N/A';
    }
  },

  // --- ENVIAR ----------------------------------------------------------

  // sendMessage(): envía un mensaje normal a 'peerId'.
  async sendMessage(peerId, text) {
    try {
      // 1) Pedimos un MESSAGE_ID nuevo.
      const messageId = await Storage.bumpNextMessageId();

      // 2) Guardamos el mensaje en MI chat con ese contacto, sin confirmar.
      const chat = await Storage.getChat(peerId);
      chat.push({ messageId, fromMe: true, text, ack: 0, ts: Date.now() });
      await Storage.saveChat(peerId, chat);

      // 3) Log semántico + envío de la trama (con MI userId).
      // No hay RSSI/SNR al enviar (ver cabecera): logueamos los parámetros
      // de transmisión, que es lo único real que sabemos en este momento.
      const nombre = await this._nombreDe(peerId);
      Logger.log(
        'Enviado: mensaje de texto a ' + nombre +
        ' (msg #' + messageId + '): "' + text + '"' +
        (await this._textoConfig())
      );
      // Mi última posición GPS (o null si todavía no hay).
      const pos = Gps.getMyPos();
      if (!pos) Logger.log('GPS: no tengo mi posición todavía, el mensaje se envía sin coordenadas');
      this._sendFrame({
        userId: this.myUserId,
        messageId,
        type: TYPE_MSG,
        text,
        lat: pos ? pos.lat : null,
        lon: pos ? pos.lon : null,
      });

      // 4) Refrescamos la UI.
      this._notify();
    } catch (e) {
      Logger.error('ChatManager.sendMessage', e);
    }
  },

  // resendPending(): reenvía en orden los mensajes míos con ack=0 del chat.
  async resendPending(peerId) {
    try {
      const chat = await Storage.getChat(peerId);
      const pending = chat
        .filter((m) => m.fromMe && m.ack === 0)
        .sort((a, b) => a.messageId - b.messageId);

      if (pending.length > 0) {
        const nombre = await this._nombreDe(peerId);
        Logger.log(
          'Enviado: reintento de ' + pending.length + ' mensaje(s) pendientes a ' + nombre +
          (await this._textoConfig())
        );
      }

      // Los reintentos llevan mi posición ACTUAL (o ninguna si no hay).
      const pos = Gps.getMyPos();
      for (const m of pending) {
        this._sendFrame({
          userId: this.myUserId,
          messageId: m.messageId,
          type: TYPE_MSG,
          text: m.text,
          lat: pos ? pos.lat : null,
          lon: pos ? pos.lon : null,
        });
      }
    } catch (e) {
      Logger.error('ChatManager.resendPending', e);
    }
  },

  // applyConfig(): manda al ESP32 la configuración de radio ("2|sf,cr,tx").
  applyConfig(cfg) {
    Logger.log('configurado esp32 con valores de settings: SF=' + cfg.sf + ', CR=' + cfg.cr + ', TxPower=' + cfg.txPower);
    SerialService.sendLine('2|' + cfg.sf + ',' + cfg.cr + ',' + cfg.txPower);
  },

  // sendHello(): emite la señal "¿Hay alguien ahí?" en broadcast.
  // Sirve para arrancar: quien NO te tenga guardado verá un chat nuevo tuyo.
  // Es fuego y olvido: no se guarda ni espera ACK; se puede repetir a voluntad.
  async sendHello() {
    try {
      // Un id nuevo para que no choque con futuros mensajes normales.
      const messageId = await Storage.bumpNextMessageId();
      // El texto incluye mi nombre, para que el desconocido sepa quién soy.
      const text = '¿Hay alguien ahi? Mi nombre es ' + this.myUsername + '.';
      Logger.log(
        'Enviado: mensaje de broadcast "¿Hay alguien ahí?" como ' + this.myUsername +
        ' (msg #' + messageId + ')' + (await this._textoConfig())
      );
      // Trama de tipo HELLO con MI userId.
      this._sendFrame({ userId: this.myUserId, messageId, type: TYPE_HELLO, text });
    } catch (e) {
      Logger.error('ChatManager.sendHello', e);
    }
  },

  // --- RECIBIR ---------------------------------------------------------

  // _onLine(): PRIVADO. Procesa una línea entrante del ESP32.
  async _onLine(line) {
    try {
      // Solo nos interesan los mensajes recibidos "R|<hex>".
      // (Los "OK|..." ya los registró SerialService; aquí los ignoramos.)
      if (!line.startsWith('R|')) return;

      // Formato: "R|<hex>" o "R|<hex>|<rssi>,<snr>,<fei>" (medidas opcionales).
      const partes = line.split('|');
      const hex = partes[1] || '';
      const radio = this._parseRadio(partes[2]);

      const frame = decodeFrame(hexToBytes(hex));
      if (!frame) {
        Logger.log('error: [ChatManager._onLine] trama incorrecta: ' + line);
        return;
      }

      // Ignoramos tramas con MI propio id (por si acaso).
      if (frame.userId === this.myUserId) return;

      if (frame.type === TYPE_MSG) {
        await this._handleIncomingMessage(frame, radio);
      } else if (frame.type === TYPE_ACK) {
        await this._handleIncomingAck(frame, radio);
      } else if (frame.type === TYPE_HELLO) {
        await this._handleIncomingHello(frame, radio);
      }
    } catch (e) {
      Logger.error('ChatManager._onLine', e);
    }
  },

  // _handleIncomingMessage(): PRIVADO. Llega un mensaje normal de 'senderId'.
  async _handleIncomingMessage(frame, radio) {
    const senderId = frame.userId;

    // 1) Aseguramos el contacto. Si es nuevo, se crea DESCONOCIDO.
    const contacts = await Storage.getContacts();
    if (!contacts[String(senderId)]) {
      await Storage.upsertContact(senderId, { known: false });
      Logger.log('nuevo usuario desconocido detectado: ' + senderId);
    }

    // Nombre para los logs (ya existe el contacto seguro).
    const nombre = await this._nombreDe(senderId);

    // 2) Dedup por messageId de mensajes recibidos.
    const chat = await Storage.getChat(senderId);
    const yaExiste = chat.some((m) => !m.fromMe && m.messageId === frame.messageId);

    // 3) Si es nuevo, lo guardamos.
    if (!yaExiste) {
      chat.push({
        messageId: frame.messageId,
        fromMe: false,
        text: frame.text,
        ack: 1,
        ts: Date.now(),
      });
      await Storage.saveChat(senderId, chat);
      Logger.log(
        'Recibido: mensaje de texto de ' + nombre +
        ' (msg #' + frame.messageId + '): "' + frame.text + '"' +
        this._textoDistancia(frame) +
        this._textoRadio(radio)
      );
    } else {
      Logger.log(
        'Recibido: mensaje de texto DUPLICADO de ' + nombre +
        ' (msg #' + frame.messageId + '), reenvío ACK' +
        this._textoRadio(radio)
      );
    }

    // 4) SIEMPRE respondemos ACK (aunque fuese duplicado).
    await this._sendAck(frame.messageId, nombre);

    // 5) Refrescamos la UI.
    this._notify();
  },

  // _handleIncomingHello(): PRIVADO. Llega una señal "¿Hay alguien ahí?".
  async _handleIncomingHello(frame, radio) {
    const senderId = frame.userId;

    // Si YA tenemos guardado a este usuario (conocido o desconocido), la
    // ignoramos: ya existe un chat con él y no queremos duplicar la entrada.
    // Aun así lo logueamos con sus medidas: saber que su broadcast llega
    // (y con qué calidad) es justo lo que interesa para probar alcance.
    const contacts = await Storage.getContacts();
    if (contacts[String(senderId)]) {
      const nombreYaGuardado = contacts[String(senderId)].name;
      Logger.log(
        'Recibido: mensaje de broadcast de ' + nombreYaGuardado +
        ' -> IGNORADO (ya está guardado como contacto)' +
        this._textoRadio(radio)
      );
      return;
    }

    // Es alguien nuevo: lo creamos como desconocido y guardamos su saludo como
    // un mensaje recibido, para que aparezca como chat nuevo en la lista.
    await Storage.upsertContact(senderId, { known: false });
    const chat = await Storage.getChat(senderId);
    chat.push({
      messageId: frame.messageId,
      fromMe: false,
      text: frame.text,
      ack: 1,
      ts: Date.now(),
    });
    await Storage.saveChat(senderId, chat);
    Logger.log(
      'Recibido: mensaje de broadcast de DESCONOCIDO (' + senderId + '): "' + frame.text + '"' +
      ' -> creado chat nuevo' +
      this._textoRadio(radio)
    );

    // No respondemos ACK: la señal es fuego y olvido. Si quieres hablar con él,
    // abres el chat, le pones nombre y le escribes (eso ya es un mensaje normal).
    this._notify();
  },

  // _handleIncomingAck(): PRIVADO. Llega un ACK de 'senderId' para mi msg M.
  async _handleIncomingAck(frame, radio) {
    const senderId = frame.userId;
    const messageId = frame.messageId;
    const nombre = await this._nombreDe(senderId);

    // Mi mensaje enviado a ese usuario está en SU chat. Si el ACK viene de
    // otro, en su chat no habrá nada que coincida y se ignora.
    const chat = await Storage.getChat(senderId);
    let cambiado = false;

    for (const m of chat) {
      if (m.fromMe && m.messageId === messageId && m.ack === 0) {
        m.ack = 1; // confirmado -> doble tick
        cambiado = true;
      }
    }

    if (cambiado) {
      await Storage.saveChat(senderId, chat);
      Logger.log(
        'Recibido: mensaje de ACK de ' + nombre +
        ' (msg #' + messageId + ') -> confirmado (doble tick)' +
        this._textoDistancia(frame) +
        this._textoRadio(radio)
      );
      this._notify();
    } else {
      Logger.log(
        'Recibido: mensaje de ACK de ' + nombre +
        ' (msg #' + messageId + ') -> ignorado (no era para él)' +
        this._textoDistancia(frame) +
        this._textoRadio(radio)
      );
    }
  },

  // _sendAck(): PRIVADO. Envía un ACK con MI userId, el messageId dado y mi
  // última posición GPS (o ninguna si todavía no hay).
  async _sendAck(messageId, nombreDestino) {
    Logger.log(
      'Enviado: mensaje de ACK a ' + nombreDestino + ' (msg #' + messageId + ')' +
      (await this._textoConfig())
    );
    const pos = Gps.getMyPos();
    this._sendFrame({
      userId: this.myUserId,
      messageId,
      type: TYPE_ACK,
      text: '',
      lat: pos ? pos.lat : null,
      lon: pos ? pos.lon : null,
    });
  },

  // _sendFrame(): PRIVADO. Codifica una trama y la manda por serie ("1|<hex>").
  _sendFrame(frameObj) {
    try {
      const bytes = encodeFrame(frameObj);
      const hex = bytesToHex(bytes);
      SerialService.sendLine('1|' + hex);
    } catch (e) {
      Logger.error('ChatManager._sendFrame', e);
    }
  },
};

export default ChatManager;
