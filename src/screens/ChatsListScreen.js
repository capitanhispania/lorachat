/*
 * ==========================================================================
 * ARCHIVO: src/screens/ChatsListScreen.js
 * QUÉ ES: La pantalla principal (estilo WhatsApp): lista de chats, uno por
 *         contacto. Arriba: conectar USB, icono de logs y ajustes.
 * --------------------------------------------------------------------------
 * DEPENDE DE: Storage, ChatManager, SerialService, LogModal.
 * RECIBE POR PROPS (de App.js):
 *   onOpenChat(peerId) -> abrir la conversación con un contacto.
 *   onOpenSettings()   -> abrir los ajustes.
 *
 * FLUJO:
 *   al montar -> carga() lee contactos + últimos mensajes; se suscribe a
 *   ChatManager (datos) y a SerialService (estado de conexión).
 *   icono 📖 -> abre el pop-up de logs (LogModal).
 * ==========================================================================
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Image,
  FlatList,
  TouchableOpacity,
  Alert,
  StyleSheet,
} from 'react-native';
import Storage from '../services/Storage';
import ChatManager from '../state/ChatManager';
import SerialService from '../services/SerialService';
import LogModal from '../components/LogModal';
import battleShoutIcon from '../assets/battle-shout.png';

export default function ChatsListScreen({ onOpenChat, onOpenSettings }) {
  const [chats, setChats] = useState([]);
  const [connected, setConnected] = useState(SerialService.isConnected());
  const [showLogs, setShowLogs] = useState(false); // ¿pop-up de logs abierto?

  // carga(): lee todos los contactos y su último mensaje.
  async function carga() {
    const contacts = await Storage.getContacts();
    const lista = [];

    for (const key of Object.keys(contacts)) {
      const c = contacts[key];
      const mensajes = await Storage.getChat(c.userId);
      const ultimo = mensajes.length ? mensajes[mensajes.length - 1] : null;
      lista.push({ contact: c, ultimo });
    }

    // Chats con actividad más reciente arriba.
    lista.sort((a, b) => {
      const ta = a.ultimo ? a.ultimo.ts : 0;
      const tb = b.ultimo ? b.ultimo.ts : 0;
      return tb - ta;
    });

    setChats(lista);
  }

  useEffect(() => {
    carga();
    const unsubData = ChatManager.subscribe(carga);
    const unsubStatus = SerialService.onStatus(setConnected);
    return () => {
      unsubData();
      unsubStatus();
    };
  }, []);

  // conectar(): pide permiso y abre el USB.
  async function conectar() {
    const ok = await SerialService.connect();
    setConnected(ok);
  }

  // gritar(): emite la señal "¿Hay alguien ahí?" en broadcast.
  // Necesita el USB conectado (si no, no hay por dónde transmitir).
  async function gritar() {
    if (!connected) {
      Alert.alert('Sin conexión', 'Conecta el USB con el ESP32 antes de gritar.');
      return;
    }
    await ChatManager.sendHello();
    Alert.alert('Señal enviada', 'Has gritado "¿Hay alguien ahí?". Espera a que alguien responda.');
  }

  // abreChat(): marca conocido y abre la conversación.
  async function abreChat(contact) {
    if (!contact.known) {
      await Storage.setContactKnown(contact.userId, true);
    }
    onOpenChat(contact.userId);
  }

  // renderItem(): una fila de la lista.
  function renderItem({ item }) {
    const { contact, ultimo } = item;
    const nombre = contact.known ? contact.name : contact.name + ' (desconocido)';
    const preview = ultimo ? (ultimo.fromMe ? 'Tú: ' : '') + ultimo.text : 'Sin mensajes';

    return (
      <TouchableOpacity style={styles.row} onPress={() => abreChat(contact)}>
        <Text style={styles.rowName}>{nombre}</Text>
        <Text style={styles.rowPreview} numberOfLines={1}>{preview}</Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.container}>
      {/* Barra superior */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>LoRa Chat</Text>
        <View style={styles.headerActions}>
          {/* Conectar / estado: botón de texto en forma de "píldora" */}
          <TouchableOpacity onPress={conectar} style={styles.connectBtn}>
            <Text style={styles.connectBtnText}>{connected ? 'USB ✓' : 'Conectar'}</Text>
          </TouchableOpacity>
          {/* Botón "¿Hay alguien ahí?": el más grande de todos, para que destaque */}
          <TouchableOpacity onPress={gritar} style={styles.headerBtn}>
            <Image source={battleShoutIcon} style={styles.shoutIcon} />
          </TouchableOpacity>
          {/* Icono de logs (librito) */}
          <TouchableOpacity onPress={() => setShowLogs(true)} style={styles.headerBtn}>
            <Text style={styles.iconBtnText}>📖</Text>
          </TouchableOpacity>
          {/* Icono de ajustes */}
          <TouchableOpacity onPress={onOpenSettings} style={styles.headerBtn}>
            <Text style={styles.iconBtnText}>⚙️</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Lista de chats o mensaje vacío */}
      {chats.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>
            No hay chats todavía.{'\n'}Cuando recibas un mensaje aparecerá aquí.
          </Text>
        </View>
      ) : (
        <FlatList
          data={chats}
          keyExtractor={(item) => String(item.contact.userId)}
          renderItem={renderItem}
        />
      )}

      {/* Pop-up de logs (se muestra por encima cuando showLogs=true) */}
      <LogModal visible={showLogs} onClose={() => setShowLogs(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: {
    backgroundColor: '#075E54',
    paddingTop: 40,
    paddingBottom: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  // flexShrink: si los iconos ocupan mucho, el título se encoge en vez de romper la barra.
  headerTitle: { color: '#fff', fontSize: 20, fontWeight: 'bold', flexShrink: 1 },
  headerActions: { flexDirection: 'row', alignItems: 'center' },
  // Separación entre iconos + zona de toque cómoda (sin agrandar la barra).
  headerBtn: { marginLeft: 12, paddingHorizontal: 4, paddingVertical: 2 },
  // Iconos (logs y ajustes): bastante más grandes que antes (era 16).
  iconBtnText: { color: '#fff', fontSize: 26 },
  // Botón "¿Hay alguien ahí?": el más grande de todos para que destaque.
  // Redondeado para que se vea como icono de app y no como una foto pegada.
  shoutIcon: { width: 36, height: 36, borderRadius: 18 },
  // "Conectar" es texto, así que va como píldora en vez de crecer como un icono.
  connectBtn: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  connectBtnText: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  row: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  rowName: { fontSize: 16, fontWeight: 'bold', color: '#111' },
  rowPreview: { fontSize: 14, color: '#666', marginTop: 2 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  emptyText: { textAlign: 'center', color: '#888', fontSize: 15 },
});
