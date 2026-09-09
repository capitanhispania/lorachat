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
 * FLUJO AL RECIBIR ("R|<hex>"):
 *   TIPO_MSG -> asegura contacto (desconocido si nuevo) -> guarda si nuevo ->
 *              SIEMPRE responde ACK -> notifica.
 *   TIPO_ACK -> busca mi mensaje en el chat de quien envía el ACK y lo marca
 *              ack=1; si no está, se ignora.
 *
 * AL ABRIR UN CHAT: resendPending(peerId) reenvía mis mensajes con ack=0.
 * ==========================================================================
 */

import SerialService from '../services/SerialService';
import Storage from '../services/Storage';
import Logger from '../services/Logger';
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
      Logger.log('enviando a Usuario ' + peerId + ' (msg #' + messageId + '): "' + text + '"');
      this._sendFrame({ userId: this.myUserId, messageId, type: TYPE_MSG, text });

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
        Logger.log('reintentando ' + pending.length + ' mensaje(s) pendientes con Usuario ' + peerId);
      }

      for (const m of pending) {
        this._sendFrame({
          userId: this.myUserId,
          messageId: m.messageId,
          type: TYPE_MSG,
          text: m.text,
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
      Logger.log('enviando señal "¿Hay alguien ahí?" como ' + this.myUsername);
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

      const hex = line.slice(2);
      const frame = decodeFrame(hexToBytes(hex));
      if (!frame) {
        Logger.log('error: [ChatManager._onLine] trama inválida: ' + line);
        return;
      }

      // Ignoramos tramas con MI propio id (por si acaso).
      if (frame.userId === this.myUserId) return;

      if (frame.type === TYPE_MSG) {
        await this._handleIncomingMessage(frame);
      } else if (frame.type === TYPE_ACK) {
        await this._handleIncomingAck(frame);
      } else if (frame.type === TYPE_HELLO) {
        await this._handleIncomingHello(frame);
      }
    } catch (e) {
      Logger.error('ChatManager._onLine', e);
    }
  },

  // _handleIncomingMessage(): PRIVADO. Llega un mensaje normal de 'senderId'.
  async _handleIncomingMessage(frame) {
    const senderId = frame.userId;

    // 1) Aseguramos el contacto. Si es nuevo, se crea DESCONOCIDO.
    const contacts = await Storage.getContacts();
    if (!contacts[String(senderId)]) {
      await Storage.upsertContact(senderId, { known: false });
      Logger.log('nuevo usuario desconocido detectado: ' + senderId);
    }

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
      Logger.log('mensaje recibido de Usuario ' + senderId + ' (msg #' + frame.messageId + '): "' + frame.text + '"');
    } else {
      Logger.log('mensaje duplicado de Usuario ' + senderId + ' (msg #' + frame.messageId + '), reenvío ACK');
    }

    // 4) SIEMPRE respondemos ACK (aunque fuese duplicado).
    this._sendAck(frame.messageId);

    // 5) Refrescamos la UI.
    this._notify();
  },

  // _handleIncomingHello(): PRIVADO. Llega una señal "¿Hay alguien ahí?".
  async _handleIncomingHello(frame) {
    const senderId = frame.userId;

    // Si YA tenemos guardado a este usuario (conocido o desconocido), la
    // ignoramos: ya existe un chat con él y no queremos duplicar la entrada.
    const contacts = await Storage.getContacts();
    if (contacts[String(senderId)]) {
      Logger.log('señal de Usuario ' + senderId + ' ignorada (ya es contacto)');
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
    Logger.log('nueva señal de Usuario ' + senderId + ': "' + frame.text + '"');

    // No respondemos ACK: la señal es fuego y olvido. Si quieres hablar con él,
    // abres el chat, le pones nombre y le escribes (eso ya es un mensaje normal).
    this._notify();
  },

  // _handleIncomingAck(): PRIVADO. Llega un ACK de 'senderId' para mi msg M.
  async _handleIncomingAck(frame) {
    const senderId = frame.userId;
    const messageId = frame.messageId;

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
      Logger.log('ACK de Usuario ' + senderId + ' para msg #' + messageId + ' -> confirmado (doble tick)');
      this._notify();
    } else {
      Logger.log('ACK de Usuario ' + senderId + ' para msg #' + messageId + ' ignorado (no era para él)');
    }
  },

  // _sendAck(): PRIVADO. Envía un ACK con MI userId y el messageId dado.
  _sendAck(messageId) {
    this._sendFrame({ userId: this.myUserId, messageId, type: TYPE_ACK, text: '' });
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
