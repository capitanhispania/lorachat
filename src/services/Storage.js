/*
 * ==========================================================================
 * ARCHIVO: src/services/Storage.js
 * QUÉ ES: Todo el guardado en el móvil, encima de AsyncStorage.
 *         AsyncStorage es el almacenamiento más simple de RN: pares
 *         clave -> texto. Guardamos objetos como JSON.
 * --------------------------------------------------------------------------
 * QUÉ GUARDAMOS (claves):
 *   PROFILE      -> { userId, username }         (mi identidad, se crea 1 vez)
 *   CONFIG       -> { sf, cr, txPower }           (ajustes de radio)
 *   NEXT_ID      -> número                        (contador de MESSAGE_ID)
 *   CONTACTS     -> { [userId]: {userId,name,known} }
 *   CHAT:<id>    -> [ mensajes... ]               (una lista por contacto)
 *   LOGS_ENABLED -> '1' o '0'                     (interruptor de logs)
 *
 * Un MENSAJE guardado:
 *   { messageId, fromMe, text, ack, ts }
 * --------------------------------------------------------------------------
 * DEPENDE DE: @react-native-async-storage/async-storage
 * LO USA: ChatManager y las pantallas.
 * ==========================================================================
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// Prefijo común para agrupar nuestras claves.
const K = {
  PROFILE: '@lorachat/profile',
  CONFIG: '@lorachat/config',
  NEXT_ID: '@lorachat/nextId',
  CONTACTS: '@lorachat/contacts',
  CHAT: '@lorachat/chat/', // se le añade el userId
  LOGS_ENABLED: '@lorachat/logsEnabled',
};

// Config de radio por defecto.
const DEFAULT_CONFIG = { sf: 7, cr: 5, txPower: 7 };

const Storage = {
  // --- Perfil ----------------------------------------------------------

  async getProfile() {
    const raw = await AsyncStorage.getItem(K.PROFILE);
    return raw ? JSON.parse(raw) : null;
  },

  async setProfile(profile) {
    await AsyncStorage.setItem(K.PROFILE, JSON.stringify(profile));
  },

  // --- Configuración de radio -----------------------------------------

  async getConfig() {
    const raw = await AsyncStorage.getItem(K.CONFIG);
    return raw ? JSON.parse(raw) : { ...DEFAULT_CONFIG };
  },

  async setConfig(config) {
    await AsyncStorage.setItem(K.CONFIG, JSON.stringify(config));
  },

  // --- Interruptor de logs --------------------------------------------

  // getLogsEnabled(): devuelve true/false. Si nunca se guardó, por defecto true.
  async getLogsEnabled() {
    const raw = await AsyncStorage.getItem(K.LOGS_ENABLED);
    if (raw === null) return true; // por defecto ENCENDIDO
    return raw === '1';
  },

  // setLogsEnabled(): guarda el estado del interruptor.
  async setLogsEnabled(enabled) {
    await AsyncStorage.setItem(K.LOGS_ENABLED, enabled ? '1' : '0');
  },

  // --- Contador de MESSAGE_ID -----------------------------------------

  async getNextMessageId() {
    const raw = await AsyncStorage.getItem(K.NEXT_ID);
    return raw ? parseInt(raw, 10) : 0;
  },

  // Devuelve el id actual y deja guardado el siguiente (único y creciente).
  async bumpNextMessageId() {
    const current = await this.getNextMessageId();
    await AsyncStorage.setItem(K.NEXT_ID, String(current + 1));
    return current;
  },

  // --- Contactos -------------------------------------------------------

  async getContacts() {
    const raw = await AsyncStorage.getItem(K.CONTACTS);
    return raw ? JSON.parse(raw) : {};
  },

  // Crea o actualiza un contacto. Respeta name/known si no se pasan nuevos.
  async upsertContact(userId, { name, known } = {}) {
    const contacts = await this.getContacts();
    const key = String(userId);
    const existing = contacts[key];

    contacts[key] = {
      userId,
      name: name !== undefined ? name : existing ? existing.name : 'Usuario ' + userId,
      known: known !== undefined ? known : existing ? existing.known : false,
    };

    await AsyncStorage.setItem(K.CONTACTS, JSON.stringify(contacts));
    return contacts[key];
  },

  async setContactKnown(userId, known) {
    return this.upsertContact(userId, { known });
  },

  // --- Chats (lista de mensajes por contacto) --------------------------

  async getChat(userId) {
    const raw = await AsyncStorage.getItem(K.CHAT + userId);
    return raw ? JSON.parse(raw) : [];
  },

  async saveChat(userId, messages) {
    await AsyncStorage.setItem(K.CHAT + userId, JSON.stringify(messages));
  },
};

export default Storage;
